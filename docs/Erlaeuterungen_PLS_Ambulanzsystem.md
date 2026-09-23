Erläuterungen zum Arbeitsauftrag: PLS und Ambulanzsystem

Hier findet ihr die ausführlicheren Hinweise zum [Arbeitsauftrag]. Sie sollen euch den Einstieg erleichtern und später beim Umsetzen helfen. Geht dabei bitte stufenweise vor; ein gleichzeitiger Umbau beider Anwendungen ist nicht vorgesehen.

Die Anwendungen verwenden künftig eine gemeinsame Identität, behalten zunächst aber ihre getrennten Datenbanken. Änderungen werden asynchron abgeglichen, also auch zeitversetzt, sobald eine Verbindung besteht.

1. Zielbild

PLS dient der Triage in Katastrophenlagen, das Ambulanzsystem der Versorgung bei Veranstaltungen und im regulären Ambulanzbetrieb. Beide behalten ihre eigenen Oberflächen und Abläufe. Eine Benutzerin oder ein Benutzer soll in beiden Systemen eindeutig zugeordnet werden können. Welche Daten die Person sehen und bearbeiten darf, hängt zusätzlich von ihrer Arbeitsberechtigung und dem jeweiligen Einsatz ab. Ein Patient ist systemübergreifend eindeutig zuzuordnen. Fällt eine Verbindung aus, erfasst PLS lokal weiter und gleicht später ab.

```text
PLS-Browser ──(Ebene 1)──→ PLS-API/MySQL ─────────────┐
                                                      ├──(Ebene 2)──→ dauerhafte Synchronisation nach Vertrag
Ambulanz-Browser ────────→ Ambulanz-API/PostgreSQL ───┘
                           ↑ gemeinsames Identitäts- und Berechtigungsmodell
```

Die Skizze zeigt, welche Teile zusammenarbeiten sollen. Wie die Server später genau angeordnet sind, ist damit noch nicht festgelegt.

Bei einem Netzausfall müssen wir zwei Fälle unterscheiden:

- Das Gerät erreicht den PLS-Server nicht. Dann muss der Browser die Eingaben dauerhaft speichern und später senden. Darum kümmert sich Paket C; wir nennen das im Folgenden Ebene 1.
- Der PLS-Server erreicht das Ambulanzsystem nicht. Dann muss der Server Änderungen vormerken und später übertragen. Das gehört zu Paket D und ist Ebene 2.

2. Was die Begriffe hier bedeuten

Bei den folgenden Begriffen lohnt es sich, genau hinzusehen. Gerade bei Berechtigungen und IDs können kleine Verwechslungen später zu falschen Zuordnungen führen.

Eine Rolle beschreibt die grundsätzliche Funktion einer Person, etwa Admin, Leitstelle oder Einsatzkraft. Sie allein berechtigt noch nicht zum Zugriff auf einen Arbeitsbereich.

Die Arbeitsberechtigung legt fest, in welchem Bereich jemand arbeiten darf: `PLS_TRIAGE`, `AMBULANZ_EVENT` oder `AMBULANZ_PERMANENT`. Das vorhandene Ambulanz-Feld `accountType: permanent/event` hat eine andere Bedeutung. Es beschreibt die Dauer eines Kontos und sagt nichts über dessen Zugriffsrechte aus.

Über die Einsatzzuteilung wird bestimmt, welchen konkreten Einsatz eine Person bearbeiten darf. Ein Ortsvorschlag per Geolokation hilft lediglich bei der Auswahl. Er erteilt keine Berechtigung.

Mit globaler ID meinen wir eine UUID, die einen Benutzer, Einsatz oder Patienten in beiden Systemen dauerhaft eindeutig bezeichnet. Die lokalen Zahlen-IDs (`id`) bleiben lokale IDs und dürfen nicht als gemeinsame Kennung verwendet werden.

Wenn hier von offline die Rede ist, achtet auf die jeweilige Ebene: Entweder erreicht der Browser seinen eigenen Server nicht, oder der PLS-Server erreicht das Ambulanzsystem nicht. Für diese beiden Fälle brauchen wir jeweils eine eigene Absicherung.

