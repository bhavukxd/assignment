# DECISIONS.md — Decision Log

This document records every significant decision made while building the app, the options considered, and why the chosen path was selected.

---

## 1. Tech Stack: React + Node.js + Express + Supabase

**Context:** Need a full-stack app with relational database, auth, and file upload in 2 days.

**Options considered:**
- **Option A:** Firebase (Firestore + Firebase Auth) — fast setup, but NoSQL. Assignment requires relational DB.
- **Option B:** Raw PostgreSQL on local machine — relational, but harder to deploy and manage.
- **Option C:** Supabase (PostgreSQL + REST API + auth) — relational, free tier, easy deployment, built-in auth.

**Decision:** Option C — Supabase.

**Why:**
- Relational DB requirement is non-negotiable (assignment explicitly says "Use relational DBs only").
- Supabase gives PostgreSQL with a free tier and auto-generated REST API.
- No need to manage database hosting separately.
- JWT auth is straightforward to integrate.

**Trade-off:** Tied to Supabase's free tier limits. For a demo app, this is acceptable.

---

## 2. Database Schema: Memberships with `joined_at` and `left_at` dates

**Context:** Meera moved out end of March, Sam moved in mid-April. Expenses must only affect active members.

**Options considered:**
- **Option A:** Simple array of member IDs on the `groups` table. Members are either in or out forever.
- **Option B:** Separate `group_memberships` table with `joined_at` and `left_at` dates.

**Decision:** Option B — Time-based memberships.

**Why:**
- Sam explicitly asked: "Why would March electricity affect my balance?" This requires knowing exactly when someone joined.
- Meera's farewell dinner (March 27) should include her, but April rent (April 1) should not.
- A simple boolean "is_member" cannot represent this.

**Trade-off:** More complex queries. Every expense import must check membership dates against the expense date. This adds a database query per row during import, but it's necessary for correctness.

---

## 3. Duplicate Handling: Skip exact, flag conflicting

**Context:** Row 4 and 5 are exact duplicates ("Dinner at Marina Bites"). Rows 23 and 24 are conflicting duplicates (same dinner, different amounts: 2400 vs 2450).

**Options considered:**
- **Option A:** Skip ALL duplicates automatically. Risk: might lose the correct version if the first row was wrong.
- **Option B:** Keep ALL duplicates. Risk: inflates balances incorrectly.
- **Option C:** Skip exact duplicates (same amount, same payer), but flag conflicting ones (different amounts) for user attention.

**Decision:** Option C — Smart duplicate detection.

**Why:**
- Exact duplicates are clearly errors. Skipping the second occurrence is safe.
- Conflicting duplicates (different amounts) are ambiguous. The note says "Aisha also logged this I think hers is wrong" — but the app cannot know for sure which is wrong without a rule.
- Meera's requirement: "Clean up the duplicates — but I want to approve anything the app deletes." This means we should not silently delete conflicting data.

**Trade-off:** Conflicting duplicates remain in the database. The user must manually clean them up. This is safer than guessing wrong.

---

## 4. Stale Memberships: Exclude from splits, don't delete rows

**Context:** Meera moved out end of March. Row 35 (April 2 groceries) still lists her in `split_with`.

**Options considered:**
- **Option A:** Reject the entire expense if it includes a stale member.
- **Option B:** Delete the expense from the database.
- **Option C:** Import the expense but exclude the stale member from the split calculation. Mark them as `is_excluded` in `expense_splits`.

**Decision:** Option C — Exclude with flag.

**Why:**
- Rejecting the whole expense would lose valid data for the other members.
- Deleting rows violates Meera's requirement to approve deletions.
- Excluding from the split keeps the expense visible, preserves the original CSV data in `split_details_raw`, and clearly marks why the member was excluded.

**Trade-off:** The expense total amount might not match the sum of splits if a member is excluded. The app handles this by recalculating splits only among active members.

---

## 5. Currency Conversion: Convert at import time to base currency (INR)

**Context:** Goa trip expenses are in USD. Priya said: "The sheet pretends a dollar is a rupee. That can't be right."

**Options considered:**
- **Option A:** Store original currency and convert at display time. Pros: preserves original data. Cons: balances change if exchange rates update, making them non-deterministic.
- **Option B:** Convert to INR at import time using a stored rate. Pros: balances are stable and deterministic. Cons: loses the original USD amount in balance calculations (still stored in `amount` field).

**Decision:** Option B — Convert at import time for balance calculations.

**Why:**
- Aisha wants "one number per person." That number must be stable.
- If the USD/INR rate changes tomorrow, Aisha's balance should not change for a March expense.
- The original USD amount is still stored in the `amount` and `currency` fields for reference.

**Trade-off:** Requires maintaining a `currency_rates` table. We seeded it with 83.00 for the demo. In production, this would need periodic updates.

---

## 6. Missing Payer: Surface to user via modal, don't guess

**Context:** Row 12 "House cleaning supplies" has empty `paid_by` field.

