require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');

// ===== CONFIG =====
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000/api/v1';
const API_KEY = process.env.API_KEY;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : [];

// WA Admin Numbers — format: 628xxxxxxxxxx (tanpa +, tanpa spasi)
const WA_ADMIN_NUMBERS = process.env.WA_ADMIN_NUMBERS
   ? process.env.WA_ADMIN_NUMBERS.split(',').map(n => n.trim())
   : [];

const WA_SESSION_DIR = path.join(__dirname, 'wa_session');

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

// ===== HELPERS =====
function parseIDR(s) {
   const cleaned = String(s).replace(/\s/g, '').replace(/rp/gi, '').replace(/\./g, '').replace(/,/g, '.');
   return Math.round(Number(cleaned));
}

function formatIDR(num) {
   return new Intl.NumberFormat('id-ID').format(num);
}

function getSenderName(msg) {
   return msg.from.first_name || msg.from.username || 'Seseorang';
}

// ============================================================
// ==================== TELEGRAM BOT ==========================
// ============================================================

// Helper: panggil API dan kirim hasilnya ke chat Telegram
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

// Helper: kirim notifikasi ke SEMUA admin Telegram LAIN (bukan yang melakukan aksi)
async function notifyOtherAdmins(senderChatId, notifMessage) {
   const senderId = senderChatId.toString();
   for (const adminId of ADMIN_IDS) {
      if (adminId === senderId) continue;
      bot.sendMessage(
         adminId,
         notifMessage,
         { parse_mode: 'Markdown' }
      ).catch(err => console.error(`Gagal kirim notif ke admin ${adminId}:`, err.message));
   }
}

// ===== INIT TELEGRAM BOT =====
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log('🤖 Telegram Bot started successfully!');
console.log(`🔗 API: ${API_BASE_URL}`);

// ===== MIDDLEWARE / GLOBAL HANDLER =====
bot.on('message', (msg) => {
   if (!msg.chat) return;

   const chatId = msg.chat.id.toString();
   const senderName = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'Seseorang');

   if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(chatId)) {
      for (const adminId of ADMIN_IDS) {
         bot.sendMessage(
            adminId,
            `⚠️ *Aktivitas Tidak Dikenal*\n\nUser: ${senderName}\nID Chat: \`${chatId}\`\nPesan: ${msg.text || '[Bukan Teks]'}`,
            { parse_mode: 'Markdown' }
         ).catch(err => console.error("Gagal kirim notif ke admin:", err.message));
      }
   }
});

// Wrapper untuk mengecek apakah user memiliki akses
function checkAccess(msg) {
   if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(msg.chat.id.toString())) {
      bot.sendMessage(msg.chat.id, '⛔ Maaf, Anda tidak memiliki akses untuk menggunakan bot ini.');
      return false;
   }
   return true;
}

// ===== INLINE KEYBOARD MENUS =====

const MAIN_MENU = {
   reply_markup: {
      inline_keyboard: [
         [
            { text: '📊 Laporan', callback_data: 'menu_laporan' },
            { text: '💰 Pemasukan', callback_data: 'menu_pemasukan' },
         ],
         [
            { text: '💸 Pengeluaran', callback_data: 'menu_pengeluaran' },
            { text: '📧 Email', callback_data: 'menu_email' },
         ],
         [
            { text: '✖️ X Account', callback_data: 'menu_xaccount' },
         ],
      ],
   },
};

const BACK_BTN = [{ text: '🔙 Kembali ke Menu', callback_data: 'menu_main' }];

const LAPORAN_MENU = {
   parse_mode: 'Markdown',
   reply_markup: {
      inline_keyboard: [
         [
            { text: '📅 Hari Ini', callback_data: 'laporan_today' },
            { text: '📅 Kemarin', callback_data: 'laporan_yesterday' },
         ],
         [
            { text: '📅 Minggu Ini', callback_data: 'laporan_week' },
            { text: '📅 Bulan Ini', callback_data: 'laporan_month' },
         ],
         [
            { text: '📋 Semua Transaksi', callback_data: 'laporan_list' },
            { text: '📊 Ringkasan', callback_data: 'laporan_summary' },
         ],
         [
            { text: '🏆 Top 5 Aplikasi', callback_data: 'laporan_top' },
            { text: '📈 Statistik', callback_data: 'laporan_stats' },
         ],
         BACK_BTN,
      ],
   },
};

const PEMASUKAN_MENU = {
   parse_mode: 'Markdown',
   reply_markup: {
      inline_keyboard: [
         [
            { text: '📋 Semua Pemasukan', callback_data: 'income_list' },
            { text: '↩️ Undo Terakhir', callback_data: 'income_undo' },
         ],
         BACK_BTN,
      ],
   },
};

const PENGELUARAN_MENU = {
   parse_mode: 'Markdown',
   reply_markup: {
      inline_keyboard: [
         [
            { text: '📋 Semua', callback_data: 'spend_list' },
            { text: '📅 Hari Ini', callback_data: 'spend_today' },
            { text: '📅 Bulan Ini', callback_data: 'spend_month' },
         ],
         BACK_BTN,
      ],
   },
};

const EMAIL_MENU = {
   parse_mode: 'Markdown',
   reply_markup: {
      inline_keyboard: [
         [
            { text: '📋 Semua Email', callback_data: 'email_list' },
         ],
         BACK_BTN,
      ],
   },
};

const XACCOUNT_MENU = {
   parse_mode: 'Markdown',
   reply_markup: {
      inline_keyboard: [
         [
            { text: '📋 Semua X Account', callback_data: 'x_list' },
         ],
         BACK_BTN,
      ],
   },
};

// ===== TELEGRAM COMMANDS =====

// /start & /help — tampilkan menu utama dengan tombol
bot.onText(/\/(start|help)/, (msg) => {
   if (!checkAccess(msg)) return;
   bot.sendMessage(
      msg.chat.id,
      `👋 *Halo!* Selamat datang di Bot Catatan.\n\nPilih kategori di bawah ini:`,
      { parse_mode: 'Markdown', ...MAIN_MENU }
   );
});

