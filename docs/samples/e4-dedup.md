# E4 Test — Duplicate / Already-Tracked (dedup)

> Test case E4 ("a 'new' candidate already on the watchlist under a variant name →
> deduped, existing record refreshed, no double-count"). Run 2026-08-08 using real
> name variants observed across sources in E1/E2.

---

## The problem, with real data

The same company appears under different display names across sources:

| Source | Display name | Domain |
|--------|--------------|--------|
| Ashby board slug | `happyrobot.ai` | happyrobot.ai |
| Glassdoor | "Happyrobot Inc." | happyrobot.ai |
| Press / blog | "HappyRobot" | happyrobot.ai |
| YC | "HappyRobot" | happyrobot.ai |

A name-based key would create **3–4 duplicate rows**. A domain-based key collapses
them into one.

## Dedup design (validated by this case)

- **Canonical key = normalized primary domain** (`happyrobot.ai`), not display name.
  Registered domain, lowercased, strip `www`/subdomains, strip trailing punctuation.
- **Maintain an `aliases[]` set** on each company: {"HappyRobot", "Happyrobot Inc.",
  "happyrobot.ai"} so future variant sightings resolve to the existing record.
- **On a "new" candidate:** resolve domain → if it matches an existing record,
  **REFRESH** that record (bump `last_updated`, merge new evidence) instead of
  inserting. Increment a `sightings` counter; do not create a row.
- **Merge rule for conflicts:** keep both values with sources, prefer the primary/most
  recent (e.g. HQ "Tel Aviv" vs "New York" for June AI → keep both, flag low-confidence).

## E4 finding — generic names REQUIRE domain resolution

"June AI" is a generic name that collides with unrelated entities (a "June" smart
oven, other "June" apps). **Name-matching alone would create false merges** (wrong
companies collapsed together) *and* false splits. Domain (`june.ai` / the specific
company domain) is the only reliable identity. Rule: **never dedup or match on
display name without a domain (or another strong identifier); when no domain is
resolvable, route to the review queue rather than guess.**

**E4 PASS:** variant names collapse to one record via domain key; generic-name
collision risk identified and gated behind domain resolution.
