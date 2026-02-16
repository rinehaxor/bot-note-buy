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
3. Buka Google Sheet Anda: https://docs.google.com/spreadsheets
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
