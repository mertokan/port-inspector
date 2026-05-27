# Port Inspector

> Interactive cross-platform CLI to inspect every open/listening port, the process behind it, and **which Node.js project** each one belongs to.
>
> _Türkçe açıklama aşağıda — [Türkçe](#türkçe)._

Find out what is running on which port, jump straight to the owning process and project, and kill it — all from an interactive terminal UI. Works on **Windows, macOS and Linux**.

![mode: interactive TUI](https://img.shields.io/badge/mode-interactive%20TUI-brightgreen) ![node >= 20](https://img.shields.io/badge/node-%3E%3D20-blue) ![license MIT](https://img.shields.io/badge/license-MIT-informational)

## Features

- 🔎 Lists all listening (and optionally established) **TCP/UDP** ports with the owning **PID**, executable and command line.
- 🟢 Detects **Node / Bun / Deno** processes and resolves the **real project** (`package.json` name + directory), skipping `node_modules`.
- 🛠 Labels common dev servers: **Vite, Next.js, NestJS, Nuxt, Angular, Astro, Remix, Expo, Electron, nodemon, tsx, Vitest, Jest…**
- ⌨️ **Interactive TUI**: navigate, view details, live search, and **kill** a process by its port.
- 🔁 Live auto-refresh.
- 🤖 `--json` output for scripting.

## How it works

No fragile `netstat` text parsing — it reads structured data per platform:

| OS | Source |
|----|--------|
| Windows | `Get-NetTCPConnection` / `Get-NetUDPEndpoint` + `Get-CimInstance Win32_Process` (via PowerShell, JSON) |
| macOS | `lsof` + `ps` + `lsof -d cwd` |
| Linux | `lsof` + `/proc/<pid>/{cmdline,exe,cwd}` (real working directory) |

## Requirements

- **Node.js 20+**
- **Windows**: PowerShell (`pwsh` 7+ preferred, falls back to built-in `powershell.exe`)
- **macOS**: works out of the box (`lsof` is preinstalled)
- **Linux**: `lsof` (`sudo apt install lsof` / `sudo dnf install lsof`)

## Install

### Run without installing

```bash
npx port-inspector            # once published to npm
```

### From source (any machine)

```bash
git clone https://github.com/<your-name>/port-inspector.git
cd port-inspector
npm install
npm link                      # makes the global `ports` command available
```

After `npm link` you can run **`ports`** from any terminal, any directory.
(Run `npm unlink -g port-inspector` to remove it.)

> Tip: instead of `npm link` you can also `npm install -g .` from the project folder.

## Usage

```bash
ports                  # interactive live panel (default)
ports -n               # only Node/Bun/Deno projects
ports --once -p 3000   # who is holding port 3000? (print once and exit)
ports --once -a        # include established connections, not just listeners
ports --json > ports.json
```

If you didn't run `npm link`, use `node bin/ports.mjs …` instead of `ports …`.

### Options

| Option | Description |
|---|---|
| _(none)_ | Interactive live TUI (default when run in a terminal) |
| `-o, --once` | Print the table once and exit |
| `--json` | Print result as JSON (for scripting) |
| `-a, --all` | Include `Established` connections, not only listeners |
| `-n, --node` | Show only Node/Bun/Deno processes |
| `-p, --port <n>` | Filter by a specific port |
| `-i, --interval <s>` | Refresh interval in interactive mode (default: 3) |
| `-h, --help` | Help |

### Interactive shortcuts

| Key | Action |
|---|---|
| `↑`/`↓` or `j`/`k` | Move selection |
| `Enter` / `d` | Toggle detail panel |
| `x` / `Del` | Kill selected process (with confirmation) |
| `/` | Live search |
| `a` | Toggle all connections |
| `n` | Toggle Node-only |
| `r` | Refresh now |
| `q` | Quit |

## License

[MIT](LICENSE) — use it however you like.

---

## Türkçe

**Port Inspector**, bilgisayardaki açık/dinlenen tüm portları, her portun arkasındaki süreci ve özellikle **hangi Node.js projesine** ait olduğunu gösteren, **çapraz platform (Windows, macOS, Linux)** interaktif bir terminal aracıdır.

### Öne çıkanlar
- Tüm dinlenen (ve istenirse kurulu) **TCP/UDP** portları; **PID**, çalıştırılabilir ve komut satırı ile.
- **Node / Bun / Deno** süreçlerini tanır, `node_modules`'ü atlayıp **gerçek projeyi** (`package.json` adı + dizini) bulur.
- Bilinen dev sunucularını etiketler (Vite, Next.js, NestJS, Expo, Electron, nodemon…).
- **İnteraktif arayüz**: ok tuşlarıyla gezin, detay gör, canlı ara ve süreci **sonlandır (kill)**.
- Canlı otomatik yenileme + script için `--json`.

### Kurulum (her makinede)
```bash
git clone https://github.com/<kullanici-adin>/port-inspector.git
cd port-inspector
npm install
npm link        # global `ports` komutu
```
Artık herhangi bir terminalden **`ports`** yazman yeterli.

### Gereksinimler
- Node.js 20+
- Windows: PowerShell (pwsh 7+ tercih edilir) · macOS: hazır gelir · Linux: `lsof`

### Kullanım
```bash
ports                  # interaktif panel
ports -n               # sadece Node projeleri
ports --once -p 3000   # 3000 portunu kim tutuyor?
```

Kısayollar: `↑/↓` seç · `Enter/d` detay · `x` kill · `/` ara · `a` tümü · `n` node · `r` yenile · `q` çık.

Lisans: [MIT](LICENSE) — dilediğin gibi kullan.
