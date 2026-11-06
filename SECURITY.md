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

The first full audit covered every Umbry app and ran in October 2026. It found no credentials anywhere in this repository's history. The issues it did find are fixed in Umbry Player 0.8.45 (desktop), 0.9.48 (Android), Umbry Server 0.2.10, the Microsoft Store and App Store updates, and the live sync server. A per-issue list will be posted on [umbry.org/#security](https://umbry.org/#security) once every store has the update.

Known limits that come from how Umbry works:
- **Plain HTTP on your LAN.** Jellyfin, Emby and Plex on a home network usually run over plain HTTP, so the apps allow it.
- **Use HTTPS outside your network.** If you reach your servers from outside your network, put them behind HTTPS (a reverse proxy works).
- **The parental PIN is a deterrent.** It's a lock against curious kids, not protection against someone who controls the device.
