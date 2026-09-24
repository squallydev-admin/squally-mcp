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
- **Messen statt aus der Doku übernehmen.**
- **Prämissen-Konflikte melden statt still zu überschreiben.**
- **Ehrlich melden, was nicht geprüft werden konnte.**
- **Nicht committen, stagen oder pushen**, solange nicht danach gefragt wird.
- **Keine Drive-by-Änderungen.**

## Konventionen

- Variablennamen: Englisch
- Nicht offensichtliche Entscheidungen: kurze Begründung als Code-Kommentar
- Vor einem Release: `npm test` und `npm pack --dry-run` prüfen
