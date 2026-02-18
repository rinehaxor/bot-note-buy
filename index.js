require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

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

// ===== PERSISTENT CHAT IDS =====
const CHAT_IDS_FILE = path.join(__dirname, 'data', 'chat_ids.json');

function loadChatIds() {
   try {
      if (!fs.existsSync(path.dirname(CHAT_IDS_FILE))) {
         fs.mkdirSync(path.dirname(CHAT_IDS_FILE), { recursive: true });
      }
      if (!fs.existsSync(CHAT_IDS_FILE)) return new Set();
      const raw = fs.readFileSync(CHAT_IDS_FILE, 'utf-8');
      return new Set(JSON.parse(raw));
   } catch {
      return new Set();
   }
}

function saveChatIds() {
   try {
      fs.writeFileSync(CHAT_IDS_FILE, JSON.stringify([...activeChatIds]), 'utf-8');
   } catch (e) {
      console.error('Gagal menyimpan chat IDs:', e.message);
   }
}

function registerChatId(chatId) {
   if (!activeChatIds.has(chatId)) {
      activeChatIds.add(chatId);
      saveChatIds();
   }
}

// Load chat IDs dari file saat bot start
const activeChatIds = loadChatIds();
console.log(`📂 Loaded ${activeChatIds.size} chat ID(s) dari file.`);

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
   registerChatId(chatId); // Daftarkan & simpan chat ID
   const helpText = `Perintah:
/add Aplikasi | Jenis | Laba
/today - Transaksi hari ini
/yesterday - Transaksi kemarin
/week - Transaksi minggu ini
/month - Transaksi bulan ini
/list - Semua transaksi
/summary - Ringkasan per aplikasi
/top - Top 5 aplikasi terlaris
/stats - Statistik lengkap
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
/week - Transaksi minggu ini
/month - Transaksi bulan ini
/list - Semua transaksi
/summary - Ringkasan per aplikasi
/top - Top 5 aplikasi terlaris
/stats - Statistik lengkap
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

   registerChatId(chatId); // Daftarkan & simpan chat ID

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

      // Konfirmasi ke pengirim
      const senderName = msg.from.first_name || msg.from.username || 'Seseorang';
      bot.sendMessage(chatId, `✅ Tercatat (${sheetName}) #${nextNo}\n${tanggal}\n${parsed.aplikasi} | ${parsed.jenis} | ${formatIDR(parsed.laba)}`);

      // Broadcast notifikasi ke semua chat lain yang aktif
      const notifText = `🔔 *Data baru ditambahkan oleh ${senderName}*\n#${nextNo} | ${tanggal}\n${parsed.aplikasi} | ${parsed.jenis} | ${formatIDR(parsed.laba)}`;
      for (const id of activeChatIds) {
         if (id !== chatId) {
            bot.sendMessage(id, notifText, { parse_mode: 'Markdown' }).catch(() => {
               // Hapus chat ID yang tidak bisa dikirim (misal user block bot)
               activeChatIds.delete(id);
               saveChatIds();
            });
         }
      }
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

// /week
bot.onText(/\/week/, async (msg) => {
   const chatId = msg.chat.id;

   try {
      const doc = await getSheet();
      const sheetName = SEED_SHEET_NAME;
      const sheet = doc.sheetsByTitle[sheetName];

      if (!sheet) {
         throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
      }

      // Calculate week start (Monday) and end (Sunday)
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Get to Monday

      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() + diff);
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const rows = await sheet.getRows();

      let total = 0;
      const lines = [];
      const dailyTotals = {};

      for (const row of rows) {
         const tanggal = row.get('Tanggal');
         if (!tanggal) continue;

         // Parse date (DD/MM/YYYY)
         const [d, m, y] = tanggal.split('/');
         const rowDate = new Date(y, m - 1, d);

         if (rowDate >= weekStart && rowDate <= weekEnd) {
            const no = row.get('No') || row._rawData[0];
            const app = row.get('Aplikasi') || row._rawData[2];
            const jenis = row.get('Jenis') || row._rawData[3];
            const laba = parseIDR(row.get('Laba') || row._rawData[4]);

            total += laba;
            lines.push(`#${no} ${tanggal} | ${app} | ${jenis} | ${formatIDR(laba)}`);

            // Track daily totals
            if (!dailyTotals[tanggal]) {
               dailyTotals[tanggal] = 0;
            }
            dailyTotals[tanggal] += laba;
         }
      }

      if (lines.length === 0) {
         return bot.sendMessage(chatId, `Belum ada transaksi minggu ini di tab ${sheetName}.`);
      }

      const weekStartStr = formatDate(weekStart);
      const weekEndStr = formatDate(weekEnd);
      const avgPerDay = Math.round(total / Object.keys(dailyTotals).length);

      bot.sendMessage(chatId, `📅 Minggu Ini (${weekStartStr} - ${weekEndStr}) [${sheetName}]\n${lines.join('\n')}\n\n━━━━━━━━━━━━━━━\nTotal: ${formatIDR(total)}\nTransaksi: ${lines.length}x\nRata-rata/hari: ${formatIDR(avgPerDay)}`);
   } catch (error) {
      console.error('Error getting week:', error);
      bot.sendMessage(chatId, '❌ Gagal mengambil data. Error: ' + error.message);
   }
});

