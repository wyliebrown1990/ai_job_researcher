# E5 Test — Dead / Unverifiable Source (Harvey rumor)

> Test case E5 ("a funding rumor whose primary source is unverifiable → RETRY for a
> primary source; if none, ESCALATE to the review queue, not the main digest").
> Run 2026-08-08 against the Harvey fundraising rumor.

---

## The claim

"Legal AI startup **Harvey in talks to raise $500M at $15.5B valuation**" —
originating from **The Information** (2026-08-07), echoed by secondary outlets.

## What the loop did

1. **ENRICH** surfaced the claim from secondary coverage.
2. **VERIFY** attempted the primary source
   (`theinformation.com/articles/harvey-talks-raise-funding-15-5-billion-valuation`)
   → **paywalled.** Only the headline is public: no confirmed amount, no close date,
   no named lead investor accessible.
3. **Language check:** "**in talks to raise**" = prospective, *not a closed round*.
4. **RETRY** for an independent primary source with a dated, closed round → none
   exists; every secondary outlet traces back to the same paywalled report.
5. **ESCALATE** → review queue, reason `rumored_unconfirmed` + `primary_paywalled`.

## Correct outcome (E5 PASS criteria met)

- ✅ **No `funding_event` created** — nothing has closed; a rumor is not a round.
- ✅ **Not scored as growth** — a rumored raise adds no verified traction.
- ✅ **Appears only in the digest's Review Queue (§7)**, flagged
  `rumored_unconfirmed`, with a note: *promote automatically once a closed round with
  a verifiable dated source appears.*

## E5 findings (folded into the design)

1. **Rumor ≠ round.** Classify funding language: "in talks / reportedly / could
   raise / is seeking" → **rumor** (review queue). "raised / closed / announced /
   led by" → **event** (eligible for the Funding section). Never let the first class
   into `funding_event`.
2. **Corroboration must be *independent*.** N outlets repeating one paywalled report
   is **one** source, not N. Trace secondaries to their origin before counting
   corroboration.
3. **Paywalled/unreachable primary = unverifiable, not false.** Escalate to review
   queue; don't fabricate confidence from the headline, and don't discard it either —
   set a watch to auto-promote when it closes.