// ===== CALLBACK QUERY HANDLER (tombol inline) =====
bot.on('callback_query', async (query) => {
   const chatId = query.message.chat.id;
   const msgId  = query.message.message_id;
   const data   = query.data;

   if (!checkAccess({ chat: { id: chatId }, from: query.from })) {
      return bot.answerCallbackQuery(query.id, { text: '⛔ Tidak punya akses.' });
   }

   // Fungsi helper: edit pesan yang ada (update tombol)
   const edit = (text, opts = {}) =>
      bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...opts });

   // ---- Menu Utama ----
   if (data === 'menu_main') {
      await edit(`👋 *Menu Utama*\n\nPilih kategori:`, MAIN_MENU);
      return bot.answerCallbackQuery(query.id);
   }

   // ---- Sub-menu ----
   if (data === 'menu_laporan') {
      await edit(`📊 *Laporan*\n\nPilih periode atau jenis laporan:`, LAPORAN_MENU);
      return bot.answerCallbackQuery(query.id);
   }

   if (data === 'menu_pemasukan') {
      await edit(
         `💰 *Pemasukan*\n\nUntuk menambah pemasukan, ketik:\n\`/add Aplikasi | Jenis | Laba\`\n\nContoh:\n\`/add Canva | lifetime | 15000\``,
         PEMASUKAN_MENU
      );
      return bot.answerCallbackQuery(query.id);
   }

   if (data === 'menu_pengeluaran') {
      await edit(
         `💸 *Pengeluaran*\n\nUntuk menambah pengeluaran, ketik:\n\`/spend Kategori | Keterangan | Nominal\`\n\nContoh:\n\`/spend Makan | Nasi padang | 15000\``,
         PENGELUARAN_MENU
      );
      return bot.answerCallbackQuery(query.id);
   }

   if (data === 'menu_email') {
      await edit(
         `📧 *Email*\n\nUntuk menambah email, ketik:\n\`/email Akun | Password | Keterangan\`\n\nContoh:\n\`/email test@gmail.com | pass123 | Email utama\``,
         EMAIL_MENU
      );
      return bot.answerCallbackQuery(query.id);
   }

   if (data === 'menu_xaccount') {
      await edit(
         `✖️ *X Account*\n\nUntuk menambah X account, ketik:\n\`/x Nama | Username | Email | Status | Link\``,
         XACCOUNT_MENU
      );
      return bot.answerCallbackQuery(query.id);
   }

   // ---- Laporan Actions ----
   if (data === 'laporan_today') {
      bot.answerCallbackQuery(query.id, { text: '📅 Mengambil data hari ini...' });
      return callApi(chatId, 'get', '/incomes/today');
   }
   if (data === 'laporan_yesterday') {
      bot.answerCallbackQuery(query.id, { text: '📅 Mengambil data kemarin...' });
      return callApi(chatId, 'get', '/incomes/yesterday');
   }
   if (data === 'laporan_week') {
      bot.answerCallbackQuery(query.id, { text: '📅 Mengambil data minggu ini...' });
      return callApi(chatId, 'get', '/incomes/week');
   }
   if (data === 'laporan_month') {
      bot.answerCallbackQuery(query.id, { text: '📅 Mengambil data bulan ini...' });
      return callApi(chatId, 'get', '/incomes/month');
   }
   if (data === 'laporan_list') {
      bot.answerCallbackQuery(query.id, { text: '📋 Mengambil semua transaksi...' });
      return callApi(chatId, 'get', '/incomes');
   }
   if (data === 'laporan_summary') {
      bot.answerCallbackQuery(query.id, { text: '📊 Mengambil ringkasan...' });
      return callApi(chatId, 'get', '/incomes/summary');
   }
   if (data === 'laporan_top') {
      bot.answerCallbackQuery(query.id, { text: '🏆 Mengambil top 5...' });
      return callApi(chatId, 'get', '/incomes/top');
   }
   if (data === 'laporan_stats') {
      bot.answerCallbackQuery(query.id, { text: '📈 Mengambil statistik...' });
      return callApi(chatId, 'get', '/incomes/stats');
   }

   // ---- Pemasukan Actions ----
   if (data === 'income_list') {
      bot.answerCallbackQuery(query.id, { text: '📋 Mengambil semua pemasukan...' });
      return callApi(chatId, 'get', '/incomes');
   }
   if (data === 'income_undo') {
      const senderName = query.from.first_name || query.from.username || 'Seseorang';
      bot.answerCallbackQuery(query.id, { text: '↩️ Membatalkan pemasukan terakhir...' });
      const result = await callApi(chatId, 'delete', '/incomes/last');
      if (result) await notifyOtherAdmins(chatId, `↩️ *Undo Pemasukan Terakhir* oleh ${senderName}`);
      return;
   }

   // ---- Pengeluaran Actions ----
   if (data === 'spend_list') {
      bot.answerCallbackQuery(query.id, { text: '📋 Mengambil semua pengeluaran...' });
      return callApi(chatId, 'get', '/expenses');
   }
   if (data === 'spend_today') {
      bot.answerCallbackQuery(query.id, { text: '📅 Mengambil pengeluaran hari ini...' });
      return callApi(chatId, 'get', '/expenses/today');
   }
   if (data === 'spend_month') {
      bot.answerCallbackQuery(query.id, { text: '📅 Mengambil pengeluaran bulan ini...' });
      return callApi(chatId, 'get', '/expenses/month');
   }

   // ---- Email Actions ----
   if (data === 'email_list') {
      bot.answerCallbackQuery(query.id, { text: '📧 Mengambil semua email...' });
      return callApi(chatId, 'get', '/emails');
   }

   // ---- X Account Actions ----
   if (data === 'x_list') {
      bot.answerCallbackQuery(query.id, { text: '✖️ Mengambil semua X account...' });
      return callApi(chatId, 'get', '/x-accounts');
   }

   // Default
   bot.answerCallbackQuery(query.id);
});

