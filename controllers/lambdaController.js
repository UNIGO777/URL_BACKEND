const axios = require('axios');
const { MAX_RETRIES, REQUEST_TIMEOUT, MESSAGES } = require('../config/constants');
const { 
  sleep, 
  getRandomUserAgent, 
  generateHeaders, 
  formatLambdaResponse, 
  calculateBackoffDelay,
  extractImages,
  extractMetadata,
  isHtmlContent,
  classifyLinkType,
  fetchPlatformMetadata,
  needsPlatformFallback,
  mergeMetadata,
  needsBrowserFetch,
  fetchHtmlWithBrowser
} = require('../utils/helpers');

/**
 * Lambda-style request executor with retry logic and bot detection avoidance
 */
class LambdaController {
  
  /**
   * Execute HTTP request with enhanced functionality
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   */
  async executeRequest(req, res) {
    try {
      // Extract parameters from both body and query
      const { url, method = 'GET', headers: customHeaders = {}, data } = {
        ...req.query,
        ...req.body
      };

      // Validate required parameters
      if (!url) {
        return res.status(400).json(
          formatLambdaResponse(400, { error: MESSAGES.MISSING_URL })
        );
      }

      // Validate HTTP method
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'];
      if (!validMethods.includes(method.toUpperCase())) {
        return res.status(400).json(
          formatLambdaResponse(400, { error: MESSAGES.INVALID_METHOD })
        );
      }

      console.log(`\n🚀 Executing ${method.toUpperCase()} request to: ${url}`);

      // Execute request with retry logic
      const result = await this.executeWithRetry(url, method, customHeaders, data);
      
      // If HTML looks like an error page and domain needs browser fetch, try Playwright fallback
      let effectiveResult = result;
      try {
        const domainNeedsBrowser = needsBrowserFetch(url);
        const htmlText = isHtmlContent(result) && typeof result.data === 'string' ? String(result.data).toLowerCase() : '';
        const looksError = htmlText.includes('access denied') || htmlText.includes('forbidden') || htmlText.includes('blocked') || htmlText.includes('captcha') || htmlText.includes('error');
        if (domainNeedsBrowser && looksError) {
          console.log('🧭 Browser fallback: attempting headless fetch...');
          const browserRes = await fetchHtmlWithBrowser(url);
          if (browserRes && typeof browserRes.data === 'string' && browserRes.data.length > 0) {
            effectiveResult = {
              status: browserRes.status,
              statusText: browserRes.statusText,
              headers: browserRes.headers,
              data: browserRes.data,
              attempt: (result?.attempt || 0) + 1,
              durationMs: result?.durationMs
            };
          } else {
            console.log('⚠️ Browser fallback unavailable or returned empty content.');
          }
        }
      } catch (e) {
        console.log('⚠️ Browser fallback failed:', e?.message || e);
      }
      
      // Extract metadata (images, title, description) if response is HTML
      let metadata = null;
      if (isHtmlContent(effectiveResult) && typeof effectiveResult.data === 'string') {
        console.log('🖼️  Extracting metadata from HTML content...');
        metadata = extractMetadata(effectiveResult.data, url);
        console.log('📸 Images found:', {
          logo: metadata.images.logo ? '✅' : '❌',
          ogImage: metadata.images.ogImage ? '✅' : '❌',
          favicon: metadata.images.favicon ? '✅' : '❌',
          appleTouchIcon: metadata.images.appleTouchIcon ? '✅' : '❌'
        });
        console.log('📝 Content found:', {
          title: metadata.title ? '✅' : '❌',
          description: metadata.description ? '✅' : '❌'
        });

        // Platform-aware fallback: use oEmbed when content looks generic/missing
        if (needsPlatformFallback(url, metadata)) {
          console.log('🔁 Using platform oEmbed fallback for richer metadata...');
          const platformMeta = await fetchPlatformMetadata(url);
          if (platformMeta) {
            metadata = mergeMetadata(metadata, platformMeta, url);
          } else {
            console.log('⚠️  Platform fallback unavailable or failed.');
          }
        }

        if (!metadata.images.favicon) {
          try {
            const u = new URL(url);
            metadata.images.favicon = `${u.protocol}//${u.hostname}/favicon.ico`;
          } catch {}
        }
      }
      
      // Classify link type based on URL and extracted content
      const linkType = classifyLinkType(
        url,
        metadata?.title || '',
        metadata?.description || '',
        isHtmlContent(effectiveResult) ? effectiveResult.data : ''
      );
      console.log('🔍 Link classified as:', linkType);
      
      // Return successful response with metadata
      const responseData = {
        url,
        method: method.toUpperCase(),
        status: effectiveResult.status,
        statusText: effectiveResult.statusText,
        linkType,
        metadata: {
          domain: (() => { try { return new URL(url).hostname; } catch { return ''; } })(),
          statusCode: effectiveResult.status,
          statusText: effectiveResult.statusText,
          method: method.toUpperCase(),
          contentType: (effectiveResult.headers && (effectiveResult.headers['content-type'] || effectiveResult.headers['Content-Type'])) || '',
          responseTime: effectiveResult.durationMs,
          attempt: effectiveResult.attempt
        }
        // headers: result.headers,
        // data: result.data
      };

      // Add metadata to response if found
      if (metadata) {
        responseData.images = metadata.images;
        responseData.title = metadata.title;
        responseData.description = metadata.description;
      }

      // Return direct JSON response instead of Lambda format for better API usability
      const hasUsefulMetadata = Boolean(
        metadata?.title ||
          metadata?.description ||
          metadata?.images?.logo ||
          metadata?.images?.ogImage ||
          metadata?.images?.favicon ||
          metadata?.images?.appleTouchIcon
      ) || isHtmlContent(result);
      const upstreamOk = effectiveResult.status >= 200 && effectiveResult.status < 300;
      const htmlText = isHtmlContent(effectiveResult) && typeof effectiveResult.data === 'string' ? String(effectiveResult.data).toLowerCase() : '';
      const looksError = htmlText.includes('access denied') || htmlText.includes('forbidden') || htmlText.includes('blocked') || htmlText.includes('captcha') || (String(metadata?.title || '').toLowerCase().includes('error'));
      const clientSuccess = upstreamOk || (hasUsefulMetadata && !looksError);
      const httpStatus = clientSuccess ? 200 : effectiveResult.status;

      res.status(httpStatus).json({
        success: clientSuccess,
        data: responseData,
        attempt: effectiveResult.attempt,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Request execution failed:', error.message);
      
      // Return error response
      res.status(500).json(
        formatLambdaResponse(500, {
          error: MESSAGES.REQUEST_FAILED,
          details: error.message,
          url: req.body?.url || req.query?.url
        })
      );
    }
  }

  /**
   * Execute request with retry logic and exponential backoff
   * @param {string} url - Target URL
   * @param {string} method - HTTP method
   * @param {object} customHeaders - Custom headers
   * @param {any} data - Request data
   * @returns {Promise<object>} Response object with attempt count
   */
  async executeWithRetry(url, method, customHeaders = {}, data = null) {
    let lastError;
    let stickyCookie = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`📡 Attempt ${attempt + 1}/${MAX_RETRIES}`);

        // Generate random user agent and headers for each attempt
        const userAgent = getRandomUserAgent();
        const browserHeaders = generateHeaders(url, userAgent);
        
        // Merge headers (custom headers override browser headers)
        const finalHeaders = {
          ...browserHeaders,
          ...customHeaders,
          ...(stickyCookie ? { Cookie: stickyCookie } : {})
        };

        console.log(`🎭 Using User-Agent: ${userAgent.substring(0, 50)}...`);

        // Configure axios request
        const config = {
          method: method.toUpperCase(),
          url,
          headers: finalHeaders,
          timeout: REQUEST_TIMEOUT,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          decompress: true,
          validateStatus: () => true // Accept all status codes
        };

        // Add data for POST/PUT/PATCH requests
        if (data && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
          config.data = data;
        }

        // Execute request
        const started = Date.now();
        const response = await axios(config);
        const durationMs = Date.now() - started;
        
        console.log(`✅ Success! Status: ${response.status} ${response.statusText}`);
        
        const setCookies = response.headers['set-cookie'] || response.headers['Set-Cookie'];
        if (Array.isArray(setCookies) && setCookies.length) {
          const pairs = setCookies.map(c => String(c).split(';')[0]).filter(Boolean);
          if (pairs.length) {
            const merged = pairs.join('; ');
            stickyCookie = merged;
          }
        } else if (typeof setCookies === 'string' && setCookies.length) {
          const pair = setCookies.split(';')[0];
          stickyCookie = pair;
        }

        const upstreamOk = response.status >= 200 && response.status < 300;
        const htmlOk = isHtmlContent(response) && typeof response.data === 'string';
        let metaOk = false;
        if (htmlOk) {
          try {
            const m = extractMetadata(response.data, url);
            const t = String(m?.title || '').toLowerCase();
            const d = String(m?.description || '').toLowerCase();
            const errorish = t.includes('403') || t.includes('forbidden') || t.includes('blocked') || t.includes('captcha') || t.includes('error') || d.includes('error');
            metaOk = !errorish && Boolean(
              m?.title ||
              m?.description ||
              m?.images?.logo ||
              m?.images?.ogImage ||
              m?.images?.favicon ||
              m?.images?.appleTouchIcon
            );
          } catch {}
        }

        const domainIsBlinkit = (() => { try { return new URL(url).hostname.includes('blinkit.com'); } catch { return false; } })();
        const bodyStr = typeof response.data === 'string' ? response.data.toLowerCase() : '';
        const looksBlocked = bodyStr.includes('access denied') || bodyStr.includes('forbidden') || bodyStr.includes('blocked') || bodyStr.includes('captcha');
        const shouldRetry = (!upstreamOk && (response.status === 403 || response.status === 429 || response.status === 503)) || (domainIsBlinkit && looksBlocked && !metaOk);

        if (upstreamOk || metaOk || attempt === MAX_RETRIES - 1 || !shouldRetry) {
          return {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data,
            attempt: attempt + 1,
            durationMs
          };
        }

        const delay = calculateBackoffDelay(attempt);
        console.log(`⏳ Retrying due to upstream status ${response.status}. Waiting ${delay}ms...`);
        await sleep(delay);
        continue;

      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        
        console.log(`⚠️  Attempt ${attempt + 1} failed:`, {
          status,
          message: error.message,
          code: error.code
        });

        // If this is the last attempt, throw the error
        if (attempt === MAX_RETRIES - 1) {
          throw lastError;
        }

        // Calculate delay for next attempt
        const delay = calculateBackoffDelay(attempt);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Health check endpoint
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   */
  async healthCheck(req, res) {
    const response = formatLambdaResponse(200, {
      message: MESSAGES.HEALTH_CHECK,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0'
    });

    res.json(response);
  }

  /**
   * Root endpoint with API documentation
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   */
  async getApiInfo(req, res) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    const response = formatLambdaResponse(200, {
      message: 'Enhanced Lambda-style Server API',
      version: '2.0.0',
      features: [
        'Bot detection avoidance',
        'Rotating user agents',
        'Retry mechanism with exponential backoff',
        'AWS Lambda compatible responses',
        'CORS support'
      ],
      endpoints: {
        health: `${baseUrl}/health`,
        execute: `${baseUrl}/execute`,
        documentation: `${baseUrl}/`
      },
      usage: {
        get: `${baseUrl}/execute?url=https://example.com&method=GET`,
        post: {
          url: `${baseUrl}/execute`,
          method: 'POST',
          body: {
            url: 'https://example.com',
            method: 'POST',
            data: { key: 'value' },
            headers: { 'Custom-Header': 'value' }
          }
        }
      }
    });

    res.json(response);
  }
}

module.exports = new LambdaController();
