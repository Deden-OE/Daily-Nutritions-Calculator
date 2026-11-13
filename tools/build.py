#!/usr/bin/env python3
"""Menyusun database aplikasi dari file sumber di folder data/.

    python3 tools/build.py

Masukan (boleh disunting di Excel / Google Sheets, simpan tetap sebagai CSV UTF-8):
  data/sumber/tkpi.csv          Seluruh 1.146 item TKPI 2017 (per 100 g BDD)
  data/sumber/usda_sr28.csv     USDA SR Legacy (Release 28), 8.789 item, domain publik
  data/sumber/usda_pilihan.csv  Item USDA yang diberi nama Indonesia dan ditampilkan di daftar utama
  data/sumber/tkpi_lengkapi.csv Padanan TKPI -> USDA untuk mengisi zat gizi yang tidak dimuat TKPI
  data/porsi_tkpi.csv           Ukuran 1 porsi untuk item TKPI
  data/tambahan.csv             Item tambahan manual (label kemasan, menu restoran, suplemen, resep)
  data/akg.csv                  Angka Kecukupan Gizi (Permenkes 28/2019)

Keluaran:
  public/data/foods.json        Database utama yang dibaca aplikasi
  public/data/usda.json         Seluruh USDA SR28 (dimuat hanya saat pengguna mencari "USDA lengkap")
  public/data/akg.json

Skrip berhenti dan menyebut baris yang bermasalah bila ada id ganda, angka tidak valid,
atau kolom yang hilang. Nilai kosong berarti "tidak diketahui", bukan nol.
"""
import csv
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data')
OUT = os.path.join(ROOT, 'public', 'data')

# Kunci zat gizi aplikasi. Semua per 100 g (atau 100 ml untuk minuman).
NUTRIENTS = [
    # key, label, unit, kelompok
    ('energi', 'Energi', 'kkal', 'Makro'),
    ('protein', 'Protein', 'g', 'Makro'),
    ('lemak', 'Lemak total', 'g', 'Makro'),
    ('lemak_jenuh', 'Lemak jenuh', 'g', 'Lemak'),
    ('lemak_tunggal', 'Lemak tak jenuh tunggal', 'g', 'Lemak'),
    ('lemak_ganda', 'Lemak tak jenuh ganda', 'g', 'Lemak'),
    ('kolesterol', 'Kolesterol', 'mg', 'Lemak'),
    ('kh', 'Karbohidrat', 'g', 'Makro'),
    ('serat', 'Serat', 'g', 'Makro'),
    ('gula', 'Gula', 'g', 'Makro'),
    ('air', 'Air', 'g', 'Makro'),
    ('kalsium', 'Kalsium', 'mg', 'Mineral'),
    ('fosfor', 'Fosfor', 'mg', 'Mineral'),
    ('besi', 'Zat besi', 'mg', 'Mineral'),
    ('natrium', 'Natrium', 'mg', 'Mineral'),
    ('kalium', 'Kalium', 'mg', 'Mineral'),
    ('magnesium', 'Magnesium', 'mg', 'Mineral'),
    ('seng', 'Seng (zinc)', 'mg', 'Mineral'),
    ('tembaga', 'Tembaga', 'mg', 'Mineral'),
    ('mangan', 'Mangan', 'mg', 'Mineral'),
    ('selenium', 'Selenium', 'µg', 'Mineral'),
    ('vita', 'Vitamin A', 'µg RE', 'Vitamin'),
    ('vitc', 'Vitamin C', 'mg', 'Vitamin'),
    ('vitd', 'Vitamin D', 'µg', 'Vitamin'),
    ('vite', 'Vitamin E', 'mg', 'Vitamin'),
    ('vitk', 'Vitamin K', 'µg', 'Vitamin'),
    ('thiamin', 'Vitamin B1 (tiamin)', 'mg', 'Vitamin'),
    ('riboflavin', 'Vitamin B2 (riboflavin)', 'mg', 'Vitamin'),
    ('niasin', 'Vitamin B3 (niasin)', 'mg', 'Vitamin'),
    ('pantotenat', 'Vitamin B5 (pantotenat)', 'mg', 'Vitamin'),
    ('vitb6', 'Vitamin B6', 'mg', 'Vitamin'),
    ('folat', 'Folat', 'µg', 'Vitamin'),
    ('vitb12', 'Vitamin B12', 'µg', 'Vitamin'),
    ('kolin', 'Kolin', 'mg', 'Vitamin'),
]
KEYS = [n[0] for n in NUTRIENTS]

