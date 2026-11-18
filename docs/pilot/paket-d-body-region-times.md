# Paket D, Schritt 2: Bearbeitungszeiten der Triage-Körperkarte

Gilt ausschließlich für die kanonischen Regionsmarker aus `contract/body-regions.json`.
Die Koordinaten-Körperkarte im Ambulanzprotokoll und PLS bleiben separat.

## Implementiertes Verhalten

- Beim Klick entstehen `writeId` und UTC-`clientUpdatedAt` vor dem ersten Versand.
  Onlineversuch, Offline-Fallback, IndexedDB-Speicherung, Reload und Retry behalten beide Werte.
  Eine neue Bearbeitung erhält eine neue UUID und erfasst die Uhr erneut; die Auflösung der
  Geräteuhr kann dabei gleiche Zeitstempel ergeben.
- `Body.RegionTimestampsJson` speichert die Bearbeitungszeit je Patient und kanonischem
  Regionsschlüssel. Sie ist unabhängig von `Body.UpdatedAt` (Speicherzeit der ganzen Karte).
- Die bestehende Körpersperre und Transaktion umfassen Duplikatprüfung, Zeitvergleich,
  Zustandsänderung, Audit und Vorgangsmarkierung. Die Duplikatprüfung erfolgt zuerst.
- Strikt ältere datierte Aufträge ändern weder Wert noch Regionszeit oder Karten-Speicherzeit.
  Ihre Vorgangskennung wird trotzdem festgeschrieben. Seit Schritt 4 erzeugen sie einen
  Audit-Eintrag zur Verwerfung, aber keine Änderungsbenachrichtigung. Die Antwort enthält den aktuellen Kartenstand (`200`)
  und seit Schritt 3 ein ausdrückliches Verwerfungsergebnis (siehe unten).
- Neuere Aufträge schreiben die Regionszeit auch bei gleichem Wert oder bei Entfernung (`0`)
  fort. Verschiedene Regionen werden unabhängig verglichen.
- Der Zeitstempel gehört zur Prüfsumme. Bei fehlendem/null Zeitstempel bleibt die serialisierte
  Prüfsummenform exakt wie vor dieser Erweiterung. Ein Retry erzeugt keinen Zeitstempel.
- Die Migration ergänzt nur eine leere JSON-Ablage (`{}`). Vorhandene Markierungen, ihre
  Karten-Speicherzeiten und gespeicherte Vorgangsprüfsummen bleiben unverändert. Ohne bekannte
  Regionszeit kann der erste datierte Auftrag nicht mit einer früheren Bearbeitung verglichen
  werden und wird angewendet. Die Migration datiert Bestandsmarkierungen nicht nach.

## Offene fachliche To-dos und aktuelle Grenzen

- **Gleiche Zeitstempel:** bisherige Zuweisung nach Verarbeitungsreihenfolge bleibt erhalten;
  Gleichstände werden nicht als Konflikt gemeldet. Es gibt keinen zusätzlichen Tie-Breaker.
- **Altaufträge ohne Zeitstempel:** bleiben unbedingte Zuweisungen. Sie ändern eine vorhandene
  Regionszeit nicht und können auch einen neueren Wert überschreiben. Alte Queue-Einträge ohne
  `writeId` erhielten in Schritt 2 keine nachträgliche UUID. Schritt 5 ergänzt diese vor dem
  nächsten Versand dauerhaft, weiterhin ohne einen Zeitstempel zu erfinden; siehe
  [Vorgangsabsicherung](paket-d-write-orders.md).
- **Geräteuhren:** die übermittelte Bearbeitungszeit wird unverändert verglichen; keine
  Begrenzung auf Serverzeit, keine Driftkorrektur und keine neue Prüfungsregel. Eine vorgehende
  Uhr kann spätere reale Änderungen blockieren. Die tatsächliche zeitliche Reihenfolge lässt
  sich bei abweichenden Uhren nicht garantieren.
- **Admin-Korrekturen:** der bestehende Admin-Endpunkt ersetzt weiterhin die komplette Karte
  ohne Prüfung oder Fortschreibung der Regionszeiten. Seine Priorität und Einbeziehung in
  denselben Schutz sind separat zu entscheiden.
- **Konfliktanzeige und Konflikt-Audit:** sind mit Schritt 3 und 4 ergänzt; siehe unten.
- **Kennungspflicht:** unverändert optional; der vorhandene Schutz gegen erneute Verarbeitung
  greift nur bei mitgesendeter Kennung. Ein Schlüssel mit verändertem Auftrag ergibt `409`.

Diese lokalen Regionsregeln entscheiden keine fachliche Konfliktpolitik für den Austausch
zwischen PLS und Ambulanz oder für finalisierte Ambulanzprotokolle.

## Verifikation

