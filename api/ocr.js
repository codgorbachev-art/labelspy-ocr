'use strict';

const https = require('https');

function jsonResponse(statusCode, bodyObj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    },
    body: JSON.stringify(bodyObj)
  };
}

function buildCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function postJson(url, payload, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(payload);
    const req = https.request({
      method: 'POST',
      protocol: u.protocol,
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        const status = res.statusCode || 0;
        const ct = (res.headers['content-type'] || '').toString();
        if (ct.includes('application/json')) {
          try {
            resolve({ status, json: JSON.parse(chunks || '{}'), raw: chunks });
          } catch (e) {
            resolve({ status, json: null, raw: chunks });
          }
        } else {
          resolve({ status, json: null, raw: chunks });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Upstream timeout'));
    });
    req.write(data);
    req.end();
  });
}

function extractTextFromOcrResponse(resp) {
  const ta = resp?.textAnnotation || null;
  if (!ta) return '';
  const blocks = Array.isArray(ta.blocks) ? ta.blocks : [];
  const lines = [];
  for (const b of blocks) {
    const ls = Array.isArray(b.lines) ? b.lines : [];
    for (const l of ls) {
      if (l && typeof l.text === 'string') {
        lines.push(l.text);
      }
    }
    if (ls.length) lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = async (req, res) => {
  const cors = buildCorsHeaders(req.headers.origin || '');
  
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
    res.status(500).json({ error: 'YANDEX_API_KEY is not configured' });
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
      'x-data-logging-enabled': 'false'
    };

    const upstream = await postJson(url, payload, headers, 20000);
    
    if (upstream.status < 200 || upstream.status >= 300) {
      res.status(502).json({
        error: 'Yandex Vision OCR request failed',
        status: upstream.status,
        details: upstream.json || upstream.raw
      });
      return;
    }

    const text = extractTextFromOcrResponse(upstream.json);
    res.status(200).json({ text });
  } catch (e) {
    res.status(502).json({
      error: 'Yandex Vision OCR request error',
      details: String(e?.message || e)
    });
  }
};