USDA_MAP = {  # kolom usda_sr28.csv -> kunci aplikasi
    'energi': 'energi', 'protein': 'protein', 'lemak': 'lemak', 'lemak_jenuh': 'lemak_jenuh',
    'lemak_tunggal': 'lemak_tunggal', 'lemak_ganda': 'lemak_ganda', 'kolesterol': 'kolesterol',
    'kh': 'kh', 'serat': 'serat', 'gula': 'gula', 'air': 'air', 'kalsium': 'kalsium',
    'fosfor': 'fosfor', 'besi': 'besi', 'natrium': 'natrium', 'kalium': 'kalium',
    'magnesium': 'magnesium', 'seng': 'seng', 'tembaga': 'tembaga', 'mangan': 'mangan',
    'selenium': 'selenium', 'vita_rae': 'vita', 'vitc': 'vitc', 'vitd': 'vitd', 'vite': 'vite',
    'vitk': 'vitk', 'thiamin': 'thiamin', 'riboflavin': 'riboflavin', 'niasin': 'niasin',
    'pantotenat': 'pantotenat', 'vitb6': 'vitb6', 'folat_dfe': 'folat', 'vitb12': 'vitb12',
    'kolin': 'kolin',
}
# Zat gizi yang memang tidak dimuat TKPI, boleh diisi dari padanan USDA.
TKPI_TIDAK_ADA = ['lemak_jenuh', 'lemak_tunggal', 'lemak_ganda', 'kolesterol', 'gula', 'magnesium',
                  'mangan', 'selenium', 'vitd', 'vite', 'vitk', 'pantotenat', 'vitb6', 'folat',
                  'vitb12', 'kolin']

errors = []


def num(v, where):
    if v is None:
        return None
    s = str(v).strip().replace(',', '.')
    if s in ('', '-', '?'):
        return None
    try:
        f = float(s)
    except ValueError:
        errors.append('%s: "%s" bukan angka' % (where, v))
        return None
    if f < 0:
        errors.append('%s: nilai negatif %s' % (where, v))
    return round(f, 3)


def read(path):
    with open(path, encoding='utf-8-sig', newline='') as fh:
        return list(csv.DictReader(fh))


def compact(vals):
    return {k: v for k, v in vals.items() if v is not None}


