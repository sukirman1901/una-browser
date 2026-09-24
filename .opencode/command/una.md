---
description: Jalankan `una` (CLI browser automation via CDP). Contoh: /una open https://x.com
agent: general
---

Jalankan perintah `una` berikut di terminal dan tampilkan hasilnya apa adanya.
Mulai daemon dulu jika belum berjalan:

```bash
una serve &   # jika belum berjalan
```

$ARGUMENTS

Jika verb yang diminta adalah `snap`, `check`, atau `get`, tampilkan hasilnya;
jika verb mengubah halaman (`open`, `click`, `type`, ...), tampilkan JSON
hasilnya lalu jalankan `una snap` untuk refleksi ulang.