// ===== PEMASUKAN =====

bot.onText(/\/add (.+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id;
   const raw = msg.text.slice(4).trim();
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

   const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'post', '/incomes', { aplikasi, jenis, laba, source_user: senderName });

   if (result) {
      let monthCount = '?';
      let monthTotal = 0;
      try {
         const monthRes = await api.get('/incomes/month');
         const monthData = monthRes.data;
         if (monthData.count !== undefined) monthCount = monthData.count;
         else if (monthData.data && Array.isArray(monthData.data)) monthCount = monthData.data.length;
         else if (Array.isArray(monthData)) monthCount = monthData.length;

         if (monthData.total !== undefined) monthTotal = monthData.total;
         else if (monthData.data && Array.isArray(monthData.data)) monthTotal = monthData.data.reduce((sum, item) => sum + (Number(item.laba) || 0), 0);
         else if (Array.isArray(monthData)) monthTotal = monthData.reduce((sum, item) => sum + (Number(item.laba) || 0), 0);
      } catch (err) {
         console.error('Gagal ambil data bulan ini:', err.message);
      }

      const bulanIni = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
      await bot.sendMessage(chatId, `📊 *Total Transaksi ${bulanIni}:* ${monthCount} transaksi\n💰 *Total Laba:* Rp ${formatIDR(monthTotal)}`, { parse_mode: 'Markdown' });
      await notifyOtherAdmins(chatId, `📥 *Pemasukan Baru* oleh ${senderName}\n\n📱 Aplikasi: *${aplikasi}*\n📦 Jenis: ${jenis}\n💰 Laba: Rp ${formatIDR(laba)}\n\n📊 Total Transaksi ${bulanIni}: *${monthCount} transaksi*\n💰 Total Laba: Rp ${formatIDR(monthTotal)}`);
   }
});