def main():
    usda_rows = read(os.path.join(D, 'sumber', 'usda_sr28.csv'))
    usda = {}
    for r in usda_rows:
        vals = {USDA_MAP[c]: num(r.get(c), 'usda %s %s' % (r['ndb'], c)) for c in USDA_MAP}
        usda[r['ndb']] = {'nama_en': r['nama_en'], 'v': compact(vals), 'grup': r['grup']}

    foods, ids = [], set()

    def add(f):
        if f['id'] in ids:
            errors.append('id ganda: %s' % f['id'])
        ids.add(f['id'])
        e = f['v'].get('energi')
        p, l, k = (f['v'].get(x) or 0 for x in ('protein', 'lemak', 'kh'))
        if e is None:
            errors.append('%s (%s): energi kosong' % (f['id'], f['n']))
        foods.append(f)

    # 1. TKPI
    porsi = {r['kode']: r for r in read(os.path.join(D, 'porsi_tkpi.csv'))}
    lengkapi = {r['kode']: r for r in read(os.path.join(D, 'sumber', 'tkpi_lengkapi.csv'))}
    for r in read(os.path.join(D, 'sumber', 'tkpi.csv')):
        kode = r['kode']
        g = lambda c: num(r.get(c), 'tkpi %s %s' % (kode, c))
        v = {k: None for k in KEYS}
        for k in ('energi', 'protein', 'lemak', 'kh', 'serat', 'air', 'kalsium', 'fosfor', 'besi',
                  'natrium', 'kalium', 'tembaga', 'seng', 'thiamin', 'riboflavin', 'niasin'):
            v[k] = g(k)
        v['vitc'] = g('vitc')
        ret, bkar, kart = g('retinol'), g('bkar'), g('kartot')
        if ret is not None or bkar is not None:
            v['vita'] = round((ret or 0) + (bkar or 0) / 6, 1)
        elif kart is not None:
            v['vita'] = round(kart / 12, 1)
        notes = [r['catatan']] if r.get('catatan') else []
        lk = lengkapi.get(kode)
        isi = []
        if lk and lk['ndb'] in usda:
            uv = usda[lk['ndb']]['v']
            for k in TKPI_TIDAK_ADA:
                if v.get(k) is None and uv.get(k) is not None:
                    v[k] = uv[k]
                    isi.append(k)
            if isi:
                notes.append('Zat gizi yang tidak dimuat TKPI (%s) diisi dari USDA %s (%s)'
                             % (', '.join(isi), lk['ndb'], usda[lk['ndb']]['nama_en']))
        pr = porsi.get(kode, {})
        add({
            'id': 'tkpi-' + kode.lower(), 'n': r['nama'], 'k': r['kelompok'], 's': 'TKPI', 'c': kode,
            'p': num(pr.get('porsi'), 'porsi ' + kode) or 100, 'pk': pr.get('porsi_ket', ''),
            'bdd': num(r.get('bdd'), 'bdd ' + kode),
            'v': compact(v), 'x': isi, 'note': '; '.join(notes),
            'src': 'TKPI 2017, %s (sumber asal %s)' % (kode, r['sumber_data']),
        })

    # 2. USDA pilihan
    for r in read(os.path.join(D, 'sumber', 'usda_pilihan.csv')):
        u = usda.get(r['ndb'])
        if not u:
            errors.append('usda_pilihan: ndb %s tidak ada di usda_sr28.csv' % r['ndb'])
            continue
        add({
            'id': 'usda-' + r['ndb'], 'n': r['nama'], 'k': r['kategori'], 's': 'USDA', 'c': r['ndb'],
            'p': num(r['porsi'], 'porsi usda ' + r['ndb']) or 100, 'pk': r.get('porsi_ket', ''),
            'v': u['v'], 'note': '', 'src': 'USDA SR Legacy %s: %s' % (r['ndb'], u['nama_en']),
        })

    # 3. Tambahan manual
    for i, r in enumerate(read(os.path.join(D, 'tambahan.csv')), start=2):
        if not (r.get('id') or '').strip():
            errors.append('tambahan.csv baris %d: id kosong' % i)
            continue
        missing = [k for k in KEYS if k not in r]
        if missing:
            errors.append('tambahan.csv: kolom hilang %s' % ', '.join(missing))
            break
        v = {k: num(r[k], 'tambahan.csv baris %d kolom %s' % (i, k)) for k in KEYS}
        add({
            'id': r['id'].strip(), 'n': r['nama'].strip(), 'k': r['kategori'].strip() or 'Lainnya',
            's': r.get('sumber', '').strip() or 'Tambahan', 'c': '',
            'p': num(r['porsi'], 'tambahan.csv baris %d porsi' % i) or 100, 'pk': r.get('porsi_ket', ''),
            'v': compact(v), 'note': r.get('catatan', ''), 'src': r.get('sumber', '') or 'Tambahan',
        })

    akg = []
    for r in read(os.path.join(D, 'akg.csv')):
        row = {'jk': r['jk'], 'min': int(r['usia_min']), 'max': int(r['usia_max'])}
        for k, val in r.items():
            if k not in ('jk', 'usia_min', 'usia_max'):
                row[k] = num(val, 'akg ' + k)
        akg.append(row)

    if errors:
        print('GAGAL, perbaiki dulu:')
        for e in errors[:50]:
            print('  -', e)
        sys.exit(1)

    os.makedirs(OUT, exist_ok=True)
    version = datetime.now(timezone.utc).strftime('%Y%m%d%H%M')
    meta = {'version': version, 'nutrients': [dict(zip(('key', 'label', 'unit', 'group'), n)) for n in NUTRIENTS]}
    with open(os.path.join(OUT, 'foods.json'), 'w', encoding='utf-8') as fh:
        json.dump({**meta, 'foods': foods}, fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'usda.json'), 'w', encoding='utf-8') as fh:
        json.dump([{'id': 'usda-' + k, 'n': u['nama_en'], 'v': u['v']} for k, u in usda.items()],
                  fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'akg.json'), 'w', encoding='utf-8') as fh:
        json.dump(akg, fh, separators=(',', ':'))
    with open(os.path.join(OUT, 'version.json'), 'w') as fh:
        json.dump({'version': version, 'items': len(foods)}, fh)

    by = {}
    for f in foods:
        by[f['s']] = by.get(f['s'], 0) + 1
    print('foods.json: %d item %s, usda.json: %d item, versi %s' % (len(foods), by, len(usda), version))


if __name__ == '__main__':
    main()