// /month
bot.onText(/\/month/, async (msg) => {
   const chatId = msg.chat.id;

   try {
      const doc = await getSheet();
      const sheetName = SEED_SHEET_NAME;
      const sheet = doc.sheetsByTitle[sheetName];

      if (!sheet) {
         throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
      }

      // Calculate month start and end
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const rows = await sheet.getRows();

      let total = 0;
      const lines = [];
      const dailyTotals = {};

      for (const row of rows) {
         const tanggal = row.get('Tanggal');
         if (!tanggal) continue;

         // Parse date (DD/MM/YYYY)
         const [d, m, y] = tanggal.split('/');
         const rowDate = new Date(y, m - 1, d);

         if (rowDate >= monthStart && rowDate <= monthEnd) {
            const no = row.get('No') || row._rawData[0];
            const app = row.get('Aplikasi') || row._rawData[2];
            const jenis = row.get('Jenis') || row._rawData[3];
            const laba = parseIDR(row.get('Laba') || row._rawData[4]);

            total += laba;
            lines.push(`#${no} ${tanggal} | ${app} | ${jenis} | ${formatIDR(laba)}`);

            // Track daily totals
            if (!dailyTotals[tanggal]) {
               dailyTotals[tanggal] = 0;
            }
            dailyTotals[tanggal] += laba;
         }
      }

      if (lines.length === 0) {
         return bot.sendMessage(chatId, `Belum ada transaksi bulan ini di tab ${sheetName}.`);
      }

      const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const monthName = bulan[now.getMonth()];
      const daysInMonth = Object.keys(dailyTotals).length;
      const avgPerDay = Math.round(total / daysInMonth);

      bot.sendMessage(
         chatId,
         `📅 ${monthName} ${now.getFullYear()} [${sheetName}]\n${lines.join('\n')}\n\n━━━━━━━━━━━━━━━\nTotal: ${formatIDR(total)}\nTransaksi: ${lines.length}x\nHari aktif: ${daysInMonth} hari\nRata-rata/hari: ${formatIDR(avgPerDay)}`,
      );
   } catch (error) {
      console.error('Error getting month:', error);
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

// /top
bot.onText(/\/top/, async (msg) => {
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

      // Sort by total (highest first) and get top 5
      const sortedApps = Object.entries(appStats)
         .sort((a, b) => b[1].total - a[1].total)
         .slice(0, 5);

      const lines = [];
      let grandTotal = 0;

      sortedApps.forEach(([app, stats], index) => {
         const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
         lines.push(`${medal} ${app}\n   ${stats.count}x transaksi | ${formatIDR(stats.total)}`);
         grandTotal += stats.total;
      });

      bot.sendMessage(chatId, `🏆 Top ${sortedApps.length} Aplikasi Terlaris [${sheetName}]\n\n${lines.join('\n\n')}\n\n━━━━━━━━━━━━━━━\nTotal dari Top ${sortedApps.length}: ${formatIDR(grandTotal)}`);
   } catch (error) {
      console.error('Error getting top:', error);
      bot.sendMessage(chatId, '❌ Gagal mengambil data. Error: ' + error.message);
   }
});

// /stats
bot.onText(/\/stats/, async (msg) => {
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

      // Collect data
      const appStats = {};
      const dailyStats = {};
      const jenisStats = {};
      let totalLaba = 0;
      let maxLaba = 0;
      let minLaba = Infinity;
      let maxLabaEntry = null;
      let minLabaEntry = null;

      for (const row of rows) {
         const tanggal = row.get('Tanggal');
         const app = row.get('Aplikasi') || row._rawData[2];
         const jenis = row.get('Jenis') || row._rawData[3];
         const laba = parseIDR(row.get('Laba') || row._rawData[4]);
         const no = row.get('No') || row._rawData[0];

         totalLaba += laba;

         // Track max/min
         if (laba > maxLaba) {
            maxLaba = laba;
            maxLabaEntry = { no, app, jenis, laba, tanggal };
         }
         if (laba < minLaba) {
            minLaba = laba;
            minLabaEntry = { no, app, jenis, laba, tanggal };
         }

         // Group by app
         if (!appStats[app]) {
            appStats[app] = { count: 0, total: 0 };
         }
         appStats[app].count++;
         appStats[app].total += laba;

         // Group by day
         if (!dailyStats[tanggal]) {
            dailyStats[tanggal] = { count: 0, total: 0 };
         }
         dailyStats[tanggal].count++;
         dailyStats[tanggal].total += laba;

         // Group by jenis
         if (!jenisStats[jenis]) {
            jenisStats[jenis] = { count: 0, total: 0 };
         }
         jenisStats[jenis].count++;
         jenisStats[jenis].total += laba;
      }

      // Calculate averages
      const totalTransaksi = rows.length;
      const totalDays = Object.keys(dailyStats).length;
      const avgPerTransaksi = Math.round(totalLaba / totalTransaksi);
      const avgPerDay = Math.round(totalLaba / totalDays);

      // Find most productive day
      const sortedDays = Object.entries(dailyStats).sort((a, b) => b[1].total - a[1].total);
      const bestDay = sortedDays[0];

      // Find most popular app and jenis
      const sortedApps = Object.entries(appStats).sort((a, b) => b[1].count - a[1].count);
      const mostPopularApp = sortedApps[0];

      const sortedJenis = Object.entries(jenisStats).sort((a, b) => b[1].count - a[1].count);
      const mostPopularJenis = sortedJenis[0];

      const statsText =
         `📊 Statistik Lengkap [${sheetName}]\n\n` +
         `📈 RINGKASAN UMUM\n` +
         `Total Transaksi: ${totalTransaksi}x\n` +
         `Total Laba: ${formatIDR(totalLaba)}\n` +
         `Hari Aktif: ${totalDays} hari\n\n` +
         `💰 RATA-RATA\n` +
         `Per Transaksi: ${formatIDR(avgPerTransaksi)}\n` +
         `Per Hari: ${formatIDR(avgPerDay)}\n\n` +
         `🎯 REKOR\n` +
         `Transaksi Tertinggi:\n` +
         `  #${maxLabaEntry.no} ${formatIDR(maxLaba)}\n` +
         `  ${maxLabaEntry.app} | ${maxLabaEntry.jenis}\n` +
         `  ${maxLabaEntry.tanggal}\n\n` +
         `Transaksi Terendah:\n` +
         `  #${minLabaEntry.no} ${formatIDR(minLaba)}\n` +
         `  ${minLabaEntry.app} | ${minLabaEntry.jenis}\n` +
         `  ${minLabaEntry.tanggal}\n\n` +
         `🏅 PALING POPULER\n` +
         `Aplikasi: ${mostPopularApp[0]}\n` +
         `  ${mostPopularApp[1].count}x | ${formatIDR(mostPopularApp[1].total)}\n\n` +
         `Jenis: ${mostPopularJenis[0]}\n` +
         `  ${mostPopularJenis[1].count}x | ${formatIDR(mostPopularJenis[1].total)}\n\n` +
         `📅 HARI TERBAIK\n` +
         `${bestDay[0]}\n` +
         `  ${bestDay[1].count}x transaksi | ${formatIDR(bestDay[1].total)}`;

      bot.sendMessage(chatId, statsText);
   } catch (error) {
      console.error('Error getting stats:', error);
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