bot.onText(/\/today/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/incomes/today'); });
bot.onText(/\/yesterday/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/incomes/yesterday'); });
bot.onText(/\/week/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/incomes/week'); });
bot.onText(/\/month/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/incomes/month'); });
bot.onText(/\/list/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/incomes'); });
bot.onText(/\/summary/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/incomes/summary'); });
bot.onText(/\/top/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/incomes/top'); });
bot.onText(/\/stats/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/incomes/stats'); });

bot.onText(/\/edit\s+(\d+)\s+(\w+)\s+(.+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id;
   const id = match[1]; const field = match[2].toLowerCase(); const value = match[3].trim();
   const validFields = ['aplikasi', 'jenis', 'laba'];
   if (!validFields.includes(field)) return bot.sendMessage(chatId, `❌ Field tidak valid. Gunakan: aplikasi, jenis, atau laba\n\nContoh:\n/edit 3 aplikasi Canva\n/edit 3 jenis lifetime\n/edit 3 laba 10000`);
   const data = {}; data[field] = field === 'laba' ? parseIDR(value) : value;
   const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'put', `/incomes/${id}`, data);
   if (result) await notifyOtherAdmins(chatId, `✏️ *Edit Pemasukan #${id}* oleh ${senderName}\n\n📝 ${field}: *${value}*`);
});

bot.onText(/\/undo/, async (msg) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id; const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'delete', '/incomes/last');
   if (result) await notifyOtherAdmins(chatId, `↩️ *Undo Pemasukan Terakhir* oleh ${senderName}`);
});

bot.onText(/\/delete\s+(\d+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id; const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'delete', `/incomes/${match[1]}`);
   if (result) await notifyOtherAdmins(chatId, `🗑️ *Hapus Pemasukan #${match[1]}* oleh ${senderName}`);
});

// ===== PENGELUARAN =====

bot.onText(/\/spend (.+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id;
   const raw = msg.text.slice(6).trim();
   const parts = raw.split('|').map((s) => s.trim()).filter(Boolean);
   if (parts.length < 3) return bot.sendMessage(chatId, '❌ Format salah.\nPakai:\n/spend Kategori | Keterangan | Nominal\n\n*Contoh:*\n/spend Makan | Beli nasi padang | 15000', { parse_mode: 'Markdown' });
   const kategori = parts[0]; const keterangan = parts[1]; const nominal = parseIDR(parts[2]);
   if (!kategori || !keterangan || !isFinite(nominal) || nominal <= 0) return bot.sendMessage(chatId, '❌ Format salah. Nominal harus angka positif.');
   const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'post', '/expenses', { kategori, keterangan, nominal, source_user: senderName });
   if (result) await notifyOtherAdmins(chatId, `💸 *Pengeluaran Baru* oleh ${senderName}\n\n📂 Kategori: *${kategori}*\n📝 Keterangan: ${keterangan}\n💵 Nominal: Rp ${formatIDR(nominal)}`);
});

bot.onText(/\/spendlist/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/expenses'); });
bot.onText(/\/spendtoday/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/expenses/today'); });
bot.onText(/\/spendmonth/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/expenses/month'); });

bot.onText(/\/spenddelete\s+(\d+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id; const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'delete', `/expenses/${match[1]}`);
   if (result) await notifyOtherAdmins(chatId, `🗑️ *Hapus Pengeluaran #${match[1]}* oleh ${senderName}`);
});

// ===== EMAIL =====

bot.onText(/\/email\s+(.+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id;
   const raw = msg.text.slice(6).trim();
   const parts = raw.split('|').map((s) => s.trim()).filter(Boolean);
   if (parts.length < 3) return bot.sendMessage(chatId, '❌ Format salah.\nPakai:\n/email Akun | Password | Keterangan\n\n*Contoh:*\n/email test@gmail.com | password123 | Email utama', { parse_mode: 'Markdown' });
   const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'post', '/emails', { akun: parts[0], password: parts[1], keterangan: parts[2], source_user: senderName });
   if (result) await notifyOtherAdmins(chatId, `📧 *Email Baru Ditambahkan* oleh ${senderName}\n\n📬 Akun: *${parts[0]}*\n📝 Keterangan: ${parts[2]}`);
});

bot.onText(/\/emaillist/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/emails'); });

bot.onText(/\/emailedit\s+(\d+)\s+(\w+)\s+(.+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id;
   const id = match[1]; const field = match[2].toLowerCase(); const value = match[3].trim();
   const validFields = ['akun', 'password', 'keterangan'];
   if (!validFields.includes(field)) return bot.sendMessage(chatId, `❌ Field tidak valid. Gunakan: akun, password, atau keterangan`);
   const data = {}; data[field] = value;
   const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'put', `/emails/${id}`, data);
   if (result) await notifyOtherAdmins(chatId, `✏️ *Edit Email #${id}* oleh ${senderName}\n\n📝 ${field}: *${value}*`);
});

bot.onText(/\/emaildelete\s+(\d+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id; const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'delete', `/emails/${match[1]}`);
   if (result) await notifyOtherAdmins(chatId, `🗑️ *Hapus Email #${match[1]}* oleh ${senderName}`);
});

// ===== X ACCOUNT =====

bot.onText(/\/x\s+(.+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id;
   const raw = msg.text.slice(3).trim();
   const parts = raw.split('|').map((s) => s.trim()).filter(Boolean);
   if (parts.length < 5) return bot.sendMessage(chatId, '❌ Format salah.\nPakai:\n/x Nama | Username | Email | Status | Link\n\n*Contoh:*\n/x Akun Pribadi | @johndoe | john@gmail.com | Aktif | https://x.com/johndoe', { parse_mode: 'Markdown' });
   const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'post', '/x-accounts', { nama: parts[0], username: parts[1], email: parts[2], status: parts[3], link: parts[4], source_user: senderName });
   if (result) await notifyOtherAdmins(chatId, `✖️ *X Account Baru Ditambahkan* oleh ${senderName}\n\n👤 Nama: *${parts[0]}*\n🔗 Username: ${parts[1]}`);
});

bot.onText(/\/xlist/, async (msg) => { if (!checkAccess(msg)) return; await callApi(msg.chat.id, 'get', '/x-accounts'); });

bot.onText(/\/xedit\s+(\d+)\s+(\w+)\s+(.+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id;
   const id = match[1]; const field = match[2].toLowerCase(); const value = match[3].trim();
   const validFields = ['nama', 'username', 'email', 'status', 'link'];
   if (!validFields.includes(field)) return bot.sendMessage(chatId, `❌ Field tidak valid. Gunakan: nama, username, email, status, atau link`);
   const data = {}; data[field] = value;
   const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'put', `/x-accounts/${id}`, data);
   if (result) await notifyOtherAdmins(chatId, `✏️ *Edit X Account #${id}* oleh ${senderName}\n\n📝 ${field}: *${value}*`);
});

bot.onText(/\/xdelete\s+(\d+)/, async (msg, match) => {
   if (!checkAccess(msg)) return;
   const chatId = msg.chat.id; const senderName = getSenderName(msg);
   const result = await callApi(chatId, 'delete', `/x-accounts/${match[1]}`);
   if (result) await notifyOtherAdmins(chatId, `🗑️ *Hapus X Account #${match[1]}* oleh ${senderName}`);
});

// /myid
bot.onText(/\/myid/, (msg) => {
   bot.sendMessage(msg.chat.id, `🆔 ID Telegram Anda adalah: \`${msg.chat.id}\`\n\nSilakan masukkan ID ini ke \`ADMIN_IDS\` di dalam file \`.env\` (pisahkan dengan koma jika lebih dari satu admin, contoh: \`ADMIN_IDS=123,456\`) untuk memblokir orang tidak dikenal dan menerima notifikasi.`, { parse_mode: 'Markdown' });
});

// ===== TELEGRAM ERROR HANDLING =====
bot.on('polling_error', (error) => {
   console.error('Polling error:', error.message);
});

// ============================================================
// =================== WHATSAPP BOT (Baileys) =================
// ============================================================

let waSocket = null;

// Helper: parse nomor WA jadi JID
function toJID(number) {
   const clean = number.replace(/\D/g, '');
   return `${clean}@s.whatsapp.net`;
}

// Helper: normalisasi JID — strip device suffix (:1, :2, dll)
// Contoh: 75519232086065:1@lid → 75519232086065@lid
function normalizeJID(jid) {
   if (!jid) return jid;
   return jid.replace(/(:\d+)(@)/, '$2');
}

// Set JID admin yang sudah di-resolve (isi saat bot connect)
// Ini untuk handle @lid format di WhatsApp multi-device
const adminJIDSet = new Set();
// Map: resolved JID → nomor asli (untuk skip sender)
const jidToAdminNum = {};

// Resolve semua nomor admin ke JID yang sesungguhnya via sock.onWhatsApp()
async function buildAdminJIDSet(sock) {
   if (WA_ADMIN_NUMBERS.length === 0) return;
   console.log('[WA] Resolving nomor admin ke JID...');
   for (const adminNum of WA_ADMIN_NUMBERS) {
      try {
         const results = await sock.onWhatsApp(adminNum);
         if (results && results.length > 0) {
            const resolvedJID = results[0].jid;
            adminJIDSet.add(resolvedJID);
            // Juga tambahkan format @s.whatsapp.net standar sebagai fallback
            adminJIDSet.add(toJID(adminNum));
            jidToAdminNum[resolvedJID] = adminNum;
            jidToAdminNum[toJID(adminNum)] = adminNum;
            console.log(`[WA] ✅ Admin ${adminNum} → ${resolvedJID}`);
         } else {
            // Tidak ada di WA, pakai @s.whatsapp.net saja
            adminJIDSet.add(toJID(adminNum));
            jidToAdminNum[toJID(adminNum)] = adminNum;
            console.warn(`[WA] ⚠️ Nomor ${adminNum} tidak ditemukan di WA, pakai JID standar`);
         }
      } catch (err) {
         console.error(`[WA] ❌ Gagal resolve JID untuk ${adminNum}:`, err.message);
         // Fallback ke format standar
         adminJIDSet.add(toJID(adminNum));
         jidToAdminNum[toJID(adminNum)] = adminNum;
      }
   }
   console.log('[WA] Admin JIDs:', [...adminJIDSet]);
}

// Helper: ekstrak nomor bersih dari JID (strip @s.whatsapp.net / @c.us / @lid)
function extractNumber(jid) {
   return jid.replace(/@s\.whatsapp\.net|@c\.us|@lid/g, '');
}

// Cache: normalized LID → true/false (isi secara lazy)
const lidCache = {};

// Helper: cek apakah JID adalah admin (async — support lazy resolve @lid)
async function isWAAdminAsync(sock, jid) {
   if (WA_ADMIN_NUMBERS.length === 0) return true;
   const normalized = normalizeJID(jid);

   // 1. Cek di resolved JID set (fast path)
   if (adminJIDSet.has(jid) || adminJIDSet.has(normalized)) return true;

   // 2. Fallback: cek berdasarkan nomor bersih (@s.whatsapp.net)
   const numClean = extractNumber(normalized).replace(/\D/g, '');
   if (numClean && WA_ADMIN_NUMBERS.some(a => a.replace(/\D/g, '') === numClean)) return true;

   // 3. Untuk @lid: cek cache dulu
   if (lidCache[normalized] !== undefined) {
      console.log(`[WA] LID cache hit ${normalized}: ${lidCache[normalized]}`);
      return lidCache[normalized];
   }

   // 4. Untuk @lid: resolve via sock.onWhatsApp (lazy, di-cache)
   if (normalized.endsWith('@lid')) {
      const lidNum = normalized.replace('@lid', '');
      console.log(`[WA] Resolving LID ${lidNum} via onWhatsApp...`);
      try {
         const results = await sock.onWhatsApp(lidNum);
         if (results && results.length > 0 && results[0].jid) {
            const phoneJID = results[0].jid;
            const phoneNum = phoneJID.replace(/@[^@]+$/, '').replace(/\D/g, '');
            const matchedAdmin = WA_ADMIN_NUMBERS.find(a => a.replace(/\D/g, '') === phoneNum);
            if (matchedAdmin) {
               // Admin terkonfirmasi — simpan ke set agar next request lebih cepat
               adminJIDSet.add(jid);
               adminJIDSet.add(normalized);
               jidToAdminNum[jid] = matchedAdmin;
               jidToAdminNum[normalized] = matchedAdmin;
               lidCache[normalized] = true;
               console.log(`[WA] ✅ LID ${normalized} → admin ${matchedAdmin}`);
               return true;
            } else {
               lidCache[normalized] = false;
               console.log(`[WA] LID ${normalized} → phone ${phoneNum} bukan admin`);
               return false;
            }
         }
      } catch (err) {
         console.log(`[WA] onWhatsApp LID lookup failed (${normalized}):`, err.message);
      }
      // Fallback gagal — blokir tapi jangan cache (bisa retry next message)
      return false;
   }

   return false;
}

// Helper: kirim pesan WA
async function sendWA(jid, text) {
   if (!waSocket) {
      console.warn('[WA] sendWA dipanggil tapi waSocket belum siap');
      return;
   }
   try {
      await waSocket.sendMessage(jid, { text });
      console.log(`[WA] ✅ Pesan terkirim ke ${jid}`);
   } catch (err) {
      console.error(`[WA] ❌ Gagal kirim pesan ke ${jid}:`, err.message);
   }
}

// Helper: notifikasi ke semua WA admin lain (kecuali sender)
async function notifyOtherWAAdmins(senderJID, notifMessage) {
   const normalizedSender = normalizeJID(senderJID);
   // Cari nomor pengirim dari JID mapping
   const senderNum = (jidToAdminNum[senderJID] || jidToAdminNum[normalizedSender] || '').replace(/\D/g, '');
   const senderDigits = extractNumber(normalizedSender).replace(/\D/g, '');

   console.log(`[WA] Notif dari ${senderJID} → num: ${senderNum || senderDigits}`);

   for (const adminNum of WA_ADMIN_NUMBERS) {
      const adminClean = adminNum.replace(/\D/g, '');
      if (senderNum && adminClean === senderNum) { console.log(`[WA] Skip sender (${adminClean})`); continue; }
      if (!senderNum && adminClean === senderDigits) { console.log(`[WA] Skip sender digit (${adminClean})`); continue; }
      const adminJID = toJID(adminNum);
      console.log(`[WA] → Notif ke ${adminClean}`);
      await sendWA(adminJID, notifMessage);
   }
}

// Helper: panggil API dan kirim hasilnya ke chat WA
async function callApiWA(jid, method, url, data = null) {
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
         await sendWA(jid, body.message);
      }
      return body;
   } catch (error) {
      const msg = error.response?.data?.message || error.message || 'Terjadi kesalahan';
      await sendWA(jid, `❌ Error: ${msg}`);
      console.error(`[WA] API Error [${method.toUpperCase()} ${url}]:`, error.response?.data || error.message);
      return null;
   }
}

