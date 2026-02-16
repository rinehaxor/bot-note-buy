# 🤖 Telegram Bot - Note Buy

Bot Telegram untuk mencatat transaksi ke Google Sheets secara otomatis.

## 📋 Fitur

- `/start` - Tampilkan menu bantuan
- `/help` - Tampilkan menu bantuan
- `/add Aplikasi | Jenis | Laba` - Tambah transaksi baru
- `/today` - Lihat ringkasan transaksi hari ini
- `/yesterday` - Lihat ringkasan transaksi kemarin
- `/list` - Lihat semua transaksi (semua hari)
- `/summary` - Ringkasan per aplikasi (jumlah + total)
- `/edit <nomor> <field> <value>` - Edit entry tertentu
- `/undo` - Hapus transaksi terakhir
- `/delete <nomor>` - Hapus transaksi berdasarkan nomor (otomatis renumber)

## 🚀 Setup Google Cloud (GRATIS - Cuma sekali, 5-10 menit)

### Step 1: Buat Google Cloud Project

1. Buka https://console.cloud.google.com
2. Login dengan akun Google Anda
3. Klik **"Select a project"** di atas → **"NEW PROJECT"**
4. Isi nama project (contoh: `telegram-bot-sheets`)
5. Klik **CREATE**
6. Tunggu beberapa detik, lalu pilih project yang baru dibuat

### Step 2: Aktifkan Google Sheets API

1. Di menu sebelah kiri, klik **"APIs & Services"** → **"Library"**
2. Cari **"Google Sheets API"**
3. Klik hasil pertama
4. Klik tombol **"ENABLE"**
5. Tunggu sampai enabled

### Step 3: Buat Service Account

1. Di menu sebelah kiri, klik **"APIs & Services"** → **"Credentials"**
2. Klik **"+ CREATE CREDENTIALS"** di atas
3. Pilih **"Service account"**
4. Isi form:
   - **Service account name**: `telegram-bot` (atau nama lain)
   - **Service account ID**: otomatis terisi
5. Klik **CREATE AND CONTINUE**
6. Skip **"Grant this service account access to project"** → klik **CONTINUE**
7. Skip **"Grant users access to this service account"** → klik **DONE**

### Step 4: Download Credentials

1. Anda akan melihat service account yang baru dibuat di daftar
2. Klik **email service account** (contoh: `telegram-bot@PROJECT_ID.iam.gserviceaccount.com`)
3. Klik tab **"KEYS"**
4. Klik **"ADD KEY"** → **"Create new key"**
5. Pilih **JSON**
6. Klik **CREATE**
7. File `credentials.json` akan terdownload otomatis
8. **SIMPAN FILE INI DI FOLDER BOT** (`d:\bot\bot-note-buy\credentials.json`)

### Step 5: Share Google Sheet dengan Service Account

1. Buka file `credentials.json` yang baru didownload
2. Copy email yang ada di field `"client_email"` (contoh: `telegram-bot@PROJECT_ID.iam.gserviceaccount.com`)
3. Buka Google Sheet Anda: https://docs.google.com/spreadsheets/d/1BXrH-1jb2zwsss5STFwo3HcCcsooTym5R8Gn2NBTHcI
4. Klik tombol **"Share"** di kanan atas
5. Paste email service account tadi
6. Pastikan permission: **Editor**
7. **UNCHECK** "Notify people" (biar ga kirim email)
8. Klik **Share**

**✅ Setup Google Cloud SELESAI!**

---

## 💻 Setup Bot di Komputer/VPS

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Setup Environment Variables

1. Copy file `.env.example` menjadi `.env`:

   ```bash
   copy .env.example .env
   ```

2. Buka file `credentials.json` yang sudah didownload

3. Edit file `.env` dan isi:

   ```env
   TELEGRAM_BOT_TOKEN=8537885645:AAEPjgFQGMUhPcR3Kh_8erBFnzPc5TbzIIk
   SPREADSHEET_ID=1BXrH-1jb2zwsss5STFwo3HcCcsooTym5R8Gn2NBTHcI
   SEED_SHEET_NAME=SEED

   # Copy dari credentials.json field "client_email"
   GOOGLE_SERVICE_ACCOUNT_EMAIL=telegram-bot@PROJECT_ID.iam.gserviceaccount.com

   # Copy dari credentials.json field "private_key" (HARUS dalam 1 line, jangan hapus \\n)
   GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...(copy semua)...xxxx\n-----END PRIVATE KEY-----\n

   TZ=Asia/Jakarta
   ```

   **PENTING untuk GOOGLE_PRIVATE_KEY:**
   - Copy SEMUA isi dari field `"private_key"` di `credentials.json`
   - Paste dalam SATU BARIS
   - Jangan hapus `\n` di dalamnya
   - Contoh yang benar:
      ```
      GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0...\n...\n-----END PRIVATE KEY-----\n
      ```

