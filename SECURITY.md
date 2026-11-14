# Security

## Reporting a vulnerability

Email **security@umbry.org**. Please include:
- the app and version
- what you found
- steps to reproduce

Please don't open a public issue for anything exploitable. We'll confirm we received your report within a few days and tell you when a fix ships.

## Supported versions

Only the latest release of each app gets security fixes:
- Umbry Player for desktop, Android, iOS and the web
- Umbry Server
- Umbry for Apple platforms

## How we check Umbry

Every release is scanned before it ships with these tools:
- [gitleaks](https://github.com/gitleaks/gitleaks), run on the full git history, for leaked secrets
- [OSV-Scanner](https://github.com/google/osv-scanner) and `npm audit` for vulnerable dependencies
- [Semgrep](https://semgrep.dev) for risky code patterns
- [Trivy](https://trivy.dev) for container images

We also review the code by hand: anything that handles accounts, tokens, network requests, updates or desktop and mobile permissions.

The first full audit covered every Umbry app and ran in October 2026. It found no credentials anywhere in this repository's history. Every issue it did find is fixed, and the fixes are out on every platform: Umbry Player 0.8.45 (desktop; 1.0.7 in the Microsoft Store), Android 0.9.48, Umbry Server 0.2.10 (1.0.2 in the Microsoft Store), and Umbry 1.0.1 for iPhone, iPad and Mac. The same list is on [umbry.org/#security](https://umbry.org/#security).

| Severity | Issue | Fixed in |
|---|---|---|
| High | **Live TV relay could be used as a web proxy.** It would fetch any address, so a web page on the same computer could reach other devices on your network. It now serves only Umbry and the TV providers, refuses other sites and DNS-rebinding tricks, never fetches cloud-metadata addresses and checks every redirect. | Player 0.8.45, Android 0.9.48, Docker image |
| High | **Script injection in the Navidrome/Subsonic browser** from crafted song, album or artist names. Everything is escaped now. | Player 0.8.45, Android 0.9.48 |
| High | **Outdated Electron.** Now a supported Electron with fuses on (no Node.js mode, ASAR integrity). | Player 0.8.45, Server 0.2.10 |
| High | **Requests-page links could open any kind of address** (on Windows, non-web links can start programs). Only `http(s)` links go to the browser. | Player 0.8.45 |
| Medium | **Desktop window hardening.** Navigation and popups locked to the app, webviews without app privileges, IPC sender checks, permissions denied by default. | Player 0.8.45 |
| Medium | **Script injection through Plex artwork and item IDs**, and the Plex token sent with logos hosted elsewhere. Escaped, and the token only goes to the server itself. | Player 0.8.45, Android 0.9.48 |
| Medium | **The plex.tv account token went to whatever address was typed** when adding a server. The server is now checked without a token and only its own access token is used. | Player 0.8.45, Android 0.9.48 |
| Medium | **Stream tokens could be sent to other hosts** by a playlist or subtitle pointing elsewhere. Tokens are only added for the media server's own address. | Android 0.9.48 |
| Medium | **Sign-in rate limits could be bypassed** with a forged `X-Forwarded-For`. The header is trusted only when `TRUST_PROXY` is set, and repeated failures lock that email for a while. | Server 0.2.10 |
| Medium | **Current Connections was readable by web pages** on the server's machine. Those requests are refused now. | Server 0.2.10 |
| Medium | **Updates weren't checked.** The Linux self-updater and the tray apps download only from Umbry's host, validate the version and verify a SHA-256. | Player 0.8.45, Server 0.2.10 |
| Medium | **Tokens stored as plain app data.** The Apple app uses the Keychain; the Android apps no longer allow backups of app data. | Apple 1.0.1, Android 0.9.48 |
| Medium | **Outdated dependencies.** Desktop and installer advisories went from 31 critical/high to none, the server moved to Fastify 5, and the trays were rebuilt on a current Go. | Player 0.8.45, Server 0.2.10 |
| Low | **Password reset didn't sign out other devices.** It now ends every session. | Server 0.2.10 |
| Low | **Visitor geolocation lookup** sent device addresses to an outside service. Now opt-in (`GEOIP=1`). | Server 0.2.10 |
| Low | **The direct-download APK was a debug build.** It is a signed release build now. | Android 0.9.48 |
| Low | **Apple book reader.** EPUB scripts no longer run and server IDs in file paths are sanitized. | Apple 1.0.1 |

Still in progress (hardening, not known vulnerabilities in normal use):
- Umbry Server under its own low-privilege account on Windows and macOS, as on Linux.
- Remembering and checking the Umbry Server's identity on first connection.
- Signed update feeds, on top of the SHA-256 checks.
- Encrypted settings in the upcoming Android TV app, and the next major versions of the web reader's PDF and EPUB libraries.

Known limits that come from how Umbry works:
- **Plain HTTP on your LAN.** Jellyfin, Emby and Plex on a home network usually run over plain HTTP, so the apps allow it.
- **Use HTTPS outside your network.** If you reach your servers from outside your network, put them behind HTTPS (a reverse proxy works).
- **The parental PIN is a deterrent.** It's a lock against curious kids, not protection against someone who controls the device.
