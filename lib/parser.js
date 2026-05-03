// lib/parser.js — Pemrosesan file PDF & CSV

const pdfParse = require('pdf-parse');
const { parse } = require('csv-parse/sync');

/**
 * Melakukan parsing buffer PDF menjadi konten teks.
 * @param {Buffer} buffer - Buffer file PDF
 * @returns {Promise<{text: string, pages: number}>}
 */
async function parsePDF(buffer) {
  try {
    const data = await pdfParse(buffer);

    if (!data.text || data.text.trim().length === 0) {
      throw new Error(
        'Tidak dapat mengekstrak teks dari PDF ini. ' +
        'Kemungkinan PDF ini berupa hasil scan/gambar. ' +
        'Untuk saat ini, WhyNot hanya mendukung PDF berbasis teks (e-statement digital).'
      );
    }

    return {
      text: data.text.trim(),
      pages: data.numpages,
    };
  } catch (err) {
    if (err.message.includes('Tidak dapat mengekstrak')) {
      throw err;
    }
    throw new Error(`Gagal membaca file PDF: ${err.message}`);
  }
}

/**
 * Melakukan parsing buffer CSV menjadi representasi teks terformat.
 * @param {Buffer} buffer - Buffer file CSV
 * @returns {{text: string, rows: number, columns: string[]}}
 */
function parseCSV(buffer) {
  try {
    const content = buffer.toString('utf-8');

    // Coba mendeteksi pembatas secara otomatis (koma, titik koma, tab)
    const firstLine = content.split('\n')[0];
    let delimiter = ',';
    if (firstLine.includes(';') && !firstLine.includes(',')) {
      delimiter = ';';
    } else if (firstLine.includes('\t') && !firstLine.includes(',')) {
      delimiter = '\t';
    }

    const records = parse(content, {
      delimiter,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    if (records.length === 0) {
      throw new Error('File CSV kosong atau tidak memiliki data yang valid.');
    }

    const columns = Object.keys(records[0]);

    // Format sebagai teks tabel yang mudah dibaca oleh LLM
    let text = `=== DATA CSV (${records.length} baris, ${columns.length} kolom) ===\n`;
    text += `Kolom: ${columns.join(' | ')}\n`;
    text += '---\n';

    // Sertakan semua baris (LLM dapat menangani konteksnya)
    // Namun batasi hingga 500 baris untuk menghindari kelebihan token
    const maxRows = Math.min(records.length, 500);
    for (let i = 0; i < maxRows; i++) {
      const row = records[i];
      text += columns.map(col => row[col] || '').join(' | ') + '\n';
    }

    if (records.length > maxRows) {
      text += `\n... (${records.length - maxRows} baris lainnya tidak ditampilkan)\n`;
    }

    return {
      text,
      rows: records.length,
      columns,
    };
  } catch (err) {
    if (err.message.includes('CSV kosong')) {
      throw err;
    }
    throw new Error(`Gagal membaca file CSV: ${err.message}`);
  }
}

/**
 * Melakukan parsing file berdasarkan mimetype-nya.
 * @param {Buffer} buffer - Buffer file
 * @param {string} mimetype - Tipe MIME file
 * @param {string} originalname - Nama asli file
 * @returns {Promise<{text: string, type: string, meta: object}>}
 */
async function parseFile(buffer, mimetype, originalname) {
  const ext = originalname.toLowerCase().split('.').pop();

  if (mimetype === 'application/pdf' || ext === 'pdf') {
    const result = await parsePDF(buffer);
    return {
      text: result.text,
      type: 'pdf',
      meta: { pages: result.pages, filename: originalname },
    };
  }

  if (
    mimetype === 'text/csv' ||
    mimetype === 'application/vnd.ms-excel' ||
    ext === 'csv'
  ) {
    const result = parseCSV(buffer);
    return {
      text: result.text,
      type: 'csv',
      meta: { rows: result.rows, columns: result.columns, filename: originalname },
    };
  }

  throw new Error(
    `Format file tidak didukung: ${mimetype || ext}. ` +
    'WhyNot saat ini mendukung file PDF dan CSV.'
  );
}

module.exports = { parsePDF, parseCSV, parseFile };
