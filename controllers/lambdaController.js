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
  mergeMetadata
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
      
      // Extract metadata (images, title, description) if response is HTML
      let metadata = null;
      if (isHtmlContent(result) && typeof result.data === 'string') {
        console.log('🖼️  Extracting metadata from HTML content...');
        metadata = extractMetadata(result.data, url);
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
      }
      
      // Classify link type based on URL and extracted content
      const linkType = classifyLinkType(
        url,
        metadata?.title || '',
        metadata?.description || '',
        isHtmlContent(result) ? result.data : ''
      );
      console.log('🔍 Link classified as:', linkType);
      
      // Return successful response with metadata
      const responseData = {
        url,
        method: method.toUpperCase(),
        status: result.status,
        statusText: result.statusText,
        linkType,
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
      res.status(result.status).json({
        success: result.status >= 200 && result.status < 300,
        data: responseData,
        attempt: result.attempt,
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

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`📡 Attempt ${attempt + 1}/${MAX_RETRIES}`);

        // Generate random user agent and headers for each attempt
        const userAgent = getRandomUserAgent();
        const browserHeaders = generateHeaders(url, userAgent);
        
        // Merge headers (custom headers override browser headers)
        const finalHeaders = {
          ...browserHeaders,
          ...customHeaders
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
        const response = await axios(config);
        
        console.log(`✅ Success! Status: ${response.status} ${response.statusText}`);
        
        return {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data,
          attempt: attempt + 1
        };

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