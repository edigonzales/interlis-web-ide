# Sicherheit und Datenschutz

Die IDE hat keinen Applikationsserver und kein Benutzerkonto. Quelltexte,
Recovery-Daten, Git-Objekte, Commit-Identität und Einstellungen bleiben im
Browserprofil beziehungsweise im ausdrücklich gewählten lokalen Ordner.

Netzwerkzugriffe entstehen nur durch explizite oder fachlich notwendige
Aktionen:

- erster Download der PWA;
- Laden eines noch nicht gecachten Repository-Modells oder einer Vorlage;
- öffentlicher HTTPS-Git-Clone über den konfigurierten CORS-Proxy.

Der voreingestellte Git-Proxy ist `https://cors.isomorphic-git.org`. Er ist nur
für öffentliche Repositories vorgesehen. Es werden keine Passwörter, Tokens
oder Accounts erfasst; Push/Pull/Fetch und private Repositories sind außer
Umfang. Anwender mit strengeren Vorgaben können einen eigenen Proxy
konfigurieren oder ausschließlich ZIP/Local Folder verwenden.

Local-Folder-Zugriff erfordert eine sichtbare Browserfreigabe. Handles werden
lokal gespeichert, Berechtigungen bei Wiederverwendung erneut geprüft und nie
an einen Dienst übertragen. ZIP-Exporte sind die portable Datensicherung für
Browser ohne File System Access API.
