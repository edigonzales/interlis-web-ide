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
pnpm release:check
pnpm test:release
./scripts/prepare-locked-dependencies.sh
pnpm check
```

`test:release` benötigt keine Tarballs oder Nachbar-Repositories. Die
repositoryübergreifende Prüfung checkt dagegen beide Upstreams am gelockten
SHA, baut daraus Compiler-WASM und fünf Language-Tools-Tarballs und installiert
diese über die lokale Override-Vorlage.

Beim Deployment wird `dist/interlis-release.json` erzeugt. Es enthält
Web-Version und -SHA, beide Abhängigkeitsversionen und -SHAs, Kanal,
GitHub-Run-ID, Zeitpunkt und Node-Toolchain.

## Snapshot-Deployment

1. Lock-Änderung und normalen CI-Lauf auf `main` abschliessen.
2. **Deploy Web IDE** manuell auf `main` starten.
3. Der Workflow baut ausschliesslich die committeten SHAs, führt `pnpm check`
   aus, erzeugt `0.1.0-snapshot.g<web-sha>` und deployt `dist/` nach Pages.
4. Das ausgelieferte `interlis-release.json` mit Commit und Lock vergleichen.

Upstream-Publikationen starten diesen Workflow nicht automatisch.

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

Ein fehlender SHA, eine nicht passende Versionsbasis, ein abweichender
verschachtelter Compiler-Lock oder ein falscher Tag beendet den Build vor dem
Pages-Upload. Fehler werden im betreffenden Repository behoben und durch einen
neuen Lock-Commit übernommen. Ein bereits ausgeliefertes stabiles Tag wird
nicht verschoben.
