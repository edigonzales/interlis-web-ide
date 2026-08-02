# Diagnostics and Problems

Die Web-IDE projiziert Compilation-Diagnosen in `ProblemItem`-Werte. Jede
Problem-ID basiert auf URI, Code, Byte-Range und Fingerprint beziehungsweise
Message. Sortierung und Anzeige lesen ausschließlich strukturierte Werte;
gerenderten Text zu parsen ist nicht zulässig.

Problems zeigen Severity, Source, Code, Message, Notes und Related Information.
Ein Klick auf die Primärdiagnose öffnet die Datei und setzt die Monaco-Selection
auf die Range. Related Information ist separat navigierbar. Beim Wechsel des
Workspace-Dateisystems wird der ProblemStore geleert; das Last-Good-Diagramm
bleibt unverändert erhalten.
