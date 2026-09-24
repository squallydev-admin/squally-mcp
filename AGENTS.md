# squally-mcp – Agenten-Regeln

Lokaler MCP-Server (stdio) über Squallys Lese-API. Spezifikation und
Begründungen: `../squally-app/docs/read-api-mcp-spec.md` (§4.5, §4.6, §5, §6.1);
offene Punkte in `../squally-app/docs/status.md`.

## Arbeitsregeln

- **Antworte auf Deutsch.** Code, Kommentare, Commit-Messages und die
  Tool-Beschreibungen bleiben Englisch — letztere liest ein Modell.
- **Temporäre Dateien ausschließlich im Session-Scratchpad**, nie im Repo und
  nie sonst irgendwo im Dateisystem. Kein Skript, kein Dump, kein Mitschnitt
  bleibt liegen; was zur Prüfung entsteht, wird danach gelöscht.
- **Die Lockdatei gehört zum Release-Commit.** `npm version` schreibt
  `package-lock.json` nicht mit — einmal `npm install` laufen lassen und die
  Lockdatei mitcommitten, bevor der Release-Commit steht. Sonst nennt die
  Lockdatei eine Version, die es nicht mehr gibt. (Genau das ist
  `squally-reporter` am 20.09. passiert: Lockdatei `0.5.0`, Registry `0.8.1`.)
- **Das Tool-Set ist geschlossen** (§5.1). Sieben Tools, fünf Endpunkte
  bewusst ohne Tool (§5.5). Ein achtes Tool ist eine Entscheidung über den
  Kontext, den jede Sitzung bezahlt — nicht eine Bequemlichkeit.
- **Schemata werden abgeleitet, nie abgetippt.** Input = die Parameter der
  Operation, Output = deren 200-Schema, beide aus `src/openapi/v1.json`. Wer
  ein Schema von Hand schreibt, baut die zweite Beschreibung desselben
  Vertrags.
- **Nach `npm run vendor:openapi` den Diff lesen** und den Digest in
  `test/tools.test.js` im selben Commit neu setzen. Der Digest ist die Stelle,
  an der eine stillschweigende Änderung am Client-Vertrag auffällt.
- **Kein Schlüssel wird je ausgegeben.** Meldungen nennen die Variable, nie
  den Wert — auch nicht gekürzt.
- **stdout gehört dem Protokoll.** Jede menschliche Ausgabe geht nach stderr;
  ein `console.log` zerstört den JSON-RPC-Strom.
- **Kein automatischer Rollout** — veröffentlicht wird über einen Tag
  (`publish.yml`), nicht bei jedem Push.
- **Veröffentlicht wird GESTAGED, nie direkt.** Der Trusted Publisher dieses
  Pakets erlaubt ausschließlich `npm stage publish`; `npm publish` ist für ihn
  nicht freigegeben. (Einzige Ausnahme in der Historie: **0.1.0** ging von Hand
  mit `npm publish` hinaus, bevor der Trusted Publisher eingerichtet war — diese
  eine Version trägt deshalb keine Provenance. Ab 0.1.1 gilt ausnahmslos der
  Weg unten.) Der Ablauf ist: `npm version <patch|minor|major>` (schreibt
  package.json **und** Lockdatei und setzt den Tag) → `git push --follow-tags` →
  der Workflow staged mit `npm stage publish --provenance --access public` →
  **ein Mensch gibt die Version auf npmjs.com frei** (Staged Packages →
  Approve, mit 2FA) oder per `npm stage approve <stage-id>`. Vorher ist die
  Version in der Registry vorhanden, aber nicht installierbar.
  `npm stage publish` fragt nie nach 2FA — genau deshalb läuft es in CI; der
  Nachweis der Anwesenheit sitzt in der Freigabe.
- **Staged Publishing braucht npm ≥ 11.15.0 und Node ≥ 22.14.0**
  (docs.npmjs.com/staged-publishing). Node 22 liefert weiterhin npm 10.9.9 mit,
  also `npm --version` prüfen statt von der Node-Version darauf zu schließen.
  `publish.yml` läuft deshalb auf Node 24 und bricht mit genau dieser
  Anforderung ab, wenn ein Runner ein älteres npm mitbringt. Das sagt nichts
  über die Unterstützung des Pakets selbst: `engines` bleibt `>=22`, und
  `ci.yml` testet 22 und 24.
- **Messen statt aus der Doku übernehmen.**
- **Prämissen-Konflikte melden statt still zu überschreiben.**
- **Ehrlich melden, was nicht geprüft werden konnte.**
- **Nicht committen, stagen oder pushen**, solange nicht danach gefragt wird.
- **Keine Drive-by-Änderungen.**

## Konventionen

- Variablennamen: Englisch
- Nicht offensichtliche Entscheidungen: kurze Begründung als Code-Kommentar
- Vor einem Release: `npm test` und `npm pack --dry-run` prüfen