Eine Warteschlange beziehungsweise Outbox enthält dauerhaft gespeicherte Änderungen, deren Empfang noch nicht bestätigt wurde. Eine einzelne MQTT-Nachricht oder ein einzelner API-Aufruf ersetzt diese Speicherung nicht: Bei einem Fehler muss die Änderung weiterhin für einen erneuten Versuch verfügbar sein.

Unter Synchronisation verstehen wir den fortlaufenden, nachvollziehbaren Austausch solcher Änderungen mit Empfangsbestätigung. Dabei kann dieselbe Änderung mehrmals gesendet werden, darf aber nur einmal angewendet werden. Ein direkter Zugriff auf die Datenbank des anderen Systems ist dafür nicht vorgesehen.

Beispiel Rechteprüfung: Eine reine PLS-Triage-Kraft darf mit ihrem QR-Zugang PLS öffnen, aber weder Ambulanz-Veranstaltungsdaten sehen noch über eine direkte API-Anfrage darauf zugreifen. Admin und Leitstelle bleiben unterscheidbare Rollen; ihr Zugriff auf beide Systeme wird ausdrücklich getestet.

3. Entscheidungen vor dem Start

Weil sie Sicherheit oder fachliche Abläufe betreffen, entscheidet darüber die Projektleitung. Bitte trefft diese Entscheidungen nicht allein innerhalb eines Arbeitspakets.

E1 – Darf ein erneuter QR-Scan einen Patienten in einen anderen Einsatz verschieben?
- Heute passiert das in beiden Systemen (siehe Stolperstein S1).
- Betrifft Paket B
- Ein Patient sollte durch einen erneuten Scan nicht verschoben werden, sondern als markierte Kopie im neuen Einsatz angelegt werden.

E2 – Wie lange bleibt ein vorbereiteter PLS-Zugang ohne Netz gültig, und wann wird eine Sperre lokal wirksam?
- Betrifft Pakete B und C
- Ein vorbereiteter Zugang behält den Zugang für 12 Stunden und sollte nach Ablauf sobald als möglich den lokalen und Server-Zugang verlieren.

E3 – Welches System besitzt das Ambulanzprotokoll?
- Beide Systeme haben heute eine eigene Umsetzung (siehe S5).
- Betrifft Pakete A und D
- Das Ambulanzprotokoll existiert derzeit im PLS, ist dort aber nur eine nicht notwendige optionale Möglichkeit. Umsetzung des Ambulanzprotokolls so Papiernahe wie mögich im Ambulanzsystem.

E4 – Gilt die Regel „Gerätezeitstempel entscheiden keinen Konflikt" auch innerhalb eines Systems?
- Das Ambulanzsystem entscheidet heute anders (siehe S3).
- Betrifft Pakete A und D
- Gerätezeitstempel sollten Last-write-first sein und in der Log-History festgehalten werden.


4. Bekannte Stolpersteine

Im bisherigen Stand gibt es einige Stellen, die ihr vor euren Änderungen kennen solltet. Manche passen noch nicht zum geplanten Verhalten, andere sind fachlich leicht misszuverstehen. Die folgenden Hinweise beschreiben den im Ausgangsdokument festgehaltenen Stand; prüft die betroffenen Stellen beim Einstieg noch einmal im Code.

- 1 – QR-Rescan verschiebt Patienten schon heute. In PLS (`PersonenV2Controller.cs`, `VerifyPatientQrCode`) und im Ambulanzsystem (`/api/verify-patient-qr-code`, „refreshes scene link") setzt ein erneuter Scan eines bereits zugeordneten Codes den Einsatz des Patienten neu. Das Zielbild verlangt, dass ein Scan einen Patienten nicht unbemerkt verschiebt. Das ist also eine Verhaltensänderung, keine Neuentwicklung. → Entscheidung E1
- 2 – `blutung` bedeutet in beiden Systemen etwas anderes. Beide speichern einen Wahrheitswert gleichen Namens:
  - PLS: `true` = „Blutung stillbar" (→ gelb), `false` = „Blutung nicht stillbar" (→ rot), siehe `client-app/src/pages/TriagePage3.tsx`.
  - Ambulanzsystem: `true` = „Blutung vorhanden" (Ankreuzfeld „Blutung").

  Eine direkte Zuordnung kehrt die klinische Bedeutung um. Auch die PLS-Lagetabelle zeigt den Wert irreführend als „Ja/Nein" an (`SituationRoomTable.tsx`).
