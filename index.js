require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// ===== CONFIG =====
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SEED_SHEET_NAME = process.env.SEED_SHEET_NAME || 'SEED';
const TZ = process.env.TZ || 'Asia/Jakarta';

// Google Service Account credentials
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// In-memory storage untuk undo (bisa diganti dengan file/database)
const userLastActions = {};

// ===== INIT BOT =====
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log('🤖 Bot started successfully!');

// ===== GOOGLE SHEETS HELPERS =====
async function getSheet() {
   // Create JWT auth client untuk google-spreadsheet v4
   const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
   });

   const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
   await doc.loadInfo();
   return doc;
}

function getMonthSheetName() {
   const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
   const now = new Date();
   const m = now.getMonth();
   const yy = String(now.getFullYear()).slice(-2);
   return `${bulan[m]}${yy}`;
}

async function getOrCreateMonthSheet(doc, sheetName) {
   let sheet = doc.sheetsByTitle[sheetName];
   if (sheet) return sheet;

   // Cari seed sheet
   const seedSheet = doc.sheetsByTitle[SEED_SHEET_NAME];
   if (!seedSheet) {
      throw new Error(`Seed sheet tidak ditemukan: ${SEED_SHEET_NAME}`);
   }

   // Duplicate seed sheet
   sheet = await seedSheet.duplicate({ title: sheetName });

   // Hapus data contoh (baris 2 dst)
   await sheet.loadCells();
   const rows = await sheet.getRows();
   if (rows.length > 0) {
      for (const row of rows) {
         await row.delete();
      }
   }

   return sheet;
}

function getNextNo(rows) {
   if (rows.length === 0) return 1;

   const lastRow = rows[rows.length - 1];
   const lastNo = parseInt(lastRow.get('No') || lastRow._rawData[0]);

   if (!isNaN(lastNo) && lastNo > 0) return lastNo + 1;
   return rows.length + 1;
}

// ===== FORMAT HELPERS =====
function parseAdd(text) {
   const raw = text.slice(4).trim(); // setelah "/add"
   const parts = raw
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);

   if (parts.length < 3) return { ok: false };

   const aplikasi = parts[0];
   const jenis = parts[1];
   const laba = parseIDR(parts[2]);

   if (!aplikasi || !jenis || !isFinite(laba) || laba <= 0) {
      return { ok: false };
   }

   return { ok: true, aplikasi, jenis, laba };
}

function parseIDR(s) {
   const cleaned = String(s).replace(/\s/g, '').replace(/rp/gi, '').replace(/\./g, '').replace(/,/g, '.');
   return Math.round(Number(cleaned));
}

