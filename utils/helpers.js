const { USER_AGENTS } = require('../config/constants');
const cheerio = require('cheerio');
const axios = require('axios');

/**
 * Sleep function for adding delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after the specified time
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get a random user agent from the predefined list
 * @returns {string} Random user agent string
 */
const getRandomUserAgent = () => {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

/**
 * Generate browser-like headers for a given URL
 * @param {string} url - Target URL
 * @param {string} userAgent - User agent string
 * @returns {object} Headers object
 */
const generateHeaders = (url, userAgent) => {
  const urlObj = new URL(url);
  const origin = `${urlObj.protocol}//${urlObj.hostname}`;
  const hostname = urlObj.hostname.toLowerCase();
  const lang = hostname.includes('blinkit.com') ? 'en-IN,hi;q=0.8,en-US;q=0.7,en;q=0.6' : 'en-US,en;q=0.9';
  const platform = userAgent.includes('Windows NT') ? '"Windows"' :
                   userAgent.includes('Macintosh') ? '"macOS"' :
                   userAgent.includes('Linux') ? '"Linux"' : '"Unknown"';
  const isChromiumLike = /Chrome\/|Edg\//.test(userAgent);
  const secChUa = isChromiumLike ? '"Not.A/Brand";v="99", "Chromium";v="120", "Google Chrome";v="120"' : undefined;
  const secFetchSite = urlObj.hostname && origin.includes(urlObj.hostname) ? 'same-origin' : 'none';
  
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': lang,
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    ...(secChUa ? { 'Sec-Ch-Ua': secChUa, 'Sec-Ch-Ua-Mobile': '?0', 'Sec-Ch-Ua-Platform': platform } : {}),
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': secFetchSite,
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'Referer': url,
    'Origin': origin
  };
};

/**
 * Format response in AWS Lambda style
 * @param {number} statusCode - HTTP status code
 * @param {object} data - Response data
 * @param {object} headers - Response headers
 * @param {number} attempt - Attempt number
 * @returns {object} Lambda-formatted response
 */
const formatLambdaResponse = (statusCode, data, headers = {}, attempt = 1) => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers
    },
    body: JSON.stringify({
      success: statusCode >= 200 && statusCode < 300,
      data,
      attempt,
      timestamp: new Date().toISOString()
    })
  };
};

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-based)
 * @returns {number} Delay in milliseconds
 */
const calculateBackoffDelay = (attempt) => {
  const baseDelay = 1000; // 1 second
  const maxDelay = 10000; // 10 seconds
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  return delay + Math.random() * 1000; // Add jitter
};

/**
 * Extract logo and OG images from HTML content
 * @param {string} html - HTML content to parse
 * @param {string} baseUrl - Base URL for resolving relative URLs
 * @returns {object} Object containing logo and OG image URLs
 */