- 3 – Das Ambulanzsystem löst Triage-Konflikte heute über Zeitstempel. `update-triage-color` führt Felder nach dem letzten `clientUpdatedAt` zusammen („last write wins", `contract/openapi.yaml`). Für die systemübergreifende Synchronisation gilt dagegen: Gerätezeitstempel allein entscheiden keinen Konflikt. → Entscheidung E4
- 4 – In PLS fehlen Rollen und Sperrfelder. Der PLS-`User` kennt nur `AdminRole` (ja/nein), also keine Leitstelle. `QrCodeLogin` hat keine Felder für Ablauf oder Sperre. Stufe 2 braucht dafür eine Datenbankmigration in PLS, nicht nur Änderungen an Endpunkten.
- 5 – PLS hat ein eigenes Ambulanzprotokoll. `client-app/src/features/ambulanzprotokoll-page1/` sowie die zugehörigen Tabellen existieren parallel zum Ambulanzprotokoll des Ambulanzsystems. → Entscheidung E3
- 6 – Kategorie `blau`. PLS kennt `blau` (`Models/TriageColor.cs`), der Ambulanz-Vertrag lehnt `blau` ab. Nicht stillschweigend umwandeln oder verwerfen.
- 7 – Vorlage für Offline-Speicherung. Das Ambulanzsystem hat eine IndexedDB-Warteschlange mit Idempotenzschlüssel `clientGeneratedId` (`frontend/src/app/sync/offline-queue.service.ts`). Sie ist eine gute Vorlage für Paket C. Ihre bekannte Schwäche (sie prüft nur `navigator.onLine`, nicht ob der Server erreichbar ist, siehe `docs/Offline_Decisions.md`) bitte nicht übernehmen.

5. Arbeitspakete

Hier findet ihr für jedes Paket die ersten Anlaufstellen im Code und die Aufgaben für die einzelnen Stufen. Die Pfade beziehen sich auf die Repositories `Ambulanzsystem/` und `PLS_Rewrite_v2/`. Verteilt die Arbeit untereinander; die Pakete legen keine festen Zuständigkeiten für einzelne Personen fest.

A. Bestandsaufnahme und Vertrag

In diesem Paket schafft ihr die Grundlage für die übrige Arbeit: einen gemeinsam abgestimmten Vertrag, dessen Änderungen über Versionen nachvollziehbar bleiben.

Hier könnt ihr anfangen:
- Ambulanz: `contract/openapi.yaml`, `backend/src/Ambulanzsystem.Api/Domain/` (`User.cs`, `Patient.cs`, `OperationScene.cs`, `QrCodeLogin.cs`)
- PLS: `src/PLS.Api/Models/Entities/`, `src/PLS.Api/Models/DTOs/`, `src/PLS.Api/Controllers/`

Was ihr in den einzelnen Stufen bearbeitet:
- *Stufe 1:* Zuordnungstabelle mit den Spalten *gemeinsamer Begriff · Feld/Quelle PLS · Feld/Quelle Ambulanz · Besitzer der Änderung · offene Bedeutung*. Zuerst Benutzer, Rollen und QR, dann Einsätze, zuletzt Patienten.
- *Stufe 2:* Vertrag v0.1 für Identität und Berechtigungen festhalten und bei Änderungen pflegen.
- *Stufe 3:* Einsatzfelder und globale Einsatz-ID ergänzen.
- *Stufe 4:* Patientenfelder ergänzen. Die Stolpersteine S2, S5 und S6 ausdrücklich behandeln.

Die Tabelle ist vollständig, wenn jede Zeile eine Quelle in beiden Systemen oder den Vermerk „nur in PLS“ beziehungsweise „nur im Ambulanzsystem“ enthält. Was sich noch nicht eindeutig zuordnen lässt, kennzeichnet ihr als offen.

In Paket A ändert ihr noch keinen Code. Setzt Felder auch nicht allein deshalb gleich, weil ihre Namen ähnlich klingen. Das betrifft zum Beispiel Körperregionen, Formularfelder und `blutung`.

Betroffen von Entscheidungen: E3, E4

B. Identität, Berechtigung und QR

Hier geht es darum, den Zugang in beiden Anwendungen verlässlich zu regeln. Ein QR-Code darf nur die Systeme und Einsätze öffnen, für die die Person berechtigt ist. Gesperrte oder abgelaufene Zugänge müssen abgewiesen werden.

Hier könnt ihr anfangen:
- PLS: `Controllers/LoginController.cs` (`api/qr-login`), `Controllers/QRLoginController.cs`, `Services/AuthService.cs`, `Services/SceneAccess.cs`, `Models/Entities/User.cs`, `Models/Entities/QrCodeLogin.cs`
- Ambulanz: `Controllers/AuthController.cs`, `Controllers/LoginQrCodesController.cs`, `Auth/AuthPolicies.cs`, `Auth/SceneAccess.cs`, `Domain/Role.cs`
- Tests: PLS `tests/PLS.Api.Tests/AuthorizationTests.cs`, `QrCodeTests.cs`; Ambulanz `backend/src/Ambulanzsystem.Tests/AuthFlowTests.cs`, `SceneAccessRestTests.cs`

Was ihr in den einzelnen Stufen bearbeitet:
- *Stufe 1:* Rechte-Matrix gemeinsam mit A: Rolle × Arbeitsberechtigung × erlaubte Systeme und Endpunkte. Dazu klären: Erstellung aus beiden Verwaltungsoberflächen, QR-Ausgabe, Ablauf, Sperre, Protokollierung.
- *Stufe 2:* Arbeitsberechtigungen, Ablauf und Sperre in beiden APIs umsetzen, in PLS inklusive Migration (S4). Der Server prüft die Berechtigung bei jedem relevanten Zugriff, nicht nur beim Öffnen einer Seite. QR-Rescan-Verhalten gemäß E1 umsetzen. Oberflächen nur so weit anpassen wie nötig.
- *Stufe 3:* Einsatzzuteilung an die gemeinsame Einsatz-ID knüpfen.

Für die Abnahme müssen die Testfälle T2.1 bis T2.6 bestehen.

Die Migration von Patientendaten gehört nicht zu diesem Paket. Die Offline-Anmeldung folgt in Stufe 3 nach E2. Ein bewusstes Verschieben von Patienten zwischen Einsätzen braucht später einen eigenen Vorgang mit entsprechender Berechtigung.

Betroffen von Entscheidungen: E1, E2

C. PLS bei Netzausfall (Ebene 1: Gerät)

PLS soll auf einem Gerät auch dann weiter zur Erfassung nutzbar sein, wenn der eigene Server nicht erreichbar ist. Die Eingaben müssen einen Browser-Neustart überstehen und später übertragen werden können.

Hier könnt ihr anfangen:
- PLS: `client-app/src/api/client.ts`, `client-app/src/api/endpoints.ts`, `client-app/src/hooks/usePatientTriage.ts`, `client-app/src/stores/`, `client-app/vite.config.ts`
- Vorlage: Ambulanz `frontend/src/app/sync/offline-queue.service.ts`, Offline-Tests unter `frontend/tests/offline/` (S7)

Was ihr in den einzelnen Stufen bearbeitet:
- *Stufe 1:* Ist-Analyse: Was funktioniert heute ohne Server? (Ausgangspunkt: PLS hat derzeit weder Service Worker noch IndexedDB-Speicher.) Ergebnis ist eine Tabelle *Funktion · funktioniert offline ja/nein · Grund*.
- *Stufe 2:* Dauerhafte Warteschlange im PLS-Browser (IndexedDB) für Triage-Änderungen an bereits bekannten Patienten; die App-Oberfläche lädt ohne Netz. Erreichbarkeit des Servers prüfen, nicht nur `navigator.onLine`.
- *Stufe 3:* Offline-Anmeldung vorbereiteter Geräte gemäß Entscheidung E2.
- *Stufe 4:* Neue Patienten offline erfassen (setzt vorab zugeteilte Patienten-QR-Codes bzw. ID-Bereiche voraus) und an die Synchronisation aus D anbinden.

Den Datenerhalt weist ihr mit den Testfällen T2.7 und T4.3 nach.

Den Austausch mit dem Ambulanzsystem bearbeitet Paket D. Für eure lokale Speicherung gilt: Klinische Daten dürfen bei einem Netzwerkfehler weder verworfen noch ohne Bestätigung als „synchronisiert“ angezeigt werden.

Betroffen von Entscheidungen: E2

D. Datenaustausch und Konflikte (Ebene 2: System)

Ihr sorgt dafür, dass Änderungen zuverlässig vom einen System ins andere gelangen und dort nachvollziehbar bleiben. Auch wenn die Übertragung wiederholt werden muss, darf eine Änderung beim Empfänger nur einmal angewendet werden.

Hier könnt ihr anfangen:
- Ambulanz: Idempotenz über `clientGeneratedId` bei `/api/persons/manual` (`contract/openapi.yaml`), `backend/src/Ambulanzsystem.Api/Services/`
- PLS: `src/PLS.Api/Services/MqttPublishService.cs` (zeigt, was heute veröffentlicht wird; das ist kein Sync)

Was ihr in den einzelnen Stufen bearbeitet:
- *Stufe 1:* Entwurf des Änderungseintrags: globale ID, Akteur, Ziel, Art der Änderung, Schema-Version, Nutzdaten, Vorgängerversion. Mit A und C abstimmen.
- *Stufe 2:* Outbox-Prototyp auf dem Server mit Test-Nutzdaten ohne Patientenbezug: dauerhaft speichern, wiederholt senden, Empfang erst nach dauerhafter Annahme bestätigen, Duplikate erkennen.
- *Stufe 3:* Einsatzdaten synchronisieren.
- *Stufe 4:* Patienten- und Behandlungsdaten synchronisieren; Konflikte mit Herkunft und Version sichtbar melden.

Ob der Austausch wie vorgesehen funktioniert, zeigen die Testfälle T2.8, T3.1 und T4.1 bis T4.4.

Löst Konflikte nicht automatisch anhand von Zeitstempeln auf. Bereits finalisierte klinische Dokumente dürfen nicht überschrieben werden; eine Korrektur muss eine neue Version erzeugen.

Offene Entscheidungen: E3, E4; Sicherheitsnachweis der Nachrichten (Signatur/Authentifizierung zwischen den Servern) legt die Projektleitung fest.

E. Prüfung, Integration und Betriebsanleitung

Mit diesem Paket macht ihr die Ergebnisse überprüfbar. Zu jeder Stufe gehören wiederholbare Tests und eine Anleitung, mit der jede Person beide Systeme für einen Test starten kann.

Hier könnt ihr anfangen:
- Ambulanz: `README.md`, `docker-compose.yml`, `backend/src/Ambulanzsystem.Tests/`, `frontend/tests/` (`npm run test:offline`)
- PLS: `README.md`, `docker-compose.yml`, `docker-compose.dev.yml`, `tests/PLS.Api.Tests/`

Was ihr in den einzelnen Stufen bearbeitet:
- *Stufe 1:* Ausgangswert festhalten: Welche Builds und Tests laufen heute in beiden Projekten, welche schlagen bereits fehl?
- *Ab Stufe 2:* Die Testfälle aus Abschnitt 6 mit den jeweils Implementierenden als ausführbare Tests anlegen. Betriebsanleitung: beide Systeme starten, Netzausfall simulieren (Browser-Entwicklerwerkzeuge „Offline", Container stoppen), ausstehende oder fehlerhafte Änderungen erkennen.

Für jede Stufe sollen am Ende eine Liste der bestandenen Testfälle und eine aktuelle Betriebsanleitung vorliegen.

Die Verantwortung für Tests liegt nicht allein bei Paket E. Wer eine Funktion umsetzt, liefert die dazugehörigen fachlichen Testfälle mit.

6. Testfälle je Stufe

An diesen Testfällen prüfen wir, ob eine Stufe abgeschlossen werden kann. Setzt sie nach Möglichkeit als ausführbare Tests um. Wo das nicht möglich ist, beschreibt ihr die manuellen Prüfschritte so in der Betriebsanleitung, dass jemand anderes sie wiederholen kann. Die Angaben zu Ausgangslage, Aktion und erwartetem Ergebnis sollen euch dabei helfen.

Stufe 2 – Rechte und QR

- T2.1 – Reine Triage-Kraft kommt nicht ins Ambulanzsystem
  - Ausgangslage: Eine Einsatzkraft hat nur die Berechtigung `PLS_TRIAGE`.
  - Aktion: Sie scannt ihren QR-Code im Ambulanzsystem (`/api/qr-login`).
  - Erwartet: Die Anmeldung wird abgelehnt.
- T2.2 – Direkter API-Aufruf wird abgewiesen
  - Ausgangslage: Eine Einsatzkraft hat nur `PLS_TRIAGE` und ein gültiges PLS-Token.
  - Aktion: Sie ruft eine Ambulanz-API direkt auf, zum Beispiel `GET /api/operation-scenes`.
  - Erwartet: Die Anfrage wird mit 401 oder 403 abgelehnt und im Audit-Log protokolliert.
- T2.3 – Reine Ambulanz-Kraft kommt nicht in PLS
  - Ausgangslage: Eine Einsatzkraft hat nur `AMBULANZ_EVENT`.
  - Aktion: Sie scannt ihren QR-Code in PLS.
  - Erwartet: Die Anmeldung wird abgelehnt.
- T2.4 – Doppelte Berechtigung öffnet beide Systeme
  - Ausgangslage: Eine Einsatzkraft hat `PLS_TRIAGE` und `AMBULANZ_PERMANENT`.
  - Aktion: Sie meldet sich in beiden Systemen an.
  - Erwartet: Beide Anmeldungen gelingen, jeweils nur mit den Einsätzen, für die sie zugeteilt ist.
- T2.5 – Admin und Leitstelle arbeiten systemübergreifend
  - Ausgangslage: Ein Admin- oder Leitstellen-Konto wurde in einem der beiden Systeme angelegt.
  - Aktion: Die Person meldet sich im jeweils anderen System an.
  - Erwartet: Sie erhält Zugriff gemäß Rechte-Matrix; Admin und Leitstelle bleiben unterscheidbar.
- T2.6 – Gesperrter oder abgelaufener Zugang funktioniert nicht
  - Ausgangslage: Ein QR-Zugang ist gesperrt oder abgelaufen.
  - Aktion: Er wird in einem der beiden Systeme verwendet.
  - Erwartet: Die Anmeldung wird abgelehnt, und bestehende Sitzungen enden.
- T2.7 – Triage-Änderung übersteht einen Browser-Neustart
  - Ausgangslage: Der PLS-Browser hat keine Verbindung zum Server; der Patient ist bereits bekannt.
  - Aktion: Die Triage wird geändert und der Browser neu gestartet.
  - Erwartet: Die Änderung ist noch vorhanden und als „ausstehend" erkennbar. Nach der Wiederverbindung wird sie gesendet und bestätigt.
- T2.8 – Doppelte Zustellung wird nur einmal gespeichert
  - Ausgangslage: Der Outbox-Prototyp enthält einen Testeintrag.
  - Aktion: Derselbe Eintrag wird zweimal zugestellt.
  - Erwartet: Der Empfänger speichert ihn nur einmal und bestätigt beide Zustellungen.

Stufe 3 – Einsätze

- T3.1 – Derselbe Einsatz ist auf beiden Seiten bekannt
  - Ausgangslage: Ein Einsatz wurde in einem der beiden Systeme angelegt.
  - Aktion: Die Synchronisation läuft.
  - Erwartet: Der Einsatz ist im anderen System unter derselben globalen ID vorhanden.
- T3.2 – Ortsvorschlag erteilt keine Berechtigung
  - Ausgangslage: Eine Einsatzkraft bekommt Einsatz X als Ortsvorschlag angezeigt, ist ihm aber nicht zugeteilt.
  - Aktion: Sie öffnet Einsatz X.
  - Erwartet: Der Zugriff wird abgelehnt.
- T3.3 – Vorbereitetes Gerät funktioniert ohne Netz, aber nur befristet
  - Ausgangslage: Ein PLS-Gerät wurde gemäß Entscheidung E2 vorbereitet; die Verbindung ist getrennt.
  - Aktion: Die Einsatzkraft meldet sich an.
  - Erwartet: Innerhalb der Frist gelingt die Anmeldung; nach Ablauf oder Sperre scheitert sie.

Stufe 4 – Patienten und Behandlungsdaten

- T4.1 – Offline erfasster Patient kommt genau einmal an
  - Ausgangslage: Ein Patient wurde offline in PLS erfasst.
  - Aktion: Die Verbindung kehrt zurück.
  - Erwartet: Der Patient erscheint genau einmal im Ambulanzsystem, und seine Daten sind unverändert.
- T4.2 – Wiederholtes Senden erzeugt keine Duplikate
  - Ausgangslage: Dasselbe Sync-Paket wird mehrmals gesendet.
  - Aktion: Der Empfänger verarbeitet es.
  - Erwartet: Es entsteht kein zweiter Patient und keine doppelte Änderung.
- T4.3 – Offline-Erfassung übersteht einen Browser-Neustart
  - Ausgangslage: Ein Patient wurde offline erfasst, danach wurde der Browser neu gestartet.
  - Aktion: Die Verbindung kehrt zurück.
  - Erwartet: Der Datensatz wird vollständig übertragen; fehlgeschlagene Versuche bleiben nachvollziehbar.
- T4.4 – Konflikte werden gemeldet, nicht überschrieben
  - Ausgangslage: Beide Systeme ändern ohne Verbindung dasselbe Feld.
  - Aktion: Die Synchronisation läuft.
  - Erwartet: Der Konflikt wird mit Herkunft und Version gemeldet und nicht still überschrieben.

7. Häufige Fragen

Warum nicht einfach eine gemeinsame Datenbank? Die Anwendungen nutzen verschiedene Datenbanken (MySQL, PostgreSQL) und müssen unterschiedlich ausfallsicher sein. Der gemeinsame Vertrag legt fest, was ausgetauscht wird; die lokale Datenhaltung hält PLS im Einsatz nutzbar.

Wer entscheidet bei zwei verschiedenen Patientendaten? Nicht der letzte Zeitstempel. Zuerst müssen Datenart und Herkunft bekannt sein. Fachliche Änderungen werden versioniert oder zur Prüfung vorgelegt; die Eigentümerschaft steht im Vertrag.

Ist MQTT bereits der Sync? Nein. Die vorhandene PLS-Veröffentlichung ersetzt keine dauerhaft gespeicherten Änderungen mit Wiederholung, Empfangsbestätigung und Duplikatschutz.

Müssen wir sofort die gesamte Architektur bauen? Nein. In Stufe 2 stehen Identität, Berechtigung und QR im Vordergrund. Dazu kommen die lokale Warteschlange aus Paket C und der Outbox-Prototyp mit Testdaten aus Paket D. Den weiteren Ausbau bereitet ihr zunächst mit dem geprüften Vertrag und diesen kleinen, überprüfbaren Schritten vor.

Was tun bei unklaren Formularfeldern? Originalbezeichnung und Bedeutung erhalten, Abweichung dokumentieren und klären. Das PLS-Papierlayout und der Triageablauf werden nicht beiläufig umgestaltet.

Was tun, wenn der Code etwas anderes macht als diese Erläuterungen? Nicht stillschweigend anpassen. Abweichung unter „Offene Fragen" im Pull Request notieren und kurz per Teams oder Mail nachfragen. Abschnitt 4 listet die bereits bekannten Fälle.

8. Begleitung und Abnahme

Haltet eure Änderungen so klein, dass wir sie einzeln prüfen können. Bevor ihr Authentifizierung, medizinische Daten oder Offline-Speicherung verändert, besprechen wir kurz den Entwurf und den vorgesehenen Testfall. Ihr öffnet für jede Änderung einen Pull Request gegen `main`; ich übernehme die Prüfung und den Merge. Auf Wunsch gehen wir den Pull Request gemeinsam durch. Die sicherheits- und fachkritischen Entscheidungen aus Abschnitt 3 bleiben bei der Projektleitung.

Am Ende jeder Stufe schauen wir gemeinsam darauf, ob der vereinbarte Umfang eingehalten wurde, die fachlichen Begriffe und der API-Vertrag stimmen, die Zugriffsprüfung greift und Daten bei einem Ausfall erhalten bleiben. Dazu gehen wir die Testfälle der Stufe durch. Erst nach dieser Abnahme beginnt die nächste Stufe.

---

*Hinweis für die Betreuung:* Der Shared-Backend-Plan beschreibt als spätere Integrationsprüfung einen Lastfall mit 100 vollständigen Datensätzen von zehn vorbereiteten Geräten, die innerhalb von 60 Sekunden dauerhaft angenommen werden. Das ist ein Abnahmetest für die ausgereifte Synchronisation, keine Erwartung an diesen studentischen Abschnitt. Feldserver sind für Option 1 eine gesonderte Ausbaustufe und kein Startauftrag.
