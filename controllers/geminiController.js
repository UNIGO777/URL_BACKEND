const cheerio = require('cheerio');
const lambdaController = require('./lambdaController');
const { GEMINI_MODEL, MESSAGES } = require('../config/constants');
const { getGeminiModel } = require('../utils/geminiClient');

class GeminiController {
  async generate(req, res) {
    try {
      const { prompt } = req.body;
      console.log("ajsdh")
      if (!prompt) {
        return res.status(400).json({ success: false, message: 'Missing required parameter: prompt' });
      }
      const model = getGeminiModel(GEMINI_MODEL);
      const result = await model.generateContent(prompt);
      const text = result?.response?.text?.() || result?.response?.text || '';
      return res.status(200).json({ success: true, data: { model: GEMINI_MODEL, text } });
    } catch (error) {
      console.error('Gemini generate error:', error.message);
      return res.status(500).json({ success: false, message: 'Gemini request failed', error: error.message });
    }
  }

  async generateGet(req, res) {
    try {
      const { prompt } = req.query;
      if (!prompt) {
        return res.status(400).json({ success: false, message: 'Missing required parameter: prompt' });
      }
      const model = getGeminiModel(GEMINI_MODEL);
      const result = await model.generateContent(prompt);
      const text = result?.response?.text?.() || result?.response?.text || '';
      return res.status(200).json({ success: true, data: { model: GEMINI_MODEL, text } });
    } catch (error) {
      console.error('Gemini generateGet error:', error.message);
      return res.status(500).json({ success: false, message: 'Gemini request failed', error: error.message });
    }
  }

  async summarizeUrl(req, res) {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ success: false, message: MESSAGES.MISSING_URL });
      }
      const result = await lambdaController.executeWithRetry(url, 'GET');
      let contentText = '';
      if (typeof result.data === 'string') {
        const $ = cheerio.load(result.data);
        contentText = $('body').text().replace(/\s+/g, ' ').trim();
      } else if (typeof result.data === 'object') {
        contentText = JSON.stringify(result.data);
      }
      const prompt = `Summarize the following webpage content in 5-7 bullet points. Focus on primary purpose, key features, and any calls-to-action.\n\nURL: ${url}\n\nContent:\n${contentText.slice(0, 12000)}`;
      const model = getGeminiModel(GEMINI_MODEL);
      const aiResult = await model.generateContent(prompt);
      const summary = aiResult?.response?.text?.() || aiResult?.response?.text || '';
      return res.status(200).json({ success: true, data: { url, model: GEMINI_MODEL, status: result.status, summary } });
    } catch (error) {
      console.error('Gemini summarizeUrl error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to summarize URL', error: error.message });
    }
  }

  async analyzeUrl(req, res) {
    try {
      const { url, prompt } = req.body;
      if (!url) {
        return res.status(400).json({ success: false, message: MESSAGES.MISSING_URL });
      }
      if (!prompt) {
        return res.status(400).json({ success: false, message: 'Missing required parameter: prompt' });
      }
      const result = await lambdaController.executeWithRetry(url, 'GET');
      let contentText = '';
      if (typeof result.data === 'string') {
        const $ = cheerio.load(result.data);
        contentText = $('body').text().replace(/\s+/g, ' ').trim();
      } else if (typeof result.data === 'object') {
        contentText = JSON.stringify(result.data);
      }
      const combinedPrompt = `${prompt}\n\nURL: ${url}\nContent:\n${contentText.slice(0, 12000)}`;
      const model = getGeminiModel(GEMINI_MODEL);
      const aiResult = await model.generateContent(combinedPrompt);
      const output = aiResult?.response?.text?.() || aiResult?.response?.text || '';
      return res.status(200).json({ success: true, data: { url, model: GEMINI_MODEL, output } });
    } catch (error) {
      console.error('Gemini analyzeUrl error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to analyze URL', error: error.message });
    }
  }
}

module.exports = new GeminiController();