const extractMetadata = (html, baseUrl) => {
  const $ = cheerio.load(html);
  const metadata = {
    images: {
      logo: null,
      ogImage: null,
      favicon: null,
      appleTouchIcon: null
    },
    title: null,
    description: null
  };

  try {
    // Extract title
    metadata.title = $('meta[property="og:title"]').attr('content') || 
                    $('meta[name="og:title"]').attr('content') ||
                    $('title').text() ||
                    $('h1').first().text() ||
                    null;

    // Clean up title
    if (metadata.title) {
      metadata.title = metadata.title.trim();
    }

    // Extract description
    metadata.description = $('meta[property="og:description"]').attr('content') || 
                          $('meta[name="og:description"]').attr('content') ||
                          $('meta[name="description"]').attr('content') ||
                          $('meta[property="description"]').attr('content') ||
                          null;

    // Clean up description
    if (metadata.description) {
      metadata.description = metadata.description.trim();
    }

    const candidates = [];
    const seen = new Set();
    const pushCandidate = (u, source, w = 0, h = 0) => {
      if (!u) return;
      const abs = resolveUrl(u, baseUrl);
      if (!abs) return;
      if (seen.has(abs)) return;
      seen.add(abs);
      candidates.push({ url: abs, source, w, h });
    };

    $('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="og:image"], meta[property="twitter:image"], meta[name="twitter:image"], meta[property="twitter:image:src"], meta[name="twitter:image:src"]').each((_, el) => {
      const u = $(el).attr('content');
      pushCandidate(u, 'meta');
    });

    $('script[type="application/ld+json"]').each((_, el) => {
      const txt = $(el).contents().text().trim();
      if (!txt) return;
      try {
        const data = JSON.parse(txt);
        const scan = (node) => {
          if (!node || typeof node !== 'object') return;
          const tryPush = (val) => {
            if (!val) return;
            if (typeof val === 'string') pushCandidate(val, 'jsonld');
            else if (Array.isArray(val)) {
              for (const i of val) {
                if (typeof i === 'string') pushCandidate(i, 'jsonld');
                else if (i && i.url) pushCandidate(i.url, 'jsonld');
              }
            } else if (val && val.url) pushCandidate(val.url, 'jsonld');
          };
          tryPush(node.image);
          tryPush(node.thumbnailUrl);
          tryPush(node.primaryImageOfPage);
          tryPush(node.logo);
          tryPush(node.contentUrl);
          if (Array.isArray(node['@graph'])) {
            for (const g of node['@graph']) scan(g);
          }
          for (const v of Object.values(node)) {
            if (typeof v === 'object') scan(v);
          }
        };
        if (Array.isArray(data)) {
          for (const item of data) scan(item);
        } else {
          scan(data);
        }
      } catch (_) {}
    });

    $('link[rel="image_src"], link[rel="preload"][as="image"]').each((_, el) => {
      const href = $(el).attr('href');
      pushCandidate(href, 'link');
    });

    $('picture source[srcset], img[srcset]').each((_, el) => {
      const srcset = ($(el).attr('srcset') || '').split(',');
      for (const part of srcset) {
        const m = part.trim().match(/^([^\s]+)\s+(\d+)w/);
        if (m) pushCandidate(m[1], 'srcset', parseInt(m[2], 10) || 0, 0);
      }
    });

    $('img').each((_, el) => {
      const e = $(el);
      const attrs = ['src','data-src','data-original','data-zoom-image','data-hires','data-image','data-large_image','data-fullsize','data-old-hires'];
      for (const a of attrs) {
        const u = e.attr(a);
        if (u) pushCandidate(u, 'img');
      }
      const dyn = e.attr('data-a-dynamic-image');
      if (dyn) {
        try {
          const map = JSON.parse(dyn);
          for (const [u, dims] of Object.entries(map)) {
            const w = Array.isArray(dims) ? parseInt(dims[0], 10) || 0 : 0;
            const h = Array.isArray(dims) ? parseInt(dims[1], 10) || 0 : 0;
            pushCandidate(u, 'img-map', w, h);
          }
        } catch (_) {}
      }
    });

    $('video[poster]').each((_, el) => {
      const u = $(el).attr('poster');
      pushCandidate(u, 'poster');
    });

    $('div[style*="background-image"]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const m = style.match(/url\((['"]?)([^'"\)]+)\1\)/i);
      if (m) pushCandidate(m[2], 'background');
    });

    $('script').each((_, el) => {
      const t = $(el).html() || '';
      const re = /(https?:[^"']+\.(?:png|jpg|jpeg|webp|gif))/ig;
      let m;
      let cnt = 0;
      while ((m = re.exec(t)) && cnt < 20) {
        pushCandidate(m[1], 'script');
        cnt++;
      }
    });

    const scoreCandidate = (c) => {
      let s = 0;
      const u = c.url.toLowerCase();
      if (c.source === 'meta') s += 100;
      if (c.source === 'jsonld') s += 90;
      if (c.source === 'srcset') s += 70;
      if (c.source === 'img-map') s += 65;
      if (c.source === 'img') s += 60;
      if (c.source === 'poster') s += 50;
      if (c.source === 'link') s += 45;
      if (c.source === 'background') s += 40;
      if (c.source === 'script') s += 30;
      if (c.w) s += Math.min(c.w, 1600) / 10;
      if (c.h) s += Math.min(c.h, 1600) / 10;
      if (u.includes('favicon') || u.includes('sprite')) s -= 80;
      if (u.includes('logo')) s -= 40;
      if (u.endsWith('.svg')) s -= 30;
      const wm = u.match(/[?&](?:w|width)=(\d+)/) || u.match(/(\d{3,})w\b/);
      if (wm) s += parseInt(wm[1], 10) / 10;
      const hm = u.match(/[?&](?:h|height)=(\d+)/);
      if (hm) s += parseInt(hm[1], 10) / 10;
      return s;
    };

    if (!metadata.images.ogImage && candidates.length) {
      candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
      metadata.images.ogImage = candidates[0].url;
    }

    // Extract logo from common selectors
    const logoSelectors = [
      'img[alt*="logo" i]',
      'img[class*="logo" i]',
      'img[id*="logo" i]',
      '.logo img',
      '#logo img',
      '[class*="brand"] img',
      'header img:first-of-type',
      '.navbar-brand img',
      '.site-logo img'
    ];

    for (const selector of logoSelectors) {
      const logoElement = $(selector).first();
      if (logoElement.length && logoElement.attr('src')) {
        metadata.images.logo = resolveUrl(logoElement.attr('src'), baseUrl);
        break;
      }
    }

    // Extract favicon
    const favicon = $('link[rel="icon"]').attr('href') || 
                   $('link[rel="shortcut icon"]').attr('href') ||
                   $('link[rel="apple-touch-icon"]').attr('href');
    if (favicon) {
      metadata.images.favicon = resolveUrl(favicon, baseUrl);
    }

    // Extract Apple touch icon
    const appleTouchIcon = $('link[rel="apple-touch-icon"]').attr('href') ||
                          $('link[rel="apple-touch-icon-precomposed"]').attr('href');
    if (appleTouchIcon) {
      metadata.images.appleTouchIcon = resolveUrl(appleTouchIcon, baseUrl);
    }

    // If no logo found, try to use OG image as fallback
    if (!metadata.images.logo && metadata.images.ogImage) {
      metadata.images.logo = metadata.images.ogImage;
    }

    // If still no logo, try favicon as last resort
    if (!metadata.images.logo && metadata.images.favicon) {
      metadata.images.logo = metadata.images.favicon;
    }

  } catch (error) {
    console.error('Error extracting metadata:', error.message);
  }

  return metadata;
};

// Keep the old function name for backward compatibility
const extractImages = (html, baseUrl) => {
  const metadata = extractMetadata(html, baseUrl);
  return metadata.images;
};

/**
 * Resolve relative URLs to absolute URLs
 * @param {string} url - URL to resolve
 * @param {string} baseUrl - Base URL for resolution
 * @returns {string} Resolved absolute URL
 */
const resolveUrl = (url, baseUrl) => {
  if (!url) return null;
  
  try {
    // If already absolute URL, return as is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // If protocol-relative URL
    if (url.startsWith('//')) {
      const baseUrlObj = new URL(baseUrl);
      return `${baseUrlObj.protocol}${url}`;
    }
    
    // Resolve relative URL
    return new URL(url, baseUrl).href;
  } catch (error) {
    console.error('Error resolving URL:', error.message);
    return null;
  }
};

/**
 * Check if response content is HTML
 * @param {object} response - Axios response object
 * @returns {boolean} True if content is HTML
 */
const isHtmlContent = (response) => {
  const contentType = response.headers['content-type'] || '';
  return contentType.includes('text/html');
};

/**
 * Classify the type of link based on URL patterns and content analysis
 * @param {string} url - The URL to classify
 * @param {string} title - Page title (optional)
 * @param {string} description - Page description (optional)
 * @param {string} html - HTML content (optional)
 * @returns {string} Link type: social, product, news, video, portfolio, blog, education, forum, other
 */
