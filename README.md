# Nutri Calc

Aplikasi web (PWA) untuk mencatat makanan dan minuman harian, menghitung **34 zat gizi**, dan membandingkannya dengan target harian berdasarkan **AKG (Permenkes No. 28 Tahun 2019)**, usia, jenis kelamin, berat, tinggi, aktivitas, dan tujuan.

- **1.334 bahan** di daftar utama: seluruh **1.146 item TKPI 2017**, 123 bahan USDA dengan nama Indonesia, dan 65 menu jadi/suplemen.
- **8.789 bahan USDA SR Legacy** lengkap (nama bahasa Inggris), dimuat hanya saat dicari.
- Banyak profil (untuk keluarga atau klien), riwayat harian, grafik 7/30/90 hari, ekspor CSV, cadangan JSON.
- Bisa dipasang di HP (Tambahkan ke Layar Utama) dan tetap jalan tanpa internet.
- Data pribadi hanya tersimpan di perangkat masing-masing pengguna. Tidak ada server atau akun.

## Isi folder

| Folder / file | Isi |
|---|---|
| `data/tambahan.csv` | **Tempat utama menambah makanan secara manual** (label kemasan, menu restoran, resep, suplemen). |
| `data/porsi_tkpi.csv` | Ukuran 1 porsi untuk item TKPI (mis. nasi 1 piring = 150 g). |
| `data/akg.csv` | Tabel AKG 2019 per kelompok umur dan jenis kelamin. |
| `data/sumber/tkpi.csv` | Seluruh TKPI 2017 hasil penyalinan dari PDF, per 100 g bagian dapat dimakan (BDD). |
| `data/sumber/usda_sr28.csv` | USDA SR Legacy Release 28 (domain publik). |
| `data/sumber/usda_pilihan.csv` | Bahan USDA yang ditampilkan di daftar utama dengan nama Indonesia. |
| `data/sumber/tkpi_lengkapi.csv` | Padanan TKPI → USDA untuk mengisi zat gizi yang tidak dimuat TKPI (lemak jenuh, kolesterol, gula, vitamin B6/B12/D/E/K, dll). |
| `tools/build.py` | Menyusun semua CSV menjadi `public/data/*.json`. |
| `public/` | Aplikasi yang diterbitkan (HTML, CSS, JS, ikon, database JSON). |

## Menambah atau memperbaiki data makanan

1. Buka `data/tambahan.csv` (Excel, Google Sheets, atau langsung di GitHub). Satu baris = satu makanan.
2. Isi kolom:
   - `id`: kode unik huruf kecil tanpa spasi, mis. `granola-merek-x`.
   - `nama`, `kategori`, `porsi` (gram 1 porsi), `porsi_ket` (mis. `1 bungkus`).
   - `sumber`: `Label`, `Resep`, `Perkiraan`, atau `Turunan TKPI`.
   - `catatan`: dari mana angkanya.
   - Kolom zat gizi **per 100 g** (atau 100 ml). Label kemasan biasanya per sajian: bagi dengan berat sajian lalu kali 100.
   - **Kosongkan** kolom yang tidak diketahui. Jangan tulis 0 kecuali memang nol.
3. Simpan sebagai CSV UTF-8, lalu commit/unggah ke GitHub. GitHub Actions menjalankan `tools/build.py` dan menerbitkan ulang aplikasi dalam 1–2 menit.
4. Pengguna yang membuka aplikasi akan otomatis mendapat database baru (muncul pesan "Database diperbarui").

Makanan yang dibuat pengguna di aplikasi (Data → Makanan buatan saya) bisa diunduh sebagai CSV dengan format yang sama, lalu tempelkan barisnya ke `data/tambahan.csv`.

Untuk memeriksa di komputer sendiri: `python3 tools/build.py` lalu `python3 -m http.server -d public 8000` dan buka http://localhost:8000.

## Cara menghitung target

- **Energi** (dewasa ≥18 th): BMR Mifflin-St Jeor × faktor aktivitas, lalu disesuaikan dengan tujuan: otot lean +250 kkal, turun lemak −400, naik berat +500, jaga 0.
- **Protein**: otot lean 1,8 g/kg, turun lemak 2,0, naik berat 1,8, jaga 1,2; tidak pernah di bawah AKG.
- **Lemak** 25% energi; **karbohidrat** sisa energi; **serat** 14 g per 1.000 kkal.
- **Batas**: gula ≤50 g (maks. 10% energi), natrium ≤2.000 mg, lemak jenuh <10% energi, kolesterol <300 mg.
- **Vitamin dan mineral**: AKG 2019 sesuai umur dan jenis kelamin. Di bawah 18 tahun, energi dan makro memakai AKG langsung.
- **Komposisi tubuh**: IMT batas Asia-Pasifik, lingkar pinggang (risiko ≥90 cm laki-laki, ≥80 cm perempuan), rasio pinggang/tinggi <0,5.

Kehamilan dan menyusui belum dihitung. Angka AKG di `data/akg.csv` sebaiknya dicocokkan ulang dengan naskah Permenkes 28/2019 sebelum dipakai untuk konseling.

## Catatan kualitas data

- Nilai TKPI per 100 g **bagian yang dapat dimakan**: masukkan berat tanpa tulang, kulit, atau biji.
- Kolom bertanda sumber USDA pada item TKPI berasal dari bahan padanan USDA, bukan analisis TKPI.
- Total di aplikasi diberi tanda **≥** bila ada makanan yang belum punya data zat gizi itu.
- Menu jadi bertanda **Perkiraan** belum diverifikasi dan bisa berbeda jauh tergantung resep.

## Sumber

- Tabel Komposisi Pangan Indonesia 2017, Kementerian Kesehatan RI.
- U.S. Department of Agriculture, Agricultural Research Service. USDA National Nutrient Database for Standard Reference, Legacy Release (domain publik).
- Peraturan Menteri Kesehatan RI No. 28 Tahun 2019 tentang Angka Kecukupan Gizi.

Aplikasi ini alat bantu edukasi, bukan pengganti saran dokter atau ahli gizi.
