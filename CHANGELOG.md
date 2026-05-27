# Changelog

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenir.

Biçim [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) temel alınır ve proje
[Semantic Versioning](https://semver.org/lang/tr/) kurallarını uygular.

## [1.0.1] - 2026-05-27

### Düzeltildi
- İnteraktif modda yukarı/aşağı gezinince oluşan **hayalet/çift görüntü** ve bozuk render sorunu giderildi.
  - Alternatif ekran tamponu (`?1049h`) kullanılıyor; `q` ile çıkışta terminal aynen geri geliyor.
  - Satır kaydırma kapatıldı (`?7l`); uzun satırlar sarmak yerine kırpılıyor.
  - Her veri satırı artık tam olarak 1 terminal satırı (sabit genişlik + `…` ile kırpma).
  - Çizim, tüm ekranı silmek yerine imleci başa alıp satır-sonuna kadar siliyor (`\x1b[K` + `\x1b[J`).
  - Pencere boyutu değişince (`resize`) otomatik yeniden çizim.

## [1.0.0] - 2026-05-27

### Eklendi
- Açık/dinlenen tüm **TCP/UDP** portlarını, PID, çalıştırılabilir ve komut satırı ile listeleme.
- **Node / Bun / Deno** süreçlerini tanıma; `node_modules` atlanarak gerçek proje kökünün
  (`package.json` adı + dizini) bulunması.
- Bilinen geliştirme sunucularının etiketlenmesi (Vite, Next.js, NestJS, Nuxt, Angular,
  Astro, Remix, Expo, Electron, nodemon, tsx, Vitest, Jest…).
- **İnteraktif TUI**: ok tuşlarıyla gezinme, detay paneli, canlı arama, süreç sonlandırma (kill).
- Canlı otomatik yenileme ve script entegrasyonu için `--json` çıktısı.
- Çapraz platform desteği: Windows (PowerShell), macOS & Linux (`lsof` / `/proc`).

[1.0.1]: https://github.com/mertokan/port-inspector/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mertokan/port-inspector/releases/tag/v1.0.0