const classifyLinkType = (url, title = '', description = '', html = '') => {
  if (!url) return 'other';
  
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  const descriptionLower = description.toLowerCase();
  const htmlLower = html.toLowerCase();
  
  // Social media platforms
  const socialDomains = [
    'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
    'youtube.com', 'tiktok.com', 'snapchat.com', 'pinterest.com', 'reddit.com',
    'discord.com', 'telegram.org', 'whatsapp.com', 'tumblr.com', 'flickr.com',
    'vimeo.com', 'twitch.tv', 'clubhouse.com', 'mastodon.social'
  ];
  
  // Video platforms
  const videoDomains = [
    'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'twitch.tv',
    'tiktok.com', 'vine.co', 'wistia.com', 'brightcove.com', 'jwplayer.com'
  ];
  
  // News domains
  const newsDomains = [
    'cnn.com', 'bbc.com', 'reuters.com', 'ap.org', 'nytimes.com', 'wsj.com',
    'guardian.com', 'washingtonpost.com', 'forbes.com', 'bloomberg.com',
    'techcrunch.com', 'theverge.com', 'engadget.com', 'wired.com', 'ars-technica.com',
    'news.com', 'newsweek.com', 'time.com', 'npr.org', 'abc.com', 'cbsnews.com'
  ];
  
  // E-commerce/Product domains
  const productDomains = [
    'amazon.com', 'ebay.com', 'shopify.com', 'etsy.com', 'alibaba.com',
    'walmart.com', 'target.com', 'bestbuy.com', 'apple.com/store', 'store.google.com',
    'microsoft.com/store', 'nike.com', 'adidas.com', 'zalando.com', 'asos.com', 'blinkit.com'
  ];
  
  // Education domains
  const educationDomains = [
    'coursera.org', 'edx.org', 'udemy.com', 'khanacademy.org', 'mit.edu',
    'harvard.edu', 'stanford.edu', 'berkeley.edu', 'udacity.com', 'pluralsight.com',
    'lynda.com', 'skillshare.com', 'masterclass.com', 'codecademy.com'
  ];
  
  // Forum domains
  const forumDomains = [
    'stackoverflow.com', 'stackexchange.com', 'quora.com', 'reddit.com',
    'discourse.org', 'phpbb.com', 'vbulletin.com', 'xenforo.com', 'invision.com'
  ];
  
  // Check domain-based classification
  for (const domain of socialDomains) {
    if (urlLower.includes(domain)) return 'social';
  }
  
  for (const domain of videoDomains) {
    if (urlLower.includes(domain)) return 'video';
  }
  
  for (const domain of newsDomains) {
    if (urlLower.includes(domain)) return 'news';
  }
  
  for (const domain of productDomains) {
    if (urlLower.includes(domain)) return 'product';
  }
  
  for (const domain of educationDomains) {
    if (urlLower.includes(domain)) return 'education';
  }
  
  for (const domain of forumDomains) {
    if (urlLower.includes(domain)) return 'forum';
  }
  
  // URL pattern analysis
  if (urlLower.includes('/shop') || urlLower.includes('/store') || urlLower.includes('/buy') || 
      urlLower.includes('/product') || urlLower.includes('/cart') || urlLower.includes('/checkout')) {
    return 'product';
  }
  
  if (urlLower.includes('/blog') || urlLower.includes('/article') || urlLower.includes('/post')) {
    return 'blog';
  }
  
  if (urlLower.includes('/news') || urlLower.includes('/press') || urlLower.includes('/media')) {
    return 'news';
  }
  
  if (urlLower.includes('/video') || urlLower.includes('/watch') || urlLower.includes('/play')) {
    return 'video';
  }
  
  if (urlLower.includes('/portfolio') || urlLower.includes('/work') || urlLower.includes('/projects')) {
    return 'portfolio';
  }
  
  if (urlLower.includes('/course') || urlLower.includes('/learn') || urlLower.includes('/education') ||
      urlLower.includes('/tutorial') || urlLower.includes('/training')) {
    return 'education';
  }
  
  if (urlLower.includes('/forum') || urlLower.includes('/discussion') || urlLower.includes('/community')) {
    return 'forum';
  }
  
  // Content-based analysis
  const combinedContent = `${titleLower} ${descriptionLower}`;
  
  // Social indicators
  if (combinedContent.includes('follow') || combinedContent.includes('connect') || 
      combinedContent.includes('social') || combinedContent.includes('network') ||
      combinedContent.includes('profile') || combinedContent.includes('posts')) {
    return 'social';
  }
  
  // Product indicators
  if (combinedContent.includes('buy') || combinedContent.includes('price') || 
      combinedContent.includes('shop') || combinedContent.includes('store') ||
      combinedContent.includes('product') || combinedContent.includes('sale') ||
      combinedContent.includes('discount') || combinedContent.includes('cart')) {
    return 'product';
  }
  
  // News indicators
  if (combinedContent.includes('breaking') || combinedContent.includes('news') || 
      combinedContent.includes('report') || combinedContent.includes('latest') ||
      combinedContent.includes('update') || combinedContent.includes('headline')) {
    return 'news';
  }
  
  // Video indicators
  if (combinedContent.includes('video') || combinedContent.includes('watch') || 
      combinedContent.includes('play') || combinedContent.includes('stream') ||
      combinedContent.includes('episode') || combinedContent.includes('movie')) {
    return 'video';
  }
  
  // Portfolio indicators
  if (combinedContent.includes('portfolio') || combinedContent.includes('work') || 
      combinedContent.includes('projects') || combinedContent.includes('showcase') ||
      combinedContent.includes('gallery') || combinedContent.includes('design')) {
    return 'portfolio';
  }
  
  // Blog indicators
  if (combinedContent.includes('blog') || combinedContent.includes('article') || 
      combinedContent.includes('post') || combinedContent.includes('author') ||
      combinedContent.includes('written') || combinedContent.includes('published')) {
    return 'blog';
  }
  
  // Education indicators
  if (combinedContent.includes('course') || combinedContent.includes('learn') || 
      combinedContent.includes('education') || combinedContent.includes('tutorial') ||
      combinedContent.includes('training') || combinedContent.includes('lesson') ||
      combinedContent.includes('study') || combinedContent.includes('university')) {
    return 'education';
  }
  
  // Forum indicators
  if (combinedContent.includes('forum') || combinedContent.includes('discussion') || 
      combinedContent.includes('community') || combinedContent.includes('question') ||
      combinedContent.includes('answer') || combinedContent.includes('thread') ||
      combinedContent.includes('reply') || combinedContent.includes('comment')) {
    return 'forum';
  }
  
  // HTML content analysis (if available)
  if (html) {
    if (htmlLower.includes('class="product"') || htmlLower.includes('add to cart') ||
        htmlLower.includes('price') || htmlLower.includes('buy now')) {
      return 'product';
    }
    
    if (htmlLower.includes('video') || htmlLower.includes('<video') ||
        htmlLower.includes('youtube') || htmlLower.includes('vimeo')) {
      return 'video';
    }
    
    if (htmlLower.includes('article') || htmlLower.includes('blog') ||
        htmlLower.includes('post-content') || htmlLower.includes('entry-content')) {
      return 'blog';
    }
  }
  
  return 'other';
};

