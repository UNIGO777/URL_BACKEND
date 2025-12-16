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
      const { text, webUrl, parts } = req.body || {};
      const arr = [];
      if (typeof webUrl === 'string') arr.push(webUrl);
      if (typeof text === 'string') arr.push(text);
      if (Array.isArray(parts)) {
        arr.push(...parts.map((x) => (typeof x === 'string' ? x : '')));
      }
      const combined = arr.filter(Boolean).join(' ');
      const url = extractFirstUrl(combined);
      if (!url) {
        return res.status(400).json({ success: false, message: 'No URL found in shared content' });
      }
      const token = crypto.randomBytes(16).toString('hex');
      store.set(token, { url, raw: combined, expiresAt: Date.now() + TTL_MS });
      console.log(token, url, combined)
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
      return res.status(200).json({ success: true, data: { url: item.url, rawText: item.raw } });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to get shared link', error: error.message });
    }
  }
}

module.exports = new ShareController();
