// app.js — Frontend Chatbot WhyNot

(function () {
  'use strict';

  // ── State ──
  const state = {
    messages: [],       // { role: 'user'|'assistant', content: string }
    fileContent: null,   // Konten teks file yang di-parse
    fileName: null,
    isStreaming: false,
  };

  // ── Elemen DOM ──
  const $ = (sel) => document.querySelector(sel);
  const chatArea = $('#chatArea');
  const messagesContainer = $('#messagesContainer');
  const welcomeScreen = $('#welcomeScreen');
  const chatInput = $('#chatInput');
  const sendBtn = $('#sendBtn');
  const uploadBtn = $('#uploadBtn');
  const fileInput = $('#fileInput');
  const filePreviewBar = $('#filePreviewBar');
  const filePreviewName = $('#filePreviewName');
  const filePreviewMeta = $('#filePreviewMeta');
  const fileRemoveBtn = $('#fileRemoveBtn');
  const dropZoneOverlay = $('#dropZoneOverlay');
  const modelName = $('#modelName');

  // ── Inisialisasi ──
  async function init() {
    await loadConfig();
    setupEventListeners();
    chatInput.focus();
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const config = await res.json();
      modelName.textContent = config.model || 'Unknown';
    } catch {
      modelName.textContent = 'Disconnected';
    }
  }

  // ── Event Listener ──
  function setupEventListeners() {
    // Kirim pesan
    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Ubah ukuran textarea otomatis
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
      sendBtn.disabled = chatInput.value.trim().length === 0 && !state.fileContent;
    });

    // Unggah file
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    fileRemoveBtn.addEventListener('click', removeFile);

    // Drag & drop
    const app = document.querySelector('.app');
    app.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZoneOverlay.classList.add('active');
    });
    app.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !app.contains(e.relatedTarget)) {
        dropZoneOverlay.classList.remove('active');
      }
    });
    app.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZoneOverlay.classList.remove('active');
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    });

    // Perbarui status tombol kirim
    chatInput.addEventListener('input', updateSendButton);
  }

  function updateSendButton() {
    sendBtn.disabled = (chatInput.value.trim().length === 0) && !state.fileContent;
  }

  // ── Penanganan File ──
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) uploadFile(file);
    fileInput.value = '';
  }

  async function uploadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'csv'].includes(ext)) {
      showToast('Format file tidak didukung. Gunakan PDF atau CSV.', 'error');
      return;
    }

    // Tampilkan loading
    const loading = document.createElement('div');
    loading.className = 'upload-loading';
    loading.innerHTML = '<div class="spinner"></div><span>Membaca file...</span>';
    document.body.appendChild(loading);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload gagal');
      }

      // Simpan konten file
      state.fileContent = data.content;
      state.fileName = data.filename;

      // Tampilkan pratinjau file
      filePreviewName.textContent = data.filename;
      if (data.type === 'pdf') {
        filePreviewMeta.textContent = `PDF · ${data.meta.pages} halaman`;
      } else {
        filePreviewMeta.textContent = `CSV · ${data.meta.rows} baris · ${data.meta.columns.length} kolom`;
      }
      filePreviewBar.classList.add('active');
      updateSendButton();

      showToast(`File "${data.filename}" berhasil dimuat!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      loading.remove();
    }
  }

  function removeFile() {
    state.fileContent = null;
    state.fileName = null;
    filePreviewBar.classList.remove('active');
    updateSendButton();
  }

  // ── Chat ──
  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text && !state.fileContent) return;
    if (state.isStreaming) return;

    // Sembunyikan layar selamat datang
    if (welcomeScreen) {
      welcomeScreen.style.display = 'none';
    }

    // Buat pesan pengguna
    let userDisplay = text;
    if (state.fileContent && !text) {
      userDisplay = `📎 ${state.fileName} — Analisis file ini`;
    } else if (state.fileContent && text) {
      userDisplay = `📎 ${state.fileName}\n\n${text}`;
    }

    // Tambahkan pesan pengguna ke state
    const userMsg = { role: 'user', content: text || 'Tolong analisis data keuangan yang saya upload' };
    state.messages.push(userMsg);

    // Tampilkan pesan pengguna
    appendMessage('user', userDisplay);

    // Kosongkan input
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendBtn.disabled = true;

    // Tampilkan indikator mengetik
    const typingEl = appendTypingIndicator();

    // Stream respons
    state.isStreaming = true;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: state.messages,
          fileContent: state.fileContent,
        }),
      });

      // Hapus indikator mengetik
      typingEl.remove();

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Terjadi kesalahan');
      }

      // Buat gelembung pesan asisten
      const assistantBubble = appendMessage('assistant', '');
      const bubbleContent = assistantBubble.querySelector('.message-bubble');
      let fullContent = '';

      // Parse stream SSE
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            // Periksa error dalam stream
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              bubbleContent.innerHTML = renderMarkdown(fullContent);
              scrollToBottom();
            }
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) {
              throw e;
            }
          }
        }
      }

      // Simpan pesan asisten
      state.messages.push({ role: 'assistant', content: fullContent });

      // Hapus file setelah pesan pertama dengan file
      if (state.fileContent) {
        removeFile();
      }
    } catch (err) {
      typingEl.remove();
      showToast(err.message, 'error');
      // Hapus pesan pengguna yang gagal dari state
      state.messages.pop();
    } finally {
      state.isStreaming = false;
      updateSendButton();
    }
  }

  // ── Bantuan UI ──
  function appendMessage(role, content) {
    const msg = document.createElement('div');
    msg.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '💰';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = role === 'user' ? escapeHtml(content).replace(/\n/g, '<br>') : renderMarkdown(content);

    contentDiv.appendChild(bubble);
    msg.appendChild(avatar);
    msg.appendChild(contentDiv);
    messagesContainer.appendChild(msg);

    scrollToBottom();
    return msg;
  }

  function appendTypingIndicator() {
    const msg = document.createElement('div');
    msg.className = 'message assistant';
    msg.innerHTML = `
      <div class="message-avatar">💰</div>
      <div class="message-content">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    messagesContainer.appendChild(msg);
    scrollToBottom();
    return msg;
  }

  function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ── Markdown Renderer (ringan) ──
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Blok kode
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Kode sebaris
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Header
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Tebal
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Miring
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Garis pemisah
    html = html.replace(/^---$/gm, '<hr>');
    // Daftar tidak berurutan
    html = html.replace(/^[*\-•]\s+(.+)$/gm, '<li class="ul-item">$1</li>');
    html = html.replace(/(?:<li class="ul-item">.*<\/li>(?:\n+|$))+/g, match => {
      const trailing = match.match(/\n*$/)[0];
      const items = match.slice(0, match.length - trailing.length).replace(/\n/g, '');
      return '<ul>' + items + '</ul>' + trailing;
    });

    // Daftar berurutan
    html = html.replace(/^\d+[.)]\s+(.+)$/gm, '<li class="ol-item">$1</li>');
    html = html.replace(/(?:<li class="ol-item">.*<\/li>(?:\n+|$))+/g, match => {
      const trailing = match.match(/\n*$/)[0];
      const items = match.slice(0, match.length - trailing.length).replace(/\n/g, '');
      return '<ol>' + items + '</ol>' + trailing;
    });

    // Hapus penanda kelas sementara
    html = html.replace(/ class="(ul|ol)-item"/g, '');

    // Tabel (dasar)
    html = html.replace(/^\|(.+)\|$/gm, (match, content) => {
      const cells = content.split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return '';
      const tag = 'td';
      return '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
    });
    html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>');
    // Paragraf (baris baru ganda)
    html = html.replace(/\n\n+/g, '</p><p>');
    // Baris baru tunggal dalam paragraf
    html = html.replace(/\n/g, '<br>');
    // Bungkus dalam paragraf
    html = '<p>' + html + '</p>';
    // Bersihkan paragraf kosong
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[1-3]>)/g, '$1');
    html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul.*?>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ol.*?>)/g, '$1');
    html = html.replace(/(<\/ol>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<table>)/g, '$1');
    html = html.replace(/(<\/table>)<\/p>/g, '$1');
    html = html.replace(/<p>(<hr>)<\/p>/g, '$1');

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Mulai ──
  init();
})();
