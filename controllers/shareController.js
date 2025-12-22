const crypto = require('crypto');

const store = new Map();
const TTL_MS = 10 * 60 * 1000;

const extractFirstUrl = (input) => {
  if (typeof input !== 'string' || !input.trim()) return undefined;
  const match = input.match(/https?:\/\/[^\s]+/i);
  if (!match || !match[0]) return undefined;
  let url = match[0].replace(/[)\].,;]+$/, '');
  try {
    const up = url.match(/[?&]u=([^&]+)/);
    if (up && up[1]) {
      const decoded = decodeURIComponent(up[1]);
      if (decoded.startsWith('http')) url = decoded;
    }
  } catch {}
  return url;
};

class ShareController {
  async create(req, res) {
    try {
      const { text, webUrl, parts, files, subject, title } = req.body || {};
      console.log('[create] incoming body:', { text, webUrl, parts, files, subject, title });
      const arr = [];
      if (typeof webUrl === 'string') arr.push(webUrl);
      if (typeof text === 'string') arr.push(text);
      if (typeof subject === 'string') arr.push(subject);
      if (typeof title === 'string') arr.push(title);
      if (Array.isArray(parts)) {
        arr.push(...parts.map((x) => (typeof x === 'string' ? x : '')));
      }
      const combined = arr.filter(Boolean).join(' ');
      const url = extractFirstUrl(combined);
      const hasFiles = Array.isArray(files) && files.length > 0;
      const token = crypto.randomBytes(16).toString('hex');
      store.set(token, { url: url || null, raw: combined, files: hasFiles ? files : [], expiresAt: Date.now() + TTL_MS });
      console.log('[create] stored data:', { url: url || null, raw: combined, files: hasFiles ? files : [], expiresAt: Date.now() + TTL_MS });
      return res.status(200).json({ success: true, data: { token } });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to create share token', error: error.message });
    }
  }

  async get(req, res) {
    try {
      const { token } = req.params;
      if (!token || !store.has(token)) {
        return res.status(404).json({ success: false, message: 'Invalid or expired token' });
      }
      const item = store.get(token);
      if (!item || item.expiresAt <= Date.now()) {
        store.delete(token);
        return res.status(404).json({ success: false, message: 'Invalid or expired token' });
      }
      console.log('[get] sending data:', { url: item.url, rawText: item.raw, files: item.files || [] });
      return res.status(200).json({ success: true, data: { url: item.url, rawText: item.raw, files: item.files || [] } });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to get shared link', error: error.message });
    }
  }
}

module.exports = new ShareController();