// ===== HANDLER PESAN WA =====
async function handleWAMessage(sock, message) {
   try {
      const msg = message.messages?.[0];
      if (!msg || msg.key.fromMe) return;

      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith('@g.us')) return; // abaikan pesan grup

      const text = msg.message?.conversation
         || msg.message?.extendedTextMessage?.text
         || '';

      if (!text) return;

      const senderJID = normalizeJID(jid); // normalize: strip device suffix (:1, :2)
      const senderNumber = senderJID.replace('@s.whatsapp.net', '');
      const senderName = msg.pushName || senderNumber;

      // Cek akses (async — support LID resolve)
      if (WA_ADMIN_NUMBERS.length > 0 && !(await isWAAdminAsync(sock, senderJID))) {
         for (const adminNum of WA_ADMIN_NUMBERS) {
            await sendWA(toJID(adminNum),
               `⚠️ Aktivitas Tidak Dikenal\n\nUser: ${senderName}\nNomor: ${senderNumber}\nPesan: ${text}`
            );
         }
         await sendWA(senderJID, '⛔ Maaf, Anda tidak memiliki akses untuk menggunakan bot ini.');
         return;
      }

      console.log(`[WA] Pesan dari ${senderName} (${senderNumber}): ${text}`);

      const lower = text.trim();

      // ===== /start atau /help =====
      if (/^\/(start|help)$/i.test(lower)) {
         const helpText = `📋 Daftar Perintah Bot

💰 PEMASUKAN
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

💸 PENGELUARAN
/spend Kategori | Keterangan | Nominal
/spendlist - Semua pengeluaran
/spendtoday - Pengeluaran hari ini
/spendmonth - Pengeluaran bulan ini
/spenddelete <nomor>

📧 EMAIL
/email Akun | Password | Keterangan
/emaillist - Semua email tercatat
/emailedit <nomor> <field> <value>
/emaildelete <nomor>

✖️ X ACCOUNT
/x Nama | Username | Email | Status | Link
/xlist - Semua X tercatat
/xedit <nomor> <field> <value>
/xdelete <nomor>

Contoh:
/add Capcut | 1 bulan | 8000
/spend Makan | Beli nasi padang | 15000
/email test@gmail.com | pass123 | Email utama`;
         return sendWA(senderJID, helpText);
      }

      // ===== /add =====
      if (/^\/add\s+.+/i.test(lower)) {
         const raw = text.slice(4).trim();
         const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
         if (parts.length < 3) return sendWA(senderJID, 'Format salah.\nPakai:\n/add Aplikasi | Jenis | Laba\nContoh: /add Canva | lifetime | 15000');
         const aplikasi = parts[0]; const jenis = parts[1]; const laba = parseIDR(parts[2]);
         if (!aplikasi || !jenis || !isFinite(laba) || laba <= 0) return sendWA(senderJID, 'Format salah. Laba harus angka positif.');

         const result = await callApiWA(senderJID, 'post', '/incomes', { aplikasi, jenis, laba, source_user: senderName });
         if (result) {
            let monthCount = '?'; let monthTotal = 0;
            try {
               const monthRes = await api.get('/incomes/month');
               const monthData = monthRes.data;
               if (monthData.count !== undefined) monthCount = monthData.count;
               else if (monthData.data && Array.isArray(monthData.data)) monthCount = monthData.data.length;
               else if (Array.isArray(monthData)) monthCount = monthData.length;
               if (monthData.total !== undefined) monthTotal = monthData.total;
               else if (monthData.data && Array.isArray(monthData.data)) monthTotal = monthData.data.reduce((sum, item) => sum + (Number(item.laba) || 0), 0);
               else if (Array.isArray(monthData)) monthTotal = monthData.reduce((sum, item) => sum + (Number(item.laba) || 0), 0);
            } catch (err) { console.error('Gagal ambil data bulan ini:', err.message); }

            const bulanIni = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
            await sendWA(senderJID, `📊 Total Transaksi ${bulanIni}: ${monthCount} transaksi\n💰 Total Laba: Rp ${formatIDR(monthTotal)}`);
            await notifyOtherWAAdmins(senderJID, `📥 Pemasukan Baru oleh ${senderName}\n\n📱 Aplikasi: ${aplikasi}\n📦 Jenis: ${jenis}\n💰 Laba: Rp ${formatIDR(laba)}\n\n📊 Total Transaksi ${bulanIni}: ${monthCount} transaksi\n💰 Total Laba: Rp ${formatIDR(monthTotal)}`);
         }
         return;
      }

      // ===== /today =====
      if (/^\/today$/i.test(lower)) return callApiWA(senderJID, 'get', '/incomes/today');

      // ===== /yesterday =====
      if (/^\/yesterday$/i.test(lower)) return callApiWA(senderJID, 'get', '/incomes/yesterday');

      // ===== /week =====
      if (/^\/week$/i.test(lower)) return callApiWA(senderJID, 'get', '/incomes/week');

      // ===== /month =====
      if (/^\/month$/i.test(lower)) return callApiWA(senderJID, 'get', '/incomes/month');

      // ===== /list =====
      if (/^\/list$/i.test(lower)) return callApiWA(senderJID, 'get', '/incomes');

      // ===== /summary =====
      if (/^\/summary$/i.test(lower)) return callApiWA(senderJID, 'get', '/incomes/summary');

      // ===== /top =====
      if (/^\/top$/i.test(lower)) return callApiWA(senderJID, 'get', '/incomes/top');

      // ===== /stats =====
      if (/^\/stats$/i.test(lower)) return callApiWA(senderJID, 'get', '/incomes/stats');

      // ===== /edit <id> <field> <value> =====
      const editMatch = lower.match(/^\/edit\s+(\d+)\s+(\w+)\s+(.+)/i);
      if (editMatch) {
         const id = editMatch[1]; const field = editMatch[2].toLowerCase(); const value = editMatch[3].trim();
         const validFields = ['aplikasi', 'jenis', 'laba'];
         if (!validFields.includes(field)) return sendWA(senderJID, `❌ Field tidak valid. Gunakan: aplikasi, jenis, atau laba\n\nContoh:\n/edit 3 aplikasi Canva\n/edit 3 jenis lifetime\n/edit 3 laba 10000`);
         const data = {}; data[field] = field === 'laba' ? parseIDR(value) : value;
         const result = await callApiWA(senderJID, 'put', `/incomes/${id}`, data);
         if (result) await notifyOtherWAAdmins(senderJID, `✏️ Edit Pemasukan #${id} oleh ${senderName}\n\n📝 ${field}: ${value}`);
         return;
      }

      // ===== /undo =====
      if (/^\/undo$/i.test(lower)) {
         const result = await callApiWA(senderJID, 'delete', '/incomes/last');
         if (result) await notifyOtherWAAdmins(senderJID, `↩️ Undo Pemasukan Terakhir oleh ${senderName}`);
         return;
      }

      // ===== /delete <id> =====
      const deleteMatch = lower.match(/^\/delete\s+(\d+)/i);
      if (deleteMatch) {
         const result = await callApiWA(senderJID, 'delete', `/incomes/${deleteMatch[1]}`);
         if (result) await notifyOtherWAAdmins(senderJID, `🗑️ Hapus Pemasukan #${deleteMatch[1]} oleh ${senderName}`);
         return;
      }

      // ===== /spend =====
      if (/^\/spend\s+.+/i.test(lower)) {
         const raw = text.slice(6).trim();
         const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
         if (parts.length < 3) return sendWA(senderJID, '❌ Format salah.\nPakai:\n/spend Kategori | Keterangan | Nominal\n\nContoh:\n/spend Makan | Beli nasi padang | 15000');
         const kategori = parts[0]; const keterangan = parts[1]; const nominal = parseIDR(parts[2]);
         if (!kategori || !keterangan || !isFinite(nominal) || nominal <= 0) return sendWA(senderJID, '❌ Format salah. Nominal harus angka positif.');
         const result = await callApiWA(senderJID, 'post', '/expenses', { kategori, keterangan, nominal, source_user: senderName });
         if (result) await notifyOtherWAAdmins(senderJID, `💸 Pengeluaran Baru oleh ${senderName}\n\n📂 Kategori: ${kategori}\n📝 Keterangan: ${keterangan}\n💵 Nominal: Rp ${formatIDR(nominal)}`);
         return;
      }

      // ===== /spendlist =====
      if (/^\/spendlist$/i.test(lower)) return callApiWA(senderJID, 'get', '/expenses');

      // ===== /spendtoday =====
      if (/^\/spendtoday$/i.test(lower)) return callApiWA(senderJID, 'get', '/expenses/today');

      // ===== /spendmonth =====
      if (/^\/spendmonth$/i.test(lower)) return callApiWA(senderJID, 'get', '/expenses/month');

      // ===== /spenddelete <id> =====
      const spendDeleteMatch = lower.match(/^\/spenddelete\s+(\d+)/i);
      if (spendDeleteMatch) {
         const result = await callApiWA(senderJID, 'delete', `/expenses/${spendDeleteMatch[1]}`);
         if (result) await notifyOtherWAAdmins(senderJID, `🗑️ Hapus Pengeluaran #${spendDeleteMatch[1]} oleh ${senderName}`);
         return;
      }

      // ===== /email =====
      if (/^\/email\s+.+/i.test(lower)) {
         const raw = text.slice(6).trim();
         const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
         if (parts.length < 3) return sendWA(senderJID, '❌ Format salah.\nPakai:\n/email Akun | Password | Keterangan\n\nContoh:\n/email test@gmail.com | password123 | Email utama');
         const result = await callApiWA(senderJID, 'post', '/emails', { akun: parts[0], password: parts[1], keterangan: parts[2], source_user: senderName });
         if (result) await notifyOtherWAAdmins(senderJID, `📧 Email Baru Ditambahkan oleh ${senderName}\n\n📬 Akun: ${parts[0]}\n📝 Keterangan: ${parts[2]}`);
         return;
      }

      // ===== /emaillist =====
      if (/^\/emaillist$/i.test(lower)) return callApiWA(senderJID, 'get', '/emails');

      // ===== /emailedit <id> <field> <value> =====
      const emailEditMatch = lower.match(/^\/emailedit\s+(\d+)\s+(\w+)\s+(.+)/i);
      if (emailEditMatch) {
         const id = emailEditMatch[1]; const field = emailEditMatch[2].toLowerCase(); const value = emailEditMatch[3].trim();
         const validFields = ['akun', 'password', 'keterangan'];
         if (!validFields.includes(field)) return sendWA(senderJID, `❌ Field tidak valid. Gunakan: akun, password, atau keterangan`);
         const data = {}; data[field] = value;
         const result = await callApiWA(senderJID, 'put', `/emails/${id}`, data);
         if (result) await notifyOtherWAAdmins(senderJID, `✏️ Edit Email #${id} oleh ${senderName}\n\n📝 ${field}: ${value}`);
         return;
      }

      // ===== /emaildelete <id> =====
      const emailDeleteMatch = lower.match(/^\/emaildelete\s+(\d+)/i);
      if (emailDeleteMatch) {
         const result = await callApiWA(senderJID, 'delete', `/emails/${emailDeleteMatch[1]}`);
         if (result) await notifyOtherWAAdmins(senderJID, `🗑️ Hapus Email #${emailDeleteMatch[1]} oleh ${senderName}`);
         return;
      }

      // ===== /x =====
      if (/^\/x\s+.+/i.test(lower)) {
         const raw = text.slice(3).trim();
         const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
         if (parts.length < 5) return sendWA(senderJID, '❌ Format salah.\nPakai:\n/x Nama | Username | Email | Status | Link\n\nContoh:\n/x Akun Pribadi | @johndoe | john@gmail.com | Aktif | https://x.com/johndoe');
         const result = await callApiWA(senderJID, 'post', '/x-accounts', { nama: parts[0], username: parts[1], email: parts[2], status: parts[3], link: parts[4], source_user: senderName });
         if (result) await notifyOtherWAAdmins(senderJID, `✖️ X Account Baru Ditambahkan oleh ${senderName}\n\n👤 Nama: ${parts[0]}\n🔗 Username: ${parts[1]}`);
         return;
      }

      // ===== /xlist =====
      if (/^\/xlist$/i.test(lower)) return callApiWA(senderJID, 'get', '/x-accounts');

      // ===== /xedit <id> <field> <value> =====
      const xEditMatch = lower.match(/^\/xedit\s+(\d+)\s+(\w+)\s+(.+)/i);
      if (xEditMatch) {
         const id = xEditMatch[1]; const field = xEditMatch[2].toLowerCase(); const value = xEditMatch[3].trim();
         const validFields = ['nama', 'username', 'email', 'status', 'link'];
         if (!validFields.includes(field)) return sendWA(senderJID, `❌ Field tidak valid. Gunakan: nama, username, email, status, atau link`);
         const data = {}; data[field] = value;
         const result = await callApiWA(senderJID, 'put', `/x-accounts/${id}`, data);
         if (result) await notifyOtherWAAdmins(senderJID, `✏️ Edit X Account #${id} oleh ${senderName}\n\n📝 ${field}: ${value}`);
         return;
      }

      // ===== /xdelete <id> =====
      const xDeleteMatch = lower.match(/^\/xdelete\s+(\d+)/i);
      if (xDeleteMatch) {
         const result = await callApiWA(senderJID, 'delete', `/x-accounts/${xDeleteMatch[1]}`);
         if (result) await notifyOtherWAAdmins(senderJID, `🗑️ Hapus X Account #${xDeleteMatch[1]} oleh ${senderName}`);
         return;
      }

      // ===== /mynumber =====
      if (/^\/mynumber$/i.test(lower)) {
         return sendWA(senderJID, `📱 Nomor WA Anda: ${senderNumber}\n\nMasukkan nomor ini ke WA_ADMIN_NUMBERS di file .env (tanpa +, contoh: 6281234567890). Pisahkan dengan koma jika lebih dari satu admin.`);
      }

   } catch (err) {
      console.error('[WA] Error handling message:', err);
   }
}

