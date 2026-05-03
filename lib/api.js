// lib/api.js — Klien API yang kompatibel dengan OpenAI dengan dukungan streaming

/**
 * Mengirim permintaan chat completion ke endpoint yang kompatibel dengan OpenAI.
 * Mendukung streaming melalui SSE.
 *
 * @param {object} options
 * @param {Array} options.messages - Array pesan chat
 * @param {boolean} [options.stream=true] - Aktifkan streaming
 * @returns {Promise<Response>} Respons fetch mentah (untuk streaming) atau JSON yang di-parse
 */
async function chatCompletion({ messages, stream = true }) {
  const endpoint = process.env.API_ENDPOINT || 'https://api.openai.com/v1';
  const model = process.env.MODEL || 'gpt-4o';
  const apiKey = process.env.API_KEY;

  if (!apiKey || apiKey === 'sk-your-api-key-here') {
    throw new Error('API_KEY belum dikonfigurasi. Silakan atur di file .env');
  }

  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  const body = {
    model,
    messages,
    stream,
  };

  // Tambahkan stream_options untuk pelacakan penggunaan saat streaming
  if (stream) {
    body.stream_options = { include_usage: true };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  // Beberapa provider (OpenRouter) menggunakan header tambahan
  if (endpoint.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'http://localhost:3000';
    headers['X-Title'] = 'WhyNot Chatbot';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMessage;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.error?.message || errorBody.message || JSON.stringify(errorBody);
    } catch {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(`API Error: ${errorMessage}`);
  }

  return response;
}

/**
 * Melakukan parsing stream SSE dari respons API.
 * Menghasilkan string delta konten.
 *
 * @param {ReadableStream} body - Stream dari body respons
 * @yields {string} Potongan konten
 */
async function* parseSSEStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield delta;
          }
        } catch {
          // Lewati potongan JSON yang formatnya tidak valid
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

module.exports = { chatCompletion, parseSSEStream };
