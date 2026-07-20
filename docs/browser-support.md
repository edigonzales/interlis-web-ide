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

Der Playwright-WebKit-Treiber benötigt für OPFS einen persistenten Context. Der
Linux-Port stellt OPFS auf den GitHub-Runnern nicht bereit; Chromium und Firefox
laufen deshalb im Ubuntu-Job, WebKit in einem separaten macOS-Job gegen dasselbe
Produktionsartefakt. Der WebKit-Testcontext stellt CacheStorage bei einer
simulierten Offline-Navigation weiterhin nicht korrekt bereit. Deshalb läuft
genau der Offline-Reload-Test nur in Chromium und Firefox; OPFS, Recovery, ZIP,
Git und Language Tools bleiben unter WebKit aktiv getestet. Dies sind
Testtreiber-Einschränkungen und keine Serverabhängigkeit der Anwendung.

Remote-Modelle und Git-Clones benötigen beim ersten Bezug Netzwerk. Bereits im
Workspace gespeicherte Quellen und der installierte App-Shell funktionieren
anschließend offline.
