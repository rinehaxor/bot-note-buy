require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ===== CONFIG =====
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000/api/v1';
const API_KEY = process.env.API_KEY;

if (!TELEGRAM_BOT_TOKEN) {
   console.error('❌ TELEGRAM_BOT_TOKEN tidak ditemukan di .env');
   process.exit(1);
}
if (!API_KEY) {
   console.error('❌ API_KEY tidak ditemukan di .env');
   process.exit(1);
}

// ===== API CLIENT =====
const api = axios.create({
   baseURL: API_BASE_URL,
   headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
   },
   timeout: 15000,
});

// Helper: panggil API dan kirim hasilnya ke chat
async function callApi(chatId, method, url, data = null) {
   try {
      const response = method === 'get'
         ? await api.get(url)
         : method === 'post'
            ? await api.post(url, data)
            : method === 'put'
               ? await api.put(url, data)
               : await api.delete(url);

      const body = response.data;
      if (body.message) {
         await bot.sendMessage(chatId, body.message);
      }
      return body;
   } catch (error) {
      const msg = error.response?.data?.message || error.message || 'Terjadi kesalahan';
      await bot.sendMessage(chatId, `❌ Error: ${msg}`);
      console.error(`API Error [${method.toUpperCase()} ${url}]:`, error.response?.data || error.message);
      return null;
   }
}

// ===== INIT BOT =====
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log('🤖 Bot started successfully!');
console.log(`🔗 API: ${API_BASE_URL}`);

// ===== HELPERS =====
function parseIDR(s) {
   const cleaned = String(s).replace(/\s/g, '').replace(/rp/gi, '').replace(/\./g, '').replace(/,/g, '.');
   return Math.round(Number(cleaned));
}

// ===== BOT COMMANDS =====

// /start & /help
bot.onText(/\/(start|help)/, (msg) => {
   const chatId = msg.chat.id;
   const helpText = `📋 *Daftar Perintah Bot*

💰 *PEMASUKAN*
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
/undo - Batalkan /add terakhir
/delete <nomor>

💸 *PENGELUARAN*
/spend Kategori | Keterangan | Nominal
/spendlist - Semua pengeluaran
/spendtoday - Pengeluaran hari ini
/spendmonth - Pengeluaran bulan ini
/spenddelete <nomor>

📧 *EMAIL*
/email Akun | Password | Keterangan
/emaillist - Semua email tercatat
/emailedit <nomor> <field> <value>
/emaildelete <nomor>

/help - Tampilkan bantuan ini

*Contoh:*
/add Capcut | 1 bulan | 8000
/spend Makan | Beli nasi padang | 15000
/email test@gmail.com | pass123 | Email utama`;

   bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// ===== PEMASUKAN =====

// /add Aplikasi | Jenis | Laba
bot.onText(/\/add (.+)/, async (msg, match) => {
   const chatId = msg.chat.id;
   const text = msg.text;
   const raw = text.slice(4).trim();
   const parts = raw.split('|').map((s) => s.trim()).filter(Boolean);

   if (parts.length < 3) {
      return bot.sendMessage(chatId, 'Format salah.\nPakai:\n/add Aplikasi | Jenis | Laba\nContoh: /add Canva | lifetime | 15000');
   }

   const aplikasi = parts[0];
   const jenis = parts[1];
   const laba = parseIDR(parts[2]);

   if (!aplikasi || !jenis || !isFinite(laba) || laba <= 0) {
      return bot.sendMessage(chatId, 'Format salah.\nPakai:\n/add Aplikasi | Jenis | Laba\nContoh: /add Canva | lifetime | 15000');
   }

   const senderName = msg.from.first_name || msg.from.username || 'Seseorang';
   await callApi(chatId, 'post', '/incomes', {
      aplikasi,
      jenis,
      laba,
      source_user: senderName,
   });
});

// /today
bot.onText(/\/today/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/incomes/today');
});

// /yesterday
bot.onText(/\/yesterday/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/incomes/yesterday');
});

// /week
bot.onText(/\/week/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/incomes/week');
});

// /month
bot.onText(/\/month/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/incomes/month');
});

// /list
bot.onText(/\/list/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/incomes');
});

// /summary
bot.onText(/\/summary/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/incomes/summary');
});

// /top
bot.onText(/\/top/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/incomes/top');
});

// /stats
bot.onText(/\/stats/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/incomes/stats');
});