// ===== INIT WHATSAPP BOT =====
async function startWABot() {
   // Pastikan folder session ada
   if (!fs.existsSync(WA_SESSION_DIR)) {
      fs.mkdirSync(WA_SESSION_DIR, { recursive: true });
   }

   const { state, saveCreds } = await useMultiFileAuthState(WA_SESSION_DIR);
   const { version } = await fetchLatestBaileysVersion();

   console.log(`\n📱 Starting WhatsApp Bot (Baileys v${version.join('.')})...`);

   const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false, // kita handle sendiri
      logger: { level: 'silent', trace: () => {}, debug: () => {}, info: () => {}, warn: (m) => console.warn('[WA]', m), error: (m) => console.error('[WA]', m), fatal: (m) => console.error('[WA FATAL]', m), child: () => ({ level: 'silent', trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, child: () => {} }) },
      browser: ['Bot Note Buy', 'Chrome', '1.0.0'],
   });

   waSocket = sock;

   // Event: QR Code
   sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
         console.log('\n📲 Scan QR Code ini dengan WhatsApp kamu:\n');
         qrcode.generate(qr, { small: true });
         console.log('\n');
      }

      if (connection === 'close') {
         const statusCode = (lastDisconnect?.error instanceof Boom)
            ? lastDisconnect.error.output?.statusCode
            : null;

         const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
         console.log(`[WA] Koneksi terputus (kode: ${statusCode}). Reconnect: ${shouldReconnect}`);

         if (shouldReconnect) {
            console.log('[WA] Mencoba reconnect dalam 5 detik...');
            setTimeout(startWABot, 5000);
         } else {
            console.log('[WA] Logged out. Hapus folder wa_session/ lalu restart untuk scan QR ulang.');
         }
      } else if (connection === 'open') {
         console.log('✅ WhatsApp Bot terhubung!');
         if (WA_ADMIN_NUMBERS.length === 0) {
            console.log('⚠️  WA_ADMIN_NUMBERS belum diset di .env. Semua pengguna bisa akses bot!');
            console.log('    Kirim /mynumber ke WA bot untuk mendapatkan nomor Anda.');
         } else {
            // Resolve nomor admin ke JID (penting untuk handle @lid)
            await buildAdminJIDSet(sock);
         }
      }
   });

   // Event: Simpan credentials
   sock.ev.on('creds.update', saveCreds);

   // Event: Contacts update — tangkap LID admin dari kontak yang dikenal WA
   sock.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
         const contactJID = contact.id || '';
         // Cek apakah ini kontak admin (berdasarkan nomor @s.whatsapp.net)
         if (!contactJID.endsWith('@s.whatsapp.net') && !contactJID.endsWith('@c.us')) continue;
         const contactNum = contactJID.replace(/@s\.whatsapp\.net|@c\.us/g, '').replace(/\D/g, '');
         const matchedAdmin = WA_ADMIN_NUMBERS.find(n => n.replace(/\D/g, '') === contactNum);
         if (!matchedAdmin) continue;

         // Jika kontak ini punya LID, tambahkan ke adminJIDSet
         if (contact.lid) {
            const normalizedLid = normalizeJID(contact.lid);
            adminJIDSet.add(contact.lid);
            adminJIDSet.add(normalizedLid);
            jidToAdminNum[contact.lid] = matchedAdmin;
            jidToAdminNum[normalizedLid] = matchedAdmin;
            console.log(`[WA] Admin LID dari contacts: ${matchedAdmin} → ${contact.lid}`);
         }
      }
   });

   // Event: Pesan masuk
   sock.ev.on('messages.upsert', (message) => handleWAMessage(sock, message));
}

// Mulai WA bot
startWABot().catch(err => {
   console.error('[WA] Gagal start WhatsApp bot:', err.message);
});

console.log('✅ Bot is running!');
console.log('📡 Telegram: Active');
console.log('📱 WhatsApp: Starting...');
console.log(`🔗 API: ${API_BASE_URL}`);
