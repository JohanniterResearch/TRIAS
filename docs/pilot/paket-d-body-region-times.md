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
  Ihre Vorgangskennung wird trotzdem festgeschrieben. Sie erzeugen keinen Schreib-Audit-Eintrag
  und keine Änderungsbenachrichtigung. Die Antwort bleibt der aktuelle Kartenstand (`200`).
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
  `writeId` erhalten in diesem Schritt weiterhin keine nachträgliche UUID.
- **Geräteuhren:** die übermittelte Bearbeitungszeit wird unverändert verglichen; keine
  Begrenzung auf Serverzeit, keine Driftkorrektur und keine neue Prüfungsregel. Eine vorgehende
  Uhr kann spätere reale Änderungen blockieren. Die tatsächliche zeitliche Reihenfolge lässt
  sich bei abweichenden Uhren nicht garantieren.
- **Admin-Korrekturen:** der bestehende Admin-Endpunkt ersetzt weiterhin die komplette Karte
  ohne Prüfung oder Fortschreibung der Regionszeiten. Seine Priorität und Einbeziehung in
  denselben Schutz sind separat zu entscheiden.
- **Konfliktanzeige und Konflikt-Audit:** folgen separat. Das Gerät erhält weiterhin nur den
  aktuellen Kartenstand. Verworfene Inhalte und Herkunft werden noch nicht im Audit erfasst.
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