**Options considered:**
- **Option A:** Skip the row. Risk: lose valid expense data.
- **Option B:** Guess the payer (e.g., first person in `split_with`). Risk: wrong guess corrupts balances.
- **Option C:** Flag as `needs_user_input`, show in a review modal after import. User types the payer name.

**Decision:** Option C — User review modal.

**Why:**
- The note says "can't remember who paid." The app definitely cannot remember either.
- Guessing would violate the principle of handling imperfect data deliberately rather than silently.
- The modal lets the user resolve it in one click without re-importing the CSV.

**Trade-off:** Import is not fully automated. One row out of 42 needs manual intervention. This is acceptable for a demo.

---

## 7. Settlement Detection: Keyword-based auto-convert

**Context:** Row 13 "Rohan paid Aisha back" is a settlement, not a shared expense.

**Options considered:**
- **Option A:** Manual entry only. User must use the "Record Payment" tab. Risk: user might not notice the mislabeled row in the CSV.
- **Option B:** Auto-detect based on keywords like "paid back," "repaid," "settlement." Convert to `settlements` table automatically.

**Decision:** Option B — Keyword-based auto-detection.

**Why:**
- The description explicitly says "paid Aisha back." This is unambiguous.
- Converting it to a settlement ensures it does not appear in the expense list and does not get split among the group.
- The `settlements` table is designed exactly for this: direct payments between two people.

**Trade-off:** False positives possible. "Priya paid for groceries" contains "paid" but is not a settlement. We use specific phrases ("paid back", "repaid") to avoid this.

---

## 8. Percentage Mismatch: Normalize to 100% proportionally

**Context:** Pizza Friday (row 14) has percentages 30+30+30+20 = 110%. Weekend brunch (row 31) has the same issue.

**Options considered:**
- **Option A:** Reject the row. Risk: user loses the expense.
- **Option B:** Keep as-is (110%). Risk: balance calculations are mathematically wrong.
- **Option C:** Normalize proportionally. Multiply each percentage by (100 / total). 30% becomes 27.27%, 20% becomes 18.18%.

**Decision:** Option C — Proportional normalization.

**Why:**
- The intent is clear: they meant to split the bill, just added wrong. Keeping the proportions respects the intent.
- Rejecting would be too strict for a messy real-world CSV.
- The anomaly is flagged so the user knows it happened.

**Trade-off:** Slight rounding differences (e.g., 27.27% × 1440 = 392.69). The app rounds to 2 decimal places, so the sum might be ₹1439.99 instead of ₹1440. This is negligible for a demo.

---

## 9. Split Type Mismatch: Trust explicit shares over the label

**Context:** Row 41 "Furniture for common room" says `split_type=equal` but provides explicit shares (Aisha 1; Rohan 1; Priya 1; Sam 1).

**Options considered:**
- **Option A:** Trust the label (`equal`). Ignore the shares. Risk: if shares were actually unequal, this is wrong.
- **Option B:** Trust the explicit shares. Use them even if label says `equal`.

**Decision:** Option B — Trust explicit data over label.

**Why:**
- The label is just a string. The shares are actual numbers.
- In this case, the shares happen to be equal (1 each), so both options give the same result. But the policy is: if detailed data exists, use it.
- This handles cases where someone mislabels a split type.

**Trade-off:** The `split_type` field in the database will still say `equal`, which is slightly misleading. The `split_details_raw` field preserves the original data for audit.

---

## 10. Negative Amounts: Treat as refund

**Context:** Row 25 "Parasailing refund" has amount -30 USD.

**Options considered:**
- **Option A:** Reject as invalid. Risk: lose legitimate refund data.
- **Option B:** Store as negative expense. Risk: balance calculations might not handle negatives correctly.
- **Option C:** Mark status as `refund`, store absolute amount, and apply it as a credit in balance calculations.

**Decision:** Option C — Refund status.

**Why:**
- A refund is a real financial event. It should affect balances.
- Marking the status as `refund` makes it clear this is not a regular expense.
- In balance calculation, the payer gets credited (they received money back) and the split members get debited less.

**Trade-off:** The `expenses` table now has a mixed purpose (both expenses and refunds). A separate `refunds` table would be cleaner, but for a demo, a status flag is sufficient.

---

## 11. Deployment: Render for full-stack, not Vercel

**Context:** Need to deploy both frontend and backend.

**Options considered:**
- **Option A:** Vercel for frontend, Render for backend. Pros: Vercel is fast for React. Cons: two URLs, CORS issues, more complex.
- **Option B:** Render for everything. Serve React build from Express. Pros: one URL, no CORS, simpler. Cons: slightly slower frontend updates.

**Decision:** Option B — Render for everything.

**Why:**
- One deployment, one URL, one platform to manage.
- Express serves the React `dist` folder with `express.static()`.
- No CORS configuration needed between frontend and backend.
- For a 2-day assignment, simplicity wins.

**Trade-off:** Render free tier spins down after inactivity. First request after idle takes ~30 seconds to wake up.