module.exports = {
  sleep,
  getRandomUserAgent,
  generateHeaders,
  formatLambdaResponse,
  calculateBackoffDelay,
  extractImages,
  extractMetadata,
  resolveUrl,
  isHtmlContent,
  classifyLinkType,
  fetchPlatformMetadata,
  needsPlatformFallback,
  mergeMetadata,
  needsBrowserFetch,
  fetchHtmlWithBrowser
};

/**
 * Determine if a URL should be fetched via a real browser
 * Useful for sites with WAF/bot protection (e.g., Blinkit)
 * @param {string} url
 * @returns {boolean}
 */
function needsBrowserFetch(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes('blinkit.com');
}

/**
 * Fetch page HTML using Playwright (Chromium) to mimic a real browser
 * @param {string} url
 * @returns {Promise<{status:number,statusText:string,headers:object,data:string}|null>}
 */
async function fetchHtmlWithBrowser(url) {
  try {
    let chromium;
    try {
      // Lazy-load to avoid crashing if dependency missing
      ({ chromium } = require('playwright'));
    } catch (_) {
      console.warn('Playwright not installed; browser fetch unavailable.');
      return null;
    }
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Allow some network activity to settle
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch (_) {}
    const html = await page.content();
    await browser.close();
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html; charset=UTF-8' },
      data: html
    };
  } catch (err) {
    console.warn('Browser fetch failed:', err?.message || err);
    return null;
  }
}

/**
 * Detect if URL is a YouTube link
 * @param {string} url
 * @returns {boolean}
 */
function isYouTubeUrl(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes('youtube.com') || u.includes('youtu.be');
}

/**
 * Detect if URL is a Spotify link
 * @param {string} url
 * @returns {boolean}
 */
function isSpotifyUrl(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes('spotify.com');
}