### Step 3: Jalankan Bot

```bash
npm start
```

Jika berhasil, akan muncul:

```
🤖 Bot started successfully!
✅ Bot is running and waiting for messages...
```

### Step 4: Test Bot

Buka Telegram dan kirim pesan ke bot:

1. `/start` - Lihat menu
2. `/add Canva | lifetime | 15000` - Tambah data
3. `/today` - Lihat transaksi hari ini
4. `/yesterday` - Lihat transaksi kemarin
5. `/list` - Lihat semua transaksi
6. `/summary` - Lihat ringkasan per aplikasi
7. `/edit 3 laba 10000` - Edit laba entry #3
8. `/undo` - Hapus entry terakhir
9. `/delete 3` - Hapus entry nomor 3 (otomatis renumber)

---

## 🖥️ Deploy ke VPS

### 1. Upload File ke VPS

```bash
scp -r d:\bot\bot-note-buy root@YOUR_VPS_IP:/root/
```

Atau gunakan FileZilla/WinSCP

**JANGAN LUPA upload `credentials.json` dan `.env`!**

### 2. SSH ke VPS

```bash
ssh root@YOUR_VPS_IP
```

### 3. Install Node.js (jika belum ada)

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Verify
node -v
npm -v
```

### 4. Masuk ke folder bot dan install

```bash
cd /root/bot-note-buy
npm install
```

### 5. Test jalankan

```bash
npm start
```

Pastikan bot jalan dan test dengan Telegram.

Press `Ctrl+C` untuk stop.

### 6. Setup PM2 (agar bot jalan terus)

```bash
# Install PM2
npm install -g pm2

# Jalankan bot dengan PM2
pm2 start index-nodejs.js --name telegram-bot

# Auto-start saat VPS restart
pm2 startup
pm2 save

# Commands berguna:
pm2 status          # Lihat status
pm2 logs            # Lihat logs
pm2 restart telegram-bot  # Restart bot
pm2 stop telegram-bot     # Stop bot
```

**✅ BOT SUDAH JALAN DI VPS!**

---

## 📁 Struktur File

```
bot-note-buy/
├── index.js              # (kode lama Google Apps Script)
├── index-nodejs.js       # 🆕 Kode baru untuk VPS
├── package.json          # Dependencies
├── .env                  # Config (JANGAN commit ke git!)
├── .env.example          # Template config
├── credentials.json      # Google Service Account (JANGAN commit!)
├── .gitignore           # Ignore sensitive files
└── README.md            # Dokumentasi ini
```

---

## ⚠️ Troubleshooting

### Error: "Cannot find module 'node-telegram-bot-api'"

**Solusi:** Jalankan `npm install`

### Error: "Invalid credentials"

**Solusi:**

- Pastikan `GOOGLE_SERVICE_ACCOUNT_EMAIL` dan `GOOGLE_PRIVATE_KEY` di `.env` benar
- Pastikan Google Sheet sudah di-share ke service account email
- Pastikan `GOOGLE_PRIVATE_KEY` tidak putus (harus 1 line dengan `\n` di dalamnya)

### Error: "Seed sheet tidak ditemukan"

**Solusi:**

- Pastikan nama sheet di Google Sheets benar-benar `SEED` (case sensitive)
- Atau ubah `SEED_SHEET_NAME` di `.env` sesuai nama sheet Anda

### Bot tidak response

**Solusi:**

- Cek apakah bot masih running: `pm2 status`
- Lihat logs: `pm2 logs telegram-bot`
- Pastikan `TELEGRAM_BOT_TOKEN` benar

---

## 🔒 Keamanan

**PENTING:** Jangan commit file berikut ke Git/GitHub:

- `.env` - Berisi token dan credentials
- `credentials.json` - Service account credentials

File-file ini sudah ditambahkan ke `.gitignore`.

---

## 📝 Notes

- File `index.js` (kode lama) tidak perlu dihapus, sebagai backup
- File yang dijalankan sekarang: `index-nodejs.js`
- Google Sheets API gratis untuk personal use
- Bot menggunakan polling (bukan webhook) untuk lebih mudah di VPS

---

Jika ada pertanyaan atau error, hubungi developer! 🚀
