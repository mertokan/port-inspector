# Changelog

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenir.

Biçim [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) temel alınır ve proje
[Semantic Versioning](https://semver.org/lang/tr/) kurallarını uygular.

## [1.1.0] - 2026-06-01

### Eklendi
- **Nazik kapatma (graceful kill):** Sonlandırma artık iki seçenek sunuyor — `[e]` nazik
  (`SIGTERM` / `taskkill`; süreç `4 sn` içinde kapanmazsa otomatik olarak zorla sonlandırılır)
  ve `[f]` zorla (`SIGKILL` / `taskkill /F /T`).
- **İnteraktif eylemler:**
  - `o` — seçili projenin klasörünü işletim sisteminde aç (explorer / open / xdg-open).
  - `e` — projeyi editörde aç (`code`, yoksa `$VISUAL` / `$EDITOR`).
  - `c` — seçili sürecin komut satırını panoya kopyala (clip / pbcopy / xclip / wl-copy).
  - `s` — sıralamayı değiştir (port → pid → proje → süreç → protokol).
- **Daha fazla geliştirme aracı tanıma:** Hardhat, Truffle, Ganache, Prisma, Drizzle,
  Tailwind, Strapi, Medusa, Payload, Supabase, Fastify, Hono, Koa, Apollo, GraphQL,
  SvelteKit, Gatsby, Quasar, Ionic, React Native (Metro), Parcel, esbuild, Rollup,
  Turborepo, PM2, Playwright, Cypress, http-server, json-server, serve ve dahası.

### Değişti
- `package.json` okumaları artık önbelleğe alınıyor; interaktif modda her yenilemede dizin
  ağacını yeniden yürümüyor (daha düşük disk/CPU kullanımı).

### Test
- `identify.mjs` saf mantığı için birim testleri eklendi (`node:test`, ek bağımlılık yok).
  Çalıştır: `npm test`.

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

[1.1.0]: https://github.com/mertokan/port-inspector/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/mertokan/port-inspector/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mertokan/port-inspector/releases/tag/v1.0.0