/**
 * Fetch platform-specific metadata via official oEmbed endpoints
 * Supports YouTube and Spotify.
 * @param {string} url
 * @returns {Promise<{title:string|null, description:string|null, images:{logo:string|null, ogImage:string|null, favicon:string|null, appleTouchIcon:string|null}}|null>}
 */
async function fetchPlatformMetadata(url) {
  try {
    // YouTube oEmbed
    if (isYouTubeUrl(url)) {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const { data } = await axios.get(oembedUrl, {
        timeout: 8000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': getRandomUserAgent()
        }
      });
      return {
        title: data.title || null,
        description: data.author_name ? `By ${data.author_name}` : null,
        images: {
          logo: null,
          ogImage: data.thumbnail_url || null,
          favicon: 'https://www.youtube.com/s/desktop/6f1c77b6/img/favicon_32x32.png',
          appleTouchIcon: null
        }
      };
    }

    // Spotify oEmbed
    if (isSpotifyUrl(url)) {
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
      const { data } = await axios.get(oembedUrl, {
        timeout: 8000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': getRandomUserAgent()
        }
      });
      return {
        title: data.title || null,
        description: data.author_name || null,
        images: {
          logo: null,
          ogImage: data.thumbnail_url || null,
          favicon: 'https://open.spotifycdn.com/cdn/images/favicon32.8bbb0783.png',
          appleTouchIcon: null
        }
      };
    }
  } catch (err) {
    console.log('Platform metadata fallback failed:', err.message);
    return null;
  }
  return null;
}

/**
 * Check if scraped metadata is generic and should be replaced by oEmbed data
 * @param {string} url
 * @param {{title:string|null, description:string|null, images:object}} metadata
 * @returns {boolean}
 */
function needsPlatformFallback(url, metadata) {
  if (!metadata) return true;
  const title = (metadata.title || '').toLowerCase();
  const description = (metadata.description || '').toLowerCase();

  if (isYouTubeUrl(url)) {
    const isGenericTitle = title === '- youtube' || title === 'youtube';
    const isGenericDesc = description.includes('enjoy the videos and music you love');
    const missingImage = !metadata.images?.ogImage;
    return isGenericTitle || isGenericDesc || missingImage;
  }

  if (isSpotifyUrl(url)) {
    const isGenericTitle = title.includes('spotify') && title.includes('web player');
    const missingImage = !metadata.images?.ogImage;
    return isGenericTitle || missingImage;
  }

  return false;
}

/**
 * Merge base metadata with override from platform-specific sources.
 * Replaces generic or missing fields; preserves existing meaningful values.
 * @param {{title:string|null, description:string|null, images:object}} base
 * @param {{title:string|null, description:string|null, images:object}} override
 * @param {string} url
 * @returns {{title:string|null, description:string|null, images:object}}
 */
function mergeMetadata(base, override, url = '') {
  const result = {
    title: base?.title || null,
    description: base?.description || null,
    images: {
      logo: base?.images?.logo || null,
      ogImage: base?.images?.ogImage || null,
      favicon: base?.images?.favicon || null,
      appleTouchIcon: base?.images?.appleTouchIcon || null
    }
  };

  if (!override) return result;

  // If platform is YouTube or Spotify and base title looks generic, override.
  if (isYouTubeUrl(url)) {
    const t = (result.title || '').toLowerCase();
    const isGenericTitle = t === '- youtube' || t === 'youtube';
    if (isGenericTitle || !result.title) {
      result.title = override.title ?? result.title;
    }
    const d = (result.description || '').toLowerCase();
    const isGenericDesc = d.includes('enjoy the videos and music you love');
    if (isGenericDesc || !result.description) {
      result.description = override.description ?? result.description;
    }
  }

  if (isSpotifyUrl(url)) {
    const t = (result.title || '').toLowerCase();
    const isGenericTitle = t.includes('spotify') && t.includes('web player');
    if (isGenericTitle || !result.title) {
      result.title = override.title ?? result.title;
    }
    if (!result.description) {
      result.description = override.description ?? result.description;
    }
  }

  // Fill missing images
  for (const key of ['ogImage', 'logo', 'favicon', 'appleTouchIcon']) {
    if (!result.images[key] && override.images?.[key]) {
      result.images[key] = override.images[key];
    }
  }

  return result;
}
