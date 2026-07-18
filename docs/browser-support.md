# Browser- und Speicherunterstützung

| Fähigkeit                          | Chromium                   | Firefox            | Safari/WebKit      |
| ---------------------------------- | -------------------------- | ------------------ | ------------------ |
| OPFS-Workspace und Buffer-Recovery | Ja                         | Ja                 | Ja                 |
| ZIP-Import/-Export                 | Ja                         | Ja                 | Ja                 |
| Installierbare/offline PWA         | Ja                         | Ja                 | Ja                 |
| Lokalen Ordner öffnen              | Ja, File System Access API | Nein, ZIP-Fallback | Nein, ZIP-Fallback |
| Lokales Git                        | Ja                         | Ja                 | Ja                 |

OPFS ist der primäre Speicher. Ein Browserfenster aktiviert genau einen
benannten Workspace; Inhalte und ungespeicherte Recovery-Buffer bleiben über
Reloads erhalten. Ein gespeicherter Local-Folder-Handle wird wiederverwendet.
Entzogene Berechtigungen erscheinen als expliziter Reconnect-Zustand und führen
nicht stillschweigend zu einem anderen Workspace.

Der Playwright-WebKit-Treiber benötigt für OPFS einen persistenten Context.
Dieser Testcontext stellt CacheStorage bei einer simulierten Offline-Navigation
nicht korrekt bereit. Deshalb läuft genau der Offline-Reload-Test automatisiert
in Chromium und Firefox; OPFS, Recovery, ZIP, Git und Language Tools bleiben in
WebKit aktiv getestet. Dies ist eine Testtreiber-Einschränkung, keine
Serverabhängigkeit der Anwendung.

Remote-Modelle und Git-Clones benötigen beim ersten Bezug Netzwerk. Bereits im
Workspace gespeicherte Quellen und der installierte App-Shell funktionieren
anschließend offline.
