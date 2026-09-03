# Versionierung und Deployment

Die Web IDE besitzt einen eigenen Versionierungsvertrag:

```text
stabil:    X.Y.Z        Tag vX.Y.Z
Snapshot:  X.Y.Z-snapshot.g<erste 12 Zeichen des Web-IDE-SHA>
```

Die Basis steht gleichzeitig in `package.json` und als
`artifactBaseVersion` in `release/dependencies.lock.json`. Das Release-Skript
weist jede Abweichung zurück.

## Abhängigkeiten übernehmen

Der Lock enthält die exakten publizierten Versionen und vollständigen
Source-SHAs von ilic und Language Tools. Direkte `@ilic/*`-Abhängigkeiten in
`package.json` müssen genau dazu passen. Bewegliche npm-Dist-Tags sind keine
Releasequelle.

Für einen neuen Language-Tools-Stand:

1. dessen publizierte Version und vollständigen SHA eintragen;
2. die darin gelockte Compiler-Version und deren SHA als Web-Compiler-Lock
   übernehmen;
3. `package.json` auf die exakten Compiler- beziehungsweise Language-Tools-
   Versionen setzen und den Lockfile aktualisieren;
4. `pnpm test:release` und die repositoryübergreifende Prüfung ausführen;
5. alles in einem Web-IDE-Commit übernehmen.

Der initiale Language-Tools-Commit stammt noch aus der Zeit vor dessen
Dependency-Lockdatei. Nur für diese unveränderliche historische Kombination steht
`legacyWithoutDependencyLock: true` im Web-Lock. Die nächste Übernahme muss das
Flag entfernen; danach prüft der Build zwingend, dass der verschachtelte
Compiler-Lock exakt übereinstimmt.

## Prüfungen und Provenienz

```sh
pnpm install --frozen-lockfile
pnpm release:check
pnpm release:verify-installed
pnpm test:release
pnpm check
```

`test:release` benötigt keine Tarballs oder Nachbar-Repositories. Die
zusätzliche `release:verify-installed`-Prüfung kontrolliert die installierten
publizierten Pakete anhand ihrer exakten Versionen, `gitHead`-Werte und
`interlis-release.json`-Manifeste gegen den Web-IDE-Lock.

Die vollständige repositoryübergreifende Prüfung wird separat ausgeführt:

```sh
./scripts/prepare-locked-dependencies.sh
```

Sie checkt beide Upstreams am gelockten SHA, baut Compiler-WASM und fünf
Language-Tools-Tarballs und installiert diese über die lokale Override-Vorlage.
Sie bleibt Bestandteil von CI, Public-Clone-Smoke und lokaler
Cross-Repository-Verifikation, nicht aber des Pages-Deploys.

Beim Deployment wird `dist/interlis-release.json` erzeugt. Es enthält
Web-Version und -SHA, beide Abhängigkeitsversionen und -SHAs, Kanal,
GitHub-Run-ID, Zeitpunkt und Node-Toolchain.

## Snapshot-Deployment

1. Lock-Änderung und normalen CI-Lauf auf `main` abschliessen.
2. **Deploy Web IDE** manuell auf `main` starten.
3. Der Workflow installiert ausschliesslich die im `pnpm-lock.yaml` festgelegten
   publizierten Pakete, prüft deren Provenienz, führt `pnpm check` aus, erzeugt
   `0.1.0-snapshot.g<web-sha>` und deployt `dist/` nach Pages.
4. Das ausgelieferte `interlis-release.json` mit Commit und Lock vergleichen.

Upstream-Publikationen starten diesen Workflow nicht automatisch.

Der Pages-Workflow checkt dafür weder `ilic-fork` noch
`interlis-language-tools` aus und baut keinen Compiler, kein WASM und keine
ANTLR-Abhängigkeiten. Diese Source-Verifikation bleibt dem CI-Workflow
vorbehalten; der Pages-Deploy prüft stattdessen die installierten npm-Artefakte
gegen deren Lock- und Release-Metadaten.

## Stabiles Deployment

1. Basisversion und Changelog vorbereiten. Compiler und Language Tools müssen
   beide stabile numerische Versionen sein.
2. CI auf dem Release-Commit abschliessen.
3. Das Commit mit dem exakt passenden `vX.Y.Z` taggen und pushen.
4. Der Tag startet **Deploy Web IDE** und publiziert denselben Pages-Kanal mit
   stabiler Provenienz.

Ein Tag wird abgewiesen, solange eine gelockte Abhängigkeit ein Snapshot ist.
Es wird kein separater GitHub Release erzeugt; Tag, Pages-Inhalt und
Provenienzmanifest bilden den stabilen Kanal.

## Fehlerbehandlung

Ein fehlendes Paket, ein falscher `gitHead`, ein abweichendes
`interlis-release.json`, ein nicht passender verschachtelter Compiler-Lock oder
ein falscher Tag beendet den Build vor dem Pages-Upload. Die
Source-Verifikation in CI prüft zusätzlich fehlende SHAs, nicht passende
Versionsbasen und fehlerhafte Upstream-Checkouts. Fehler werden im betreffenden
Repository behoben und durch einen neuen Lock-Commit übernommen. Ein bereits
ausgeliefertes stabiles Tag wird nicht verschoben.