- Backend: 21 Tests aus `BodyPartIdempotencyTests`, `BodyPartsConcurrencyTests` und
  `BodyRegionTimestampMigrationTests` bestanden. Eigener PostgreSQL-16-Testcontainer;
  die Migration hat zusätzlich eine eigene kurzlebige Datenbank. Geprüft sind verspätete
  Markierungen/Entfernungen, unabhängige Regionen, Zeitfortschreibung bei gleichem Wert,
  Retry ohne Zustandsänderung, Zeitstempelbindung der Prüfsumme und deren Altkompatibilität.
- Frontend: 43 Unit-Tests aus Körperkarte, Offline-Queue und API-Client bestanden.
  Der neue Playwright-Test `body-map-persistence.spec.ts` prüft im Chrome-Browser
  Online-Fallback, Reload und Retry mit echter IndexedDB; bestanden.
- Vertrag: `npm run generate`, `npm run lint` und `npm run check:generated` erfolgreich.
  Frontend-Typprüfung und Produktionsbuild erfolgreich; bestehende Budget-/CommonJS-Warnungen.

## Schritt 3: Rückmeldung verworfener Aufträge

- Neue PUT-Antworten enthalten `writeResult` mit `outcome` (`applied`/`rejected`),
  `conflictReason` (`older_edit` bei Verwerfung, sonst null), kanonischer `bodyPartId`
  und dem **aktuellen** `serverValue` (0 ist eine gültige Entfernung).
  Eine Verwerfung ist ein abschließend bearbeiteter Auftrag mit HTTP 200, kein HTTP 409.
- `BodyPartProcessedWrite.RejectedAsStale` speichert die ursprüngliche Entscheidung in
  derselben Transaktion. Der Retry prüft zuerst Schlüssel und Prüfsumme, führt den Auftrag
  nicht erneut aus und meldet dieselbe Entscheidung mit dem inzwischen gültigen Regionswert.
  Ein veränderter Auftragsinhalt unter derselben Kennung bleibt HTTP 409.
- Die additive Migration `20261110142334_AddBodyPartWriteDecision` lässt die neue Spalte
  für Bestandsaufträge null. Ihre frühere Entscheidung lässt sich aus Prüfsumme und aktuellem
  Kartenstand nicht zuverlässig rekonstruieren; deren Retry liefert weiterhin kein
  `writeResult`. Bestehende Prüfsummen und Marker werden nicht verändert. GET liefert ebenfalls
  kein Schreibergebnis. Für neue Aufträge ohne Schlüssel ist die Verwerfung sichtbar, aber
  ohne stabile Kennung kann keine ursprüngliche Entscheidung für Wiederholungen garantiert werden.
- Online und nach Offline-Synchronisierung zeigt die Körperkarte Region und Verwerfungsgrund.
  Die Queue beendet den verworfenen Auftrag durch denselben atomaren `writeId`-Vergleich wie
  bei anderen Antworten. Eine verspätete Antwort löscht keinen neueren Queue-Eintrag.
- Ausstehende Regionswerte werden aus IndexedDB nach Reload wieder angezeigt. Noch neuere
  lokale Absichten überlagern Serverantworten. Ein Ergebnis eines bereits ersetzten Auftrags
  kann die Verwerfung melden, übernimmt aber keinen Wert über seine lokale Nachfolgeänderung.
  Die Queue hält die zuletzt gemeldeten Ergebnisse je Patient/Region im Arbeitsspeicher bereit,
  auch wenn die Karte zum Antwortzeitpunkt nicht geöffnet war. Diese Meldungen sind kein
  dauerhaftes Konfliktarchiv und überleben keinen weiteren Browser-Neustart nach der Bestätigung.

### Verifikation Schritt 3

- 23 betroffene Backend-Tests bestanden (Körperkarten-Idempotenz, Nebenläufigkeit und Migrationen).
  Der Test für eine verlorene Verwerfungsantwort prüft nach Host-Neustart dieselbe Entscheidung
  bei inzwischen verändertem Serverwert sowie unveränderten Zustand, Audit- und Vorgangszähler.
  Die Migration wurde in einer separaten kurzlebigen Datenbank auf eigenem PostgreSQL 16 geprüft.
- Alle 166 Frontend-Unit-Tests sowie Live-Region- und Formularprüfungen bestanden.
  Der bestehende `writeId`-Vergleich schützt die Queue auch während einer verspäteten Antwort;
  zusätzlich werden nachfolgende lokale Bearbeitungen bei der Anzeige geschützt.
- Alle 6 Chrome-Tests in `body-map-persistence.spec.ts` bestanden: ursprüngliche
  Fallback-/Reload-/Retry-Persistenz, direkte Verwerfung mit Serverwert 0/1, Verwerfung nach
  Reload und verlorener Antwort mit Retry-Wert 0/1 sowie eine verspätete Verwerfung bei
  inzwischen neuerem Queue-Eintrag und neuerer lokaler Anzeige.
