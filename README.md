# INTERLIS Web IDE

Eine vollständig clientseitige Entwicklungsumgebung für INTERLIS-Modelle. Sie
verwendet dieselben Compiler- und Language-Tools-Pakete wie die VS-Code-
Extension und benötigt weder REST-Backend noch Benutzerkonto.

## Entwicklung

Für einen normalen Build werden die in `release/dependencies.lock.json`
festgehaltenen npm-Versionen installiert:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm dev
```

Für eine repositoryübergreifende Prüfung liegen `ilic-fork`,
`interlis-language-tools` und `interlis-web-ide` als Geschwisterverzeichnisse
vor. Das folgende Skript prüft die SHAs, baut Compiler und Language-Tools-
Tarballs aus den exakten Quellen und installiert diese lokal:

```sh
./scripts/prepare-locked-dependencies.sh
corepack pnpm check
```

Die lokale Override-Vorlage `pnpm-workspace.local.yaml` wird nur während
dieser Vorbereitung aktiviert; der committete Standard-Lock bleibt auf exakte
publizierte Versionen auflösbar.

## Funktionen

- OPFS-Workspace mit Recovery ungespeicherter Buffer
- ZIP-Import/-Export und optionaler lokaler Ordner in Chromium
- lokales Git für öffentliche Repositories
- Compilerdiagnostik, Navigation, Completion, Rename und Formatierung
- Diagramm-, SVG- und DOCX-Ausgabe
- installierbare Offline-PWA

Browsergrenzen stehen unter [Browserunterstützung](docs/browser-support.md),
lokale Daten und Netzwerkzugriffe unter
[Sicherheit und Datenschutz](docs/security-and-privacy.md).

## Release

Die Web IDE besitzt die Basisversion `0.1.0`. Snapshots, stabile Pages-
Deployments, Dependency-Locks und Provenienz sind im
[Release-Runbook](docs/release.md) beschrieben. Die Gesamtbeziehungen stehen
in der
[zentralen Ökosystemübersicht](https://github.com/edigonzales/ilic-fork/blob/main/docs/ecosystem.md).