function formatIDR(n) {
   return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function formatDate(date = new Date()) {
   const d = String(date.getDate()).padStart(2, '0');
   const m = String(date.getMonth() + 1).padStart(2, '0');
   const y = date.getFullYear();
   return `${d}/${m}/${y}`;
}

// ===== BOT COMMANDS =====

// /start
bot.onText(/\/start/, (msg) => {
   const chatId = msg.chat.id;
   const helpText = `Perintah:
/add Aplikasi | Jenis | Laba
/today - Transaksi hari ini
/yesterday - Transaksi kemarin
/list - Semua transaksi
/summary - Ringkasan per aplikasi
/edit <nomor> <field> <value>
/undo
/delete <nomor>
/help - Tampilkan bantuan

Contoh:
/add Capcut | 1 bulan | 8000
/edit 3 laba 10000
/delete 3`;

   bot.sendMessage(chatId, helpText);
});

// /help
bot.onText(/\/help/, (msg) => {
   const chatId = msg.chat.id;
   const helpText = `Perintah:
/add Aplikasi | Jenis | Laba
/today - Transaksi hari ini
/yesterday - Transaksi kemarin
/list - Semua transaksi
/summary - Ringkasan per aplikasi
/edit <nomor> <field> <value>
/undo
/delete <nomor>
/help - Tampilkan bantuan ini

Contoh:
/add Capcut | 1 bulan | 8000
/edit 3 laba 10000
/delete 3`;

   bot.sendMessage(chatId, helpText);
});

// /add
bot.onText(/\/add (.+)/, async (msg, match) => {
   const chatId = msg.chat.id;
   const userId = msg.from.id;
   const text = msg.text;

   try {
      const parsed = parseAdd(text);

      if (!parsed.ok) {
         return bot.sendMessage(chatId, 'Format salah.\nPakai:\n/add Aplikasi | Jenis | Laba\nContoh: /add Canva | lifetime | 15000');
      }

      // Get Google Sheet
      const doc = await getSheet();
      const sheetName = SEED_SHEET_NAME; // Pakai sheet Bot langsung
      const sheet = doc.sheetsByTitle[sheetName];

      if (!sheet) {
         throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
      }

      // Get existing rows
      const rows = await sheet.getRows();
      const nextNo = getNextNo(rows);
      const tanggal = formatDate();

      // Add new row
      await sheet.addRow({
         No: nextNo,
         Tanggal: tanggal,
         Aplikasi: parsed.aplikasi,
         Jenis: parsed.jenis,
         Laba: parsed.laba,
      });

      // Save untuk undo
      userLastActions[userId] = {
         sheetName: sheetName,
         rowNo: nextNo,
      };

      bot.sendMessage(chatId, `✅ Tercatat (${sheetName}) #${nextNo}\n${tanggal}\n${parsed.aplikasi} | ${parsed.jenis} | ${formatIDR(parsed.laba)}`);
   } catch (error) {
      console.error('Error adding row:', error);
      bot.sendMessage(chatId, '❌ Gagal menambahkan data. Error: ' + error.message);
   }
});

// /today
bot.onText(/\/today/, async (msg) => {
   const chatId = msg.chat.id;

   try {
      const doc = await getSheet();
      const sheetName = SEED_SHEET_NAME; // Pakai sheet Bot langsung
      const sheet = doc.sheetsByTitle[sheetName];

      if (!sheet) {
         throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
      }

      const today = formatDate();
      const rows = await sheet.getRows();

      let total = 0;
      const lines = [];

      for (const row of rows) {
         const tanggal = row.get('Tanggal');
         if (tanggal !== today) continue;

         const no = row.get('No') || row._rawData[0];
         const app = row.get('Aplikasi') || row._rawData[2];
         const jenis = row.get('Jenis') || row._rawData[3];
         const laba = parseIDR(row.get('Laba') || row._rawData[4]);

         total += laba;
         lines.push(`#${no} ${app} | ${jenis} | ${formatIDR(laba)}`);
      }

      if (lines.length === 0) {
         return bot.sendMessage(chatId, `Belum ada transaksi hari ini (${today}) di tab ${sheetName}.`);
      }

      bot.sendMessage(chatId, `📌 Hari ini (${today}) [${sheetName}]\n${lines.join('\n')}\n\nTotal: ${formatIDR(total)}`);
   } catch (error) {
      console.error('Error getting today:', error);
      bot.sendMessage(chatId, '❌ Gagal mengambil data. Error: ' + error.message);
   }
});

// /yesterday
bot.onText(/\/yesterday/, async (msg) => {
   const chatId = msg.chat.id;

   try {
      const doc = await getSheet();
      const sheetName = SEED_SHEET_NAME;
      const sheet = doc.sheetsByTitle[sheetName];

      if (!sheet) {
         throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
      }

      // Calculate yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = formatDate(yesterday);

      const rows = await sheet.getRows();

      let total = 0;
      const lines = [];

      for (const row of rows) {
         const tanggal = row.get('Tanggal');
         if (tanggal !== yesterdayStr) continue;

         const no = row.get('No') || row._rawData[0];
         const app = row.get('Aplikasi') || row._rawData[2];
         const jenis = row.get('Jenis') || row._rawData[3];
         const laba = parseIDR(row.get('Laba') || row._rawData[4]);

         total += laba;
         lines.push(`#${no} ${app} | ${jenis} | ${formatIDR(laba)}`);
      }

      if (lines.length === 0) {
         return bot.sendMessage(chatId, `Belum ada transaksi kemarin (${yesterdayStr}) di tab ${sheetName}.`);
      }

      bot.sendMessage(chatId, `📌 Kemarin (${yesterdayStr}) [${sheetName}]\n${lines.join('\n')}\n\nTotal: ${formatIDR(total)}`);
   } catch (error) {
      console.error('Error getting yesterday:', error);
      bot.sendMessage(chatId, '❌ Gagal mengambil data. Error: ' + error.message);
   }
});

// /undo
bot.onText(/\/undo/, async (msg) => {
   const chatId = msg.chat.id;
   const userId = msg.from.id;

   try {
      const lastAction = userLastActions[userId];

      if (!lastAction) {
         return bot.sendMessage(chatId, 'Tidak ada entry yang bisa di-undo.');
      }

      const doc = await getSheet();
      const sheet = doc.sheetsByTitle[lastAction.sheetName];

      if (!sheet) {
         return bot.sendMessage(chatId, 'Sheet undo tidak ditemukan: ' + lastAction.sheetName);
      }

      const rows = await sheet.getRows();

      // Cari row dengan No yang sesuai
      const rowToDelete = rows.find((row) => {
         const no = parseInt(row.get('No') || row._rawData[0]);
         return no === lastAction.rowNo;
      });

      if (!rowToDelete) {
         return bot.sendMessage(chatId, 'Entry terakhir sudah berubah, undo dibatalkan.');
      }

      await rowToDelete.delete();

      // Clear undo data
      delete userLastActions[userId];

      bot.sendMessage(chatId, `↩️ Undo sukses: hapus 1 entry terakhir di tab ${lastAction.sheetName}.`);
   } catch (error) {
      console.error('Error undo:', error);
      bot.sendMessage(chatId, '❌ Gagal undo. Error: ' + error.message);
   }
});

// /list
bot.onText(/\/list/, async (msg) => {
   const chatId = msg.chat.id;

   try {
      const doc = await getSheet();
      const sheetName = SEED_SHEET_NAME;
      const sheet = doc.sheetsByTitle[sheetName];

      if (!sheet) {
         throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
      }

      const rows = await sheet.getRows();

      if (rows.length === 0) {
         return bot.sendMessage(chatId, `Belum ada transaksi di tab ${sheetName}.`);
      }

      let total = 0;
      const lines = [];

      for (const row of rows) {
         const no = row.get('No') || row._rawData[0];
         const tanggal = row.get('Tanggal') || row._rawData[1];
         const app = row.get('Aplikasi') || row._rawData[2];
         const jenis = row.get('Jenis') || row._rawData[3];
         const laba = parseIDR(row.get('Laba') || row._rawData[4]);

         total += laba;
         lines.push(`#${no} ${tanggal} | ${app} | ${jenis} | ${formatIDR(laba)}`);
      }

      bot.sendMessage(chatId, `📋 Semua Transaksi [${sheetName}]\n${lines.join('\n')}\n\nTotal: ${formatIDR(total)}`);
   } catch (error) {
      console.error('Error getting list:', error);
      bot.sendMessage(chatId, '❌ Gagal mengambil data. Error: ' + error.message);
   }
});

// /summary
bot.onText(/\/summary/, async (msg) => {
   const chatId = msg.chat.id;

   try {
      const doc = await getSheet();
      const sheetName = SEED_SHEET_NAME;
      const sheet = doc.sheetsByTitle[sheetName];

      if (!sheet) {
         throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
      }

      const rows = await sheet.getRows();

      if (rows.length === 0) {
         return bot.sendMessage(chatId, `Belum ada transaksi di tab ${sheetName}.`);
      }

      // Group by application
      const appStats = {};

      for (const row of rows) {
         const app = row.get('Aplikasi') || row._rawData[2];
         const laba = parseIDR(row.get('Laba') || row._rawData[4]);

         if (!appStats[app]) {
            appStats[app] = { count: 0, total: 0 };
         }

         appStats[app].count++;
         appStats[app].total += laba;
      }

      // Sort by total (highest first)
      const sortedApps = Object.entries(appStats).sort((a, b) => b[1].total - a[1].total);

      const lines = [];
      let grandTotal = 0;

      for (const [app, stats] of sortedApps) {
         lines.push(`${app}: ${stats.count}x transaksi\nTotal: ${formatIDR(stats.total)}`);
         grandTotal += stats.total;
      }

      bot.sendMessage(chatId, `📊 Ringkasan per Aplikasi [${sheetName}]\n\n${lines.join('\n\n')}\n\n━━━━━━━━━━━━━━━\nGrand Total: ${formatIDR(grandTotal)}`);
   } catch (error) {
      console.error('Error getting summary:', error);
      bot.sendMessage(chatId, '❌ Gagal mengambil data. Error: ' + error.message);
   }
});

// /edit
bot.onText(/\/edit\s+(\d+)\s+(\w+)\s+(.+)/, async (msg, match) => {
   const chatId = msg.chat.id;
   const targetNo = parseInt(match[1]);
   const field = match[2].toLowerCase();
   const value = match[3].trim();

   try {
      // Validate field
      const validFields = ['aplikasi', 'jenis', 'laba'];
      if (!validFields.includes(field)) {
         return bot.sendMessage(chatId, `❌ Field tidak valid. Gunakan: aplikasi, jenis, atau laba\n\nContoh:\n/edit 3 aplikasi Canva\n/edit 3 jenis lifetime\n/edit 3 laba 10000`);
      }

      const doc = await getSheet();
      const sheetName = SEED_SHEET_NAME;
      const sheet = doc.sheetsByTitle[sheetName];

      if (!sheet) {
         throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
      }

      const rows = await sheet.getRows();

      // Find target row
      const rowToEdit = rows.find((row) => {
         const no = parseInt(row.get('No') || row._rawData[0]);
         return no === targetNo;
      });

      if (!rowToEdit) {
         return bot.sendMessage(chatId, `❌ Entry #${targetNo} tidak ditemukan.`);
      }

      // Save old value for confirmation
      const oldValue = rowToEdit.get(field.charAt(0).toUpperCase() + field.slice(1)) || rowToEdit._rawData[validFields.indexOf(field) + 2];

      // Update field
      const fieldName = field.charAt(0).toUpperCase() + field.slice(1);
      if (field === 'laba') {
         const parsedValue = parseIDR(value);
         if (!isFinite(parsedValue) || parsedValue <= 0) {
            return bot.sendMessage(chatId, '❌ Nilai laba tidak valid. Gunakan angka positif.');
         }
         rowToEdit.set(fieldName, parsedValue);
      } else {
         rowToEdit.set(fieldName, value);
      }

      await rowToEdit.save();

      const displayOld = field === 'laba' ? formatIDR(oldValue) : oldValue;
      const displayNew = field === 'laba' ? formatIDR(parseIDR(value)) : value;

      bot.sendMessage(chatId, `✏️ Berhasil edit entry #${targetNo}\n\nField: ${fieldName}\nDari: ${displayOld}\nJadi: ${displayNew}`);
   } catch (error) {
      console.error('Error editing row:', error);
      bot.sendMessage(chatId, '❌ Gagal mengedit data. Error: ' + error.message);
   }
});

// /delete
bot.onText(/\/delete\s+(\d+)/, async (msg, match) => {
   const chatId = msg.chat.id;
   const targetNo = parseInt(match[1]);

   try {
      const doc = await getSheet();
      const sheetName = SEED_SHEET_NAME;
      const sheet = doc.sheetsByTitle[sheetName];

      if (!sheet) {
         throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
      }

      const rows = await sheet.getRows();

      // Cari row dengan No yang sesuai
      const rowToDelete = rows.find((row) => {
         const no = parseInt(row.get('No') || row._rawData[0]);
         return no === targetNo;
      });

      if (!rowToDelete) {
         return bot.sendMessage(chatId, `❌ Entry #${targetNo} tidak ditemukan.`);
      }

      // Simpan info untuk konfirmasi
      const deletedApp = rowToDelete.get('Aplikasi') || rowToDelete._rawData[2];
      const deletedJenis = rowToDelete.get('Jenis') || rowToDelete._rawData[3];
      const deletedLaba = parseIDR(rowToDelete.get('Laba') || rowToDelete._rawData[4]);

      // Delete row
      await rowToDelete.delete();

      // Renumber remaining rows
      const remainingRows = await sheet.getRows();
      for (let i = 0; i < remainingRows.length; i++) {
         const newNo = i + 1;
         remainingRows[i].set('No', newNo);
         await remainingRows[i].save();
      }

      bot.sendMessage(chatId, `🗑️ Berhasil dihapus #${targetNo}\n${deletedApp} | ${deletedJenis} | ${formatIDR(deletedLaba)}\n\nSisa ${remainingRows.length} entry (sudah di-renumber)`);
   } catch (error) {
      console.error('Error deleting row:', error);
      bot.sendMessage(chatId, '❌ Gagal menghapus data. Error: ' + error.message);
   }
});

// Error handling
bot.on('polling_error', (error) => {
   console.error('Polling error:', error);
});

console.log('✅ Bot is running and waiting for messages...');
