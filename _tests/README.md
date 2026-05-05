# _tests/

Five test buckets, mirroring `01-Tech.00-*` from the project taxonomy:

| Folder | Tool | Scope |
|---|---|---|
| `manual/` | Chrome (you) | manual smoke checklists, exploratory testing |
| `file/` | Vitest + React Testing Library | unit / file-level |
| `e2e/` | Playwright | end-to-end flows in a real browser |
| `main/` | Playwright | smoke against production (nesycat.com) |
| `staging/` | Playwright | smoke against the staging deploy |

**Status:** scaffolds only. No runners installed yet — Vitest and Playwright will be wired up in a follow-up PR.
