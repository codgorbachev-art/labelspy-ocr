'use strict';

const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const body = req.body || {};
  const apiKey = process.env.YANDEX_API_KEY;
  
  if (!apiKey) {
    console.error('[OCR] ERROR: YANDEX_API_KEY not set');
    res.status(500).json({ error: 'YANDEX_API_KEY is not configured on server' });
    return;
  }

  const image = (body.image || '').trim();
  const mimeType = (body.mimeType || 'JPEG').toString().trim().toUpperCase();
  const languageCodes = Array.isArray(body.languageCodes) ? body.languageCodes : ['ru', 'en'];
  const model = (body.model || 'page').toString().trim();

  if (!image) {
    res.status(400).json({ error: 'image (base64) is required' });
    return;
  }

  console.log(`[OCR] Processing image (${image.length} bytes base64)`);

  try {
    const payload = {
      mimeType,
      languageCodes,
      model,
      content: image
    };

    const url = 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText';
    const headers = {
      'Authorization': `Api-Key ${apiKey}`,
      'x-data-logging-enabled': 'false',
      'Content-Type': 'application/json'
    };

    const response = await makeRequest(url, payload, headers);
    
    console.log(`[OCR] Response status: ${response.status}`);
    console.log(`[OCR] Response keys:`, Object.keys(response.json || {}));

    if (response.status < 200 || response.status >= 300) {
      console.error('[OCR] API error:', response.json || response.raw);
      res.status(502).json({
        error: 'Yandex Vision API error',
        status: response.status,
        details: response.json?.error || response.raw
      });
      return;
    }

    const text = extractText(response.json);
    console.log(`[OCR] Extracted text length: ${text.length}`);
    
    if (!text) {
      console.warn('[OCR] WARNING: No text extracted from response');
      res.status(400).json({
        error: 'No text could be recognized in image',
        debug: {
          hasTextAnnotation: !!response.json?.textAnnotation,
          responseKeys: Object.keys(response.json || {})
        }
      });
      return;
    }

    res.status(200).json({ text });
  } catch (e) {
    console.error('[OCR] Exception:', e.message);
    res.status(502).json({
      error: 'OCR request failed',
      details: e.message
    });
  }
};

function makeRequest(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(payload);

    const req = https.request({
      method: 'POST',
      protocol: u.protocol,
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: 30000
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        const status = res.statusCode || 0;
        const ct = (res.headers['content-type'] || '').toString();
        let json = null;
        
        if (ct.includes('application/json')) {
          try {
            json = JSON.parse(chunks || '{}');
          } catch (e) {
            console.error('[Request] JSON parse error:', e.message);
          }
        }
        
        resolve({ status, json, raw: chunks });
      });
    });

    req.on('error', (e) => {
      console.error('[Request] Error:', e.message);
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout (30s)'));
    });

    req.write(data);
    req.end();
  });
}

function extractText(resp) {
  if (!resp) return '';

  // Yandex Vision API structure
  const ta = resp.textAnnotation || resp.result?.textAnnotation || null;
  
  if (!ta || !ta.blocks) {
    return '';
  }

  const blocks = Array.isArray(ta.blocks) ? ta.blocks : [];
  const lines = [];

  for (const block of blocks) {
    const blockLines = Array.isArray(block.lines) ? block.lines : [];
    for (const line of blockLines) {
      if (line && Array.isArray(line.words)) {
        const words = line.words.map(w => w.text || '').filter(Boolean);
        if (words.length > 0) {
          lines.push(words.join(' '));
        }
      } else if (line && typeof line.text === 'string') {
        lines.push(line.text);
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
