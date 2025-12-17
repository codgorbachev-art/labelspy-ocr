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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    res.status(500).json({ error: 'API key not configured' });
    return;
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
  }

  const { text, mode = 'analyze' } = body;
  if (!text) {
    res.status(400).json({ error: 'text required' });
    return;
  }

  try {
    if (mode === 'recipes') {
      const result = await callGemini(apiKey, `Based on this product, suggest 3-5 creative recipes as JSON only: {"recipes": [{"name": "name", "type": "cocktail|dish|beverage", "description": "desc", "ingredients": [], "steps": []}]}. Product: ${text}`);
      res.status(200).json(result);
    } else {
      const result = await callGemini(apiKey, `Analyze this product composition. Return JSON only: {"productName": "name", "verdict": "verdict", "riskLevel": "safe|moderate|high", "highlights": ["E-code with description"], "allergens": [], "features": [], "advice": "tip"}. Composition: ${text}`);
      res.status(200).json(result);
    }
  } catch (e) {
    console.error('Gemini error:', e.message);
    res.status(502).json({ error: e.message });
  }
};

function callGemini(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    url.searchParams.set('key', apiKey);

    const data = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048
      }
    });

    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + '?' + url.searchParams.toString(),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'Gemini error'));
            return;
          }
          const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!content) {
            reject(new Error('No content in response'));
            return;
          }
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('No JSON in response'));
            return;
          }
          try {
            const result = JSON.parse(jsonMatch[0]);
            resolve(result);
          } catch (e) {
            reject(new Error('JSON parse: ' + e.message));
          }
        } catch (e) {
          reject(new Error('Response parse: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(data);
    req.end();
  });
}