// /edit <nomor> <field> <value>
bot.onText(/\/edit\s+(\d+)\s+(\w+)\s+(.+)/, async (msg, match) => {
   const chatId = msg.chat.id;
   const id = match[1];
   const field = match[2].toLowerCase();
   const value = match[3].trim();

   const validFields = ['aplikasi', 'jenis', 'laba'];
   if (!validFields.includes(field)) {
      return bot.sendMessage(chatId, `❌ Field tidak valid. Gunakan: aplikasi, jenis, atau laba\n\nContoh:\n/edit 3 aplikasi Canva\n/edit 3 jenis lifetime\n/edit 3 laba 10000`);
   }

   const data = {};
   data[field] = field === 'laba' ? parseIDR(value) : value;

   await callApi(chatId, 'put', `/incomes/${id}`, data);
});

// /undo
bot.onText(/\/undo/, async (msg) => {
   await callApi(msg.chat.id, 'delete', '/incomes/last');
});

// /delete <nomor>
bot.onText(/\/delete\s+(\d+)/, async (msg, match) => {
   await callApi(msg.chat.id, 'delete', `/incomes/${match[1]}`);
});

// ===== PENGELUARAN =====

// /spend Kategori | Keterangan | Nominal
bot.onText(/\/spend (.+)/, async (msg, match) => {
   const chatId = msg.chat.id;
   const text = msg.text;
   const raw = text.slice(6).trim();
   const parts = raw.split('|').map((s) => s.trim()).filter(Boolean);

   if (parts.length < 3) {
      return bot.sendMessage(
         chatId,
         '❌ Format salah.\nPakai:\n/spend Kategori | Keterangan | Nominal\n\n*Contoh:*\n/spend Makan | Beli nasi padang | 15000\n/spend Akun | Beli akun Netflix | 50000',
         { parse_mode: 'Markdown' },
      );
   }

   const kategori = parts[0];
   const keterangan = parts[1];
   const nominal = parseIDR(parts[2]);

   if (!kategori || !keterangan || !isFinite(nominal) || nominal <= 0) {
      return bot.sendMessage(chatId, '❌ Format salah. Nominal harus angka positif.');
   }

   const senderName = msg.from.first_name || msg.from.username || 'Seseorang';
   await callApi(chatId, 'post', '/expenses', {
      kategori,
      keterangan,
      nominal,
      source_user: senderName,
   });
});

// /spendlist
bot.onText(/\/spendlist/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/expenses');
});

// /spendtoday
bot.onText(/\/spendtoday/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/expenses/today');
});

// /spendmonth
bot.onText(/\/spendmonth/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/expenses/month');
});

// /spenddelete <nomor>
bot.onText(/\/spenddelete\s+(\d+)/, async (msg, match) => {
   await callApi(msg.chat.id, 'delete', `/expenses/${match[1]}`);
});

// ===== EMAIL =====

// /email Akun | Password | Keterangan
bot.onText(/\/email\s+(.+)/, async (msg, match) => {
   const chatId = msg.chat.id;
   const text = msg.text;
   const raw = text.slice(6).trim();
   const parts = raw.split('|').map((s) => s.trim()).filter(Boolean);

   if (parts.length < 3) {
      return bot.sendMessage(
         chatId,
         '❌ Format salah.\nPakai:\n/email Akun | Password | Keterangan\n\n*Contoh:*\n/email test@gmail.com | password123 | Email utama',
         { parse_mode: 'Markdown' },
      );
   }

   const senderName = msg.from.first_name || msg.from.username || 'Seseorang';
   await callApi(chatId, 'post', '/emails', {
      akun: parts[0],
      password: parts[1],
      keterangan: parts[2],
      source_user: senderName,
   });
});

// /emaillist
bot.onText(/\/emaillist/, async (msg) => {
   await callApi(msg.chat.id, 'get', '/emails');
});

// /emailedit <nomor> <field> <value>
bot.onText(/\/emailedit\s+(\d+)\s+(\w+)\s+(.+)/, async (msg, match) => {
   const chatId = msg.chat.id;
   const id = match[1];
   const field = match[2].toLowerCase();
   const value = match[3].trim();

   const validFields = ['akun', 'password', 'keterangan'];
   if (!validFields.includes(field)) {
      return bot.sendMessage(chatId, `❌ Field tidak valid. Gunakan: akun, password, atau keterangan`);
   }

   const data = {};
   data[field] = value;

   await callApi(chatId, 'put', `/emails/${id}`, data);
});

// /emaildelete <nomor>
bot.onText(/\/emaildelete\s+(\d+)/, async (msg, match) => {
   await callApi(msg.chat.id, 'delete', `/emails/${match[1]}`);
});

// ===== ERROR HANDLING =====
bot.on('polling_error', (error) => {
   console.error('Polling error:', error.message);
});

console.log('✅ Bot is running and waiting for messages...');
console.log('📡 Mode: API (Laravel Backend)');