- OpenAPI-Generierung, Vertragslint und `check:generated` bestanden; EF meldet keine
  ausstehenden Modelländerungen. Produktionsbuild mit Budget-/CommonJS-Warnungen.

## Schritt 4: Audit für Regionsaufträge

Die vorhandenen Audit-Spalten werden wiederverwendet; keine Migration, keine neue API-Struktur.
Jeder neue Regionsauftrag erzeugt genau **eine** Zeile mit `action=write`, `entityType=body`,
Körperkarten-ID, Patienten-ID, Akteur-ID/-Rolle und dem Regionsschlüssel in `changedFields`.
Das bisherige einfache Schreib-Audit wird durch diesen angereicherten Eintrag ersetzt.

Für neue Einträge dieses Endpunkts enthalten `before`/`after` strukturierte JSON-Schnappschüsse
(die Audit-API liefert sie unverändert als JSON-Strings). Historische skalare Einträge bleiben
unverändert. Andere Schreibwege, insbesondere Admin-Korrekturen und Triage, behalten ihr Format.

- `before`: gespeicherter `value` und dessen bekannte `clientUpdatedAt` vor der Entscheidung.
- `after.value`/`after.clientUpdatedAt`: tatsächlich gültiger Wert und Regionszeit nach der
  Entscheidung; bei Verwerfung unverändert gegenüber `before`.
- `after.requested`: angeforderter `value` und übermittelte `clientUpdatedAt`, auch wenn verworfen.
- `after.writeId`: mitgesendete UUID oder null. Fehlende Bearbeitungszeiten bleiben null und
  werden nicht durch den Audit-Zeitpunkt oder `Body.UpdatedAt` ersetzt.
- `after.decision`: `rejected_older_edit` bei Verwerfung; zusätzlich `reason=newer_stored_edit`.
  Bei angenommener Wertänderung `value_changed` (einschließlich Entfernung auf 0), bei reinem
  Erfassen/Fortschreiben der Zeit `timestamp_only`, sonst `unchanged`. Eine reine Zeitänderung
  wird damit nicht als Wertüberschreibung ausgewiesen. Gleiche oder fehlende Zeitstempel
  erhalten keine neue Konfliktregel; das protokollierte Ergebnis folgt dem bisherigen Verhalten.

Duplikatprüfung unter der Körpersperre erfolgt weiterhin **vor** Zeitvergleich und Audit.
Ein Retry mit derselben UUID und Prüfsumme erzeugt keine zweite Audit-Zeile. Die ursprünglichen
Audit-Werte bleiben auch dann unverändert, wenn der Retry inzwischen einen anderen aktuellen
Serverwert zurückliefert. HTTP 409 bei geänderten Nutzdaten erzeugt ebenfalls kein zweites Audit.
Historisch bereits verarbeitete Aufträge erhalten beim Replay keinen nachträglichen Eintrag.
Ohne UUID gibt es weiterhin keine garantierte Duplikaterkennung.

Audit, Vorgangsentscheidung und etwaige Markierungs-/Regionszeitänderung werden innerhalb
derselben vorhandenen Transaktion gespeichert. Der Audit-Dienst ruft kein eigenes Save/Commit auf.
Die offenen Regeln zu Gleichständen, undatierten Aufträgen, Geräteuhren und Admin-Korrekturen
werden durch diese Ergänzung nicht verändert.

### Verifikation Schritt 4

- 37 Backend-Tests aus `BodyPartIdempotencyTests`, `BodyPartsConcurrencyTests`,
  `BodyRegionTimestampMigrationTests` und `AuditTests` bestanden, auf eigenem PostgreSQL-16-
  Testcontainer mit isolierter Testdatenbank. Bestehende Migrationstests nutzen zusätzlich
  ihre eigenen kurzlebigen Datenbanken; für Schritt 4 ist keine Migration erforderlich.
- Geprüft: angeforderte/gespeicherte/ergebniswirksame Werte und Zeiten bei Verwerfung,
  Überschreibung in beide Richtungen einschließlich 0, reine Zeitänderung bei gleichem Wert,
  unbekannte historische Zeiten, fehlende UUID sowie Zuordnung zu Akteur/Patient/Region.
- API-Rückmeldung und Idempotenzschutz aus Schritt 3 bleiben geprüft: verlorene Antwort mit
  Retry nach Host-Neustart und inzwischen verändertem Regionswert, parallele Wiederholungen,
  HTTP 409 bei verändertem Auftragsinhalt sowie unveränderlicher ursprünglicher Audit-Eintrag.
- Erzwungene Fehler nach dem Datenbank-Save, aber vor dem Commit, prüfen für angenommene und
  verworfene Aufträge das gemeinsame Rollback von Audit, Entscheidung und Markierung.
  Die vorhandene Audit-API liefert die neuen Schnappschüsse unverändert zurück.
- EF meldet keine ausstehenden Modelländerungen. Frontend und OpenAPI-Vertrag bleiben unverändert.
