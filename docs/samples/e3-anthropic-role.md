# E3 Test — Matching Job Precision (Anthropic)

> Test case E3 ("a watchlist company posts a target-title role → surfaced with live
> URL, posted date, role-fit rationale + fit_caveat"). Run 2026-08-08 against
> Anthropic's live Greenhouse board.

---

## Roles for you — Anthropic (source of truth: Greenhouse board JSON API)

Board scanned: `boards-api.greenhouse.io/v1/boards/anthropic/jobs` — ~400 postings,
**2** matched target titles today.

### ✅ Amazon GTM Partnership, Startups — role-fit: Strong (Partner/Partnerships + technical GTM)
| Field | Value |
|-------|-------|
| Location | San Francisco / New York City / Seattle |
| Updated | 2026-08-03 |
| URL | https://job-boards.greenhouse.io/anthropic/jobs/5215052008 |
| Why it fits | Co-selling GTM strategy, joint sales/marketing programs, "translate complex technical capabilities into clear business value" — squarely technical-GTM + partnerships |
| **fit_caveat** | **Seniority** — 8+ years preferred, executive-relationship management. Fit depends on your tenure; this reads mid-to-senior IC/manager, not entry. |

### ✅ Cloud Partner Enablement Lead — role-fit: Strong (Partnerships/enablement)
| Field | Value |
|-------|-------|
| Location | San Francisco / New York City |
| URL | https://job-boards.greenhouse.io/anthropic/jobs/5369181008 |
| Why it fits | Partner enablement = technical-GTM + partnerships |
| **fit_caveat** | Verify seniority + whether "Lead" implies team management vs IC |

---

## E3 findings (folded into the design)

1. **Greenhouse HTML is JS-rendered — use the JSON API.** Fetching the human page
   returned the whole 400-job board, not the role. `boards-api.greenhouse.io` returns
   clean JSON. (Same rule as E1's Ashby: ATS API, never the HTML page.)
2. **Match on title AND body/department, not title alone.** The API noted "several
   roles include Partnerships in content but not the title." Title-only matching
   produces **false negatives** — a Solutions/Partner role whose title is "Applied AI
   Lead" would be missed. Match target concepts across title + JD + department.
3. **Job links churn fast — timestamp and re-verify.** An earlier "Manager of
   Solutions Architecture (Partnerships)" posting (job `5146999008`) **404'd** between
   discovery and enrichment. Always re-fetch live from the board API, mark dead links,
   and stamp every posting with its retrieval time.
4. **Seniority is the primary `fit_caveat` for GTM/partner roles.** These match on
   title/skills but gate on years — surface the seniority bar explicitly so you can
   judge fit at a glance.

**E3 PASS:** target-title roles surfaced with live URLs, dated, with honest fit
rationale + seniority caveat; false-negative and stale-link risks identified.
