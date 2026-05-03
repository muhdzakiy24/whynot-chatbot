// server.js — WhyNot Chatbot Express Server

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getSystemPrompt } = require('./lib/prompt');
const { chatCompletion, parseSSEStream } = require('./lib/api');
const { parseFile } = require('./lib/parser');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE, 10) || 10) * 1024 * 1024;

// Pastikan direktori uploads ada
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Konfigurasi multer untuk unggahan file
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
    ];
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (allowed.includes(file.mimetype) || ['pdf', 'csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Gunakan PDF atau CSV.'));
    }
  },
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

/**
 * GET /api/config
 * Mengembalikan konfigurasi non-sensitif untuk frontend.
 */
app.get('/api/config', (_req, res) => {
  res.json({
    model: process.env.MODEL || 'gpt-4o',
    maxFileSize: MAX_FILE_SIZE,
    hasCustomPrompt: !!(process.env.CUSTOM_PROMPT && process.env.CUSTOM_PROMPT.trim()),
  });
});

/**
 * POST /api/upload
 * Menangani unggahan file PDF/CSV, mem-parsing ke teks, dan mengembalikan konten.
 * File segera dihapus setelah di-parsing (ephemeral).
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang diupload.' });
  }

  const filePath = req.file.path;

  try {
    const buffer = fs.readFileSync(filePath);
    const result = await parseFile(buffer, req.file.mimetype, req.file.originalname);

    res.json({
      success: true,
      filename: req.file.originalname,
      type: result.type,
      meta: result.meta,
      content: result.text,
    });
  } catch (err) {
    res.status(422).json({ error: err.message });
  } finally {
    // Selalu bersihkan file yang diunggah
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Abaikan error pembersihan
    }
  }
});

/**
 * POST /api/chat
 * Melakukan proxy pesan chat ke endpoint LLM yang dikonfigurasi.
 * Mengalirkan respons kembali via SSE.
 *
 * Body: { messages: [{role, content}], fileContent?: string }
 */
app.post('/api/chat', async (req, res) => {
  const { messages, fileContent } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required.' });
  }

  // Bangun array messages lengkap dengan prompt sistem
  const systemPrompt = getSystemPrompt();
  const fullMessages = [
    { role: 'system', content: systemPrompt },
  ];

  // Jika ada konten file, suntikkan sebagai konteks sebelum percakapan
  if (fileContent) {
    fullMessages.push({
      role: 'user',
      content: `[Data Keuangan yang Diupload]\n\n${fileContent}`,
    });
    fullMessages.push({
      role: 'assistant',
      content: 'Terima kasih, saya sudah menerima data keuanganmu. Saya akan menganalisisnya. Ada yang ingin kamu tanyakan secara spesifik, atau mau saya buat ringkasan umum dulu?',
    });
  }

  // Tambahkan pesan percakapan
  fullMessages.push(...messages);

  // Atur header SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const apiResponse = await chatCompletion({
      messages: fullMessages,
      stream: true,
    });

    // Alirkan stream SSE dari API ke client
    const reader = apiResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    // Jika header belum dikirim, kirim error sebagai JSON
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      // Jika tidak, kirim error via SSE
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ──────────────────────────────────────────────
// Penanganan error
// ──────────────────────────────────────────────

// Penanganan error Multer
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File terlalu besar. Maksimal ${process.env.MAX_FILE_SIZE || 10}MB.`,
      });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// Mulai server
// ──────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('  ╦ ╦┬ ┬┬ ┬╔╗╔┌─┐┌┬┐  ╔═╗┬ ┬┌─┐┌┬┐┌┐ ┌─┐┌┬┐');
  console.log('  ║║║├─┤└┬┘║║║│ │ │   ║  ├─┤├─┤ │ ├┴┐│ │ │ ');
  console.log('  ╚╩╝┴ ┴ ┴ ╝╚╝└─┘ ┴   ╚═╝┴ ┴┴ ┴ ┴ └─┘└─┘ ┴ ');
  console.log('');
  console.log(`  🚀 Server berjalan di http://localhost:${PORT}`);
  console.log(`  📊 Model: ${process.env.MODEL || 'gpt-4o'}`);
  console.log(`  🔗 Endpoint: ${process.env.API_ENDPOINT || 'https://api.openai.com/v1'}`);
  console.log(`  📎 Max Upload: ${process.env.MAX_FILE_SIZE || 10}MB`);
  if (process.env.CUSTOM_PROMPT && process.env.CUSTOM_PROMPT.trim()) {
    console.log('  ⚙️  Custom Prompt: Aktif');
  }
  console.log('');
});
