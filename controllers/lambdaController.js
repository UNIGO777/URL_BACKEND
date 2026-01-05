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
  fetchHtmlWithBrowser,
  resolveFinalUrl,
  looksLikeBotOrBlockedHtml,
  hasUsefulMetadata,
  isAmazonUrl
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

      const shorteners = new Set([
        'amzn.in',
        'amzn.to',
        'bit.ly',
        't.co',
        'tinyurl.com',
        'goo.gl',
        'rebrand.ly',
        'cutt.ly',
        'is.gd',
        'rb.gy',
        'buff.ly',
        'lnkd.in'
      ]);
      let targetUrl = url;
      try {
        const h = new URL(url).hostname.toLowerCase();
        if (shorteners.has(h)) {
          targetUrl = await resolveFinalUrl(url);
        }
      } catch {}

      const qualityAttempts = 3;
      let effectiveResult;
      let effectiveUrl = targetUrl;
      let metadata = null;
      let totalAttempt = 1;

      for (let qualityAttempt = 0; qualityAttempt < qualityAttempts; qualityAttempt++) {
        const result = await this.executeWithRetry(targetUrl, method, customHeaders, data);

        effectiveResult = result;
        effectiveUrl = result?.finalUrl || targetUrl;
        totalAttempt = qualityAttempt * MAX_RETRIES + (effectiveResult?.attempt || 1);
        metadata = null;

        const effectiveBody = typeof effectiveResult.data === 'string' ? String(effectiveResult.data) : '';
        const effectiveSeemsHtml = Boolean(
          effectiveBody &&
            (isHtmlContent(effectiveResult) ||
              /<\s*html\b/i.test(effectiveBody) ||
              /<\s*head\b/i.test(effectiveBody) ||
              /<\s*title\b/i.test(effectiveBody))
        );

        let didBrowserFetch = false;
        const expectedAmazonProduct = (() => {
          const candidate = effectiveUrl || targetUrl;
          if (!isAmazonUrl(candidate)) return false;
          try {
            const p = new URL(candidate).pathname || '';
            return /\/(dp|gp\/product)\/[a-z0-9]{10}/i.test(p);
          } catch {
            return /\/(dp|gp\/product)\/[a-z0-9]{10}/i.test(String(candidate));
          }
        })();

        const isAmazonProductOk = (m, html) => {
          if (!expectedAmazonProduct) return true;
          const title = String(m?.title || '').trim().toLowerCase();
          if (!title) return false;
          if (title === 'amazon.in' || title === 'amazon') return false;
          if (title.includes('robot') || title.includes('captcha') || title.includes('access denied') || title.includes('forbidden')) return false;
          const og = String(m?.images?.ogImage || '').toLowerCase();
          const ogOk = /m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|images-eu\.ssl-images-amazon\.com/.test(og);
          const h = String(html || '').toLowerCase();
          const htmlOk = h.includes('producttitle') || h.includes('data-asin') || h.includes('add-to-cart') || h.includes('acrcustomerreviewtext');
          return ogOk && htmlOk;
        };

        if (effectiveSeemsHtml) {
          console.log('🖼️  Extracting metadata from HTML content...');
          metadata = extractMetadata(effectiveBody, effectiveUrl);
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

          const hasMeta = hasUsefulMetadata(metadata);
          const blocked = looksLikeBotOrBlockedHtml(effectiveBody, effectiveUrl);
          const amazonOk = isAmazonProductOk(metadata, effectiveBody);
          const shouldBrowserFetch = (!hasMeta && blocked) || (!hasMeta && needsBrowserFetch(effectiveUrl)) || (expectedAmazonProduct && !amazonOk);

          if (!didBrowserFetch && shouldBrowserFetch) {
            console.log('🧭 Browser fallback: attempting headless fetch...');
            const browserRes = await fetchHtmlWithBrowser(effectiveUrl);
            if (browserRes && typeof browserRes.data === 'string' && browserRes.data.length > 0) {
              effectiveResult = {
                status: browserRes.status,
                statusText: browserRes.statusText,
                headers: browserRes.headers,
                data: browserRes.data,
                attempt: (effectiveResult?.attempt || 0) + 1,
                durationMs: effectiveResult?.durationMs,
                finalUrl: effectiveUrl
              };
              didBrowserFetch = true;
              const browserBody = typeof effectiveResult.data === 'string' ? String(effectiveResult.data) : '';
              metadata = extractMetadata(browserBody, effectiveUrl);
            }
          }

          if (needsPlatformFallback(effectiveUrl, metadata)) {
            console.log('🔁 Using platform oEmbed fallback for richer metadata...');
            const platformMeta = await fetchPlatformMetadata(effectiveUrl);
            if (platformMeta) {
              metadata = mergeMetadata(metadata, platformMeta, effectiveUrl);
            } else {
              console.log('⚠️  Platform fallback unavailable or failed.');
            }
          }

          if (!metadata.images.favicon) {
            try {
              const u = new URL(effectiveUrl);
              metadata.images.favicon = `${u.protocol}//${u.hostname}/favicon.ico`;
            } catch {}
          }

          const finalBody = typeof effectiveResult.data === 'string' ? String(effectiveResult.data) : effectiveBody;
          const finalAmazonOk = isAmazonProductOk(metadata, finalBody);
          const finalHasMeta = hasUsefulMetadata(metadata);
          const finalBlocked = looksLikeBotOrBlockedHtml(finalBody, effectiveUrl);
          const qualityOk = expectedAmazonProduct ? finalAmazonOk : (finalHasMeta && !(finalBlocked && !finalHasMeta));

          if (qualityOk) break;
        } else {
          break;
        }

        if (qualityAttempt < qualityAttempts - 1) {
          const delay = calculateBackoffDelay(qualityAttempt);
          console.log(`⏳ Retrying for better metadata. Waiting ${delay}ms...`);
          await sleep(delay);
        }
      }
      
      // Classify link type based on URL and extracted content
      const linkType = classifyLinkType(
        effectiveUrl,
        metadata?.title || '',
        metadata?.description || '',
        isHtmlContent(effectiveResult) ? effectiveResult.data : ''
      );
      console.log('🔍 Link classified as:', linkType);
      
      // Return successful response with metadata
      const responseData = {
        url,
        resolvedUrl: effectiveUrl !== url ? effectiveUrl : undefined,
        method: method.toUpperCase(),
        status: effectiveResult.status,
        statusText: effectiveResult.statusText,
        linkType,
        metadata: {
          domain: (() => { try { return new URL(effectiveUrl).hostname; } catch { return ''; } })(),
          statusCode: effectiveResult.status,
          statusText: effectiveResult.statusText,
          method: method.toUpperCase(),
          contentType: (effectiveResult.headers && (effectiveResult.headers['content-type'] || effectiveResult.headers['Content-Type'])) || '',
          responseTime: effectiveResult.durationMs,
          attempt: totalAttempt
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
      const hasUsefulMeta = Boolean(
          metadata?.title ||
            metadata?.description ||
            metadata?.images?.logo ||
            metadata?.images?.ogImage ||
            metadata?.images?.favicon ||
            metadata?.images?.appleTouchIcon
      ) || isHtmlContent(effectiveResult);
      const upstreamOk = effectiveResult.status >= 200 && effectiveResult.status < 300;
      const htmlText = typeof effectiveResult.data === 'string' ? String(effectiveResult.data) : '';
      const looksError = (looksLikeBotOrBlockedHtml(htmlText, effectiveUrl) && !hasUsefulMeta) || (String(metadata?.title || '').toLowerCase().includes('error'));
      const clientSuccess = (upstreamOk && !looksError) || (hasUsefulMeta && !looksError);
      const httpStatus = clientSuccess ? 200 : effectiveResult.status;

      res.status(httpStatus).json({
        success: clientSuccess,
        data: responseData,
        attempt: totalAttempt,
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
          maxRedirects: 10,
          responseType: 'text',
          transformResponse: [(d) => d],
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
        const finalUrl =
          response?.request?.res?.responseUrl ||
          response?.request?._redirectable?._currentUrl ||
          url;
        
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
        const bodyText = typeof response.data === 'string' ? response.data : '';
        const htmlOk = Boolean(
          bodyText &&
            (isHtmlContent(response) ||
              /<\s*html\b/i.test(bodyText) ||
              /<\s*head\b/i.test(bodyText) ||
              /<\s*title\b/i.test(bodyText))
        );
        let metaOk = false;
        if (htmlOk) {
          try {
            const m = extractMetadata(bodyText, finalUrl);
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

        const blockedHtml = htmlOk && looksLikeBotOrBlockedHtml(bodyText, finalUrl);
        const domainIsBlinkit = (() => { try { return new URL(finalUrl).hostname.includes('blinkit.com'); } catch { return false; } })();
        const bodyStr = bodyText.toLowerCase();
        const looksBlocked = bodyStr.includes('access denied') || bodyStr.includes('forbidden') || bodyStr.includes('blocked') || bodyStr.includes('captcha');
        const shouldRetry = (!upstreamOk && (response.status === 403 || response.status === 429 || response.status === 503)) || (domainIsBlinkit && looksBlocked && !metaOk) || (blockedHtml && !metaOk);

        if ((upstreamOk && !blockedHtml) || metaOk || attempt === MAX_RETRIES - 1 || !shouldRetry) {
          return {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data,
            attempt: attempt + 1,
            durationMs,
            finalUrl
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
