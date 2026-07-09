# SCOPE.md — Anomaly Log & Database Schema

## Database Schema

### users
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, auto-generated |
| email | TEXT | UNIQUE, NOT NULL |
| password_hash | TEXT | bcrypt hashed |
| name | TEXT | display name |
| created_at | TIMESTAMP | auto |

### groups
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | TEXT | group name |
| created_by | UUID | FK → users |
| base_currency | TEXT | default 'INR' |
| created_at | TIMESTAMP | auto |

### group_memberships (key table for time-based membership)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| group_id | UUID | FK → groups, CASCADE DELETE |
| user_id | UUID | FK → users, CASCADE DELETE |
| joined_at | DATE | when they joined |
| left_at | DATE | NULL = still active |
| membership_type | TEXT | resident, guest, trip_member |
| created_at | TIMESTAMP | auto |

### expenses
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| group_id | UUID | FK → groups |
| description | TEXT | |
| amount | DECIMAL(12,2) | |
| currency | TEXT | default 'INR' |
| paid_by_user_id | UUID | FK → users |
| expense_date | DATE | |
| split_type | TEXT | equal, unequal, percentage, share |
| split_details_raw | TEXT | original CSV string |
| notes | TEXT | |
| status | TEXT | active, duplicate, refund, settlement, skipped |
| anomaly_flags | JSONB | list of detected issues |
| created_at | TIMESTAMP | auto |

### expense_splits
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| expense_id | UUID | FK → expenses |
| user_id | UUID | FK → users |
| computed_share | DECIMAL(12,2) | calculated amount |
| raw_share_input | TEXT | original split details |
| is_excluded | BOOLEAN | for stale/non-members |
| exclusion_reason | TEXT | why excluded |
| created_at | TIMESTAMP | auto |

### settlements
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| group_id | UUID | FK → groups |
| from_user_id | UUID | FK → users (payer) |
| to_user_id | UUID | FK → users (receiver) |
| amount | DECIMAL(12,2) | |
| currency | TEXT | default 'INR' |
| settlement_date | DATE | |
| notes | TEXT | |
| created_at | TIMESTAMP | auto |

### import_batches
Tracks each CSV import with anomaly counts and resolution log.

### currency_rates
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| from_currency | TEXT | |
| to_currency | TEXT | |
| rate | DECIMAL(10,4) | |
| effective_date | DATE | |

---

## Anomaly Log

The CSV `expenses_export.csv` contains 17 deliberate data problems. The importer detects each one and handles it according to the policy below.

| # | Row | Description | Problem | Detection | Action | Policy |
|---|-----|-------------|---------|-----------|--------|--------|
| 1 | 5-6 | Dinner at Marina Bites / dinner - marina bites | Exact duplicate — same date, same amount, same payer | Normalized description matches, date matches, amount matches, payer matches | `skip` | First occurrence wins. Second row skipped silently. |
| 2 | 23-24 | Dinner at Thalassa (₹2400) / Thalassa dinner (₹2450) | Conflicting duplicate — same date, similar description, different amounts, different payers | Normalized description similarity > 50%, date matches, amounts differ by < ₹100 | `keep` | Note says "Aisha also logged this I think hers is wrong" but no clear rule auto-deletes based on subjective notes. Both kept with `conflicting_duplicate` flag. User must clean up manually. |
| 3 | 13 | Rohan paid Aisha back | Settlement logged as expense | Keywords "paid back" in description, or regex `X paid Y back` pattern | `convert_to_settlement` | Not a shared cost. Moved to `settlements` table. Removed from expenses. |
| 4 | 12 | House cleaning supplies | Missing payer | Empty `paid_by` field | `needs_user_input` | Cannot guess who paid. Surface in review modal. User enters payer name. |
| 5 | 14 | Pizza Friday | Percentages sum to 110% | 30+30+30+20 = 110 | `normalize_percentages` | Normalize proportionally to 100%. Each pct × (100/110). |
| 6 | 31 | Weekend brunch | Percentages sum to 110% | Same as above | `normalize_percentages` | Same policy. |
| 7 | 19 | Goa villa booking | Foreign currency (USD) | currency = 'USD' | `convert_currency` | Convert to INR using stored rate (83.00) at import time. |
| 8 | 20 | Beach shack lunch | Foreign currency (USD) | currency = 'USD' | `convert_currency` | Same. |
| 9 | 22 | Parasailing | Foreign currency (USD) | currency = 'USD' | `convert_currency` | Same. |
| 10 | 25 | Parasailing refund | Foreign currency (USD) + negative amount | currency = 'USD', amount < 0 | `convert_currency` + `treat_as_refund` | Convert USD to INR. Mark status as 'refund'. |
| 11 | 27 | Groceries DMart | Missing currency | Empty currency field | `default_inr` | Default to INR when blank. |
| 12 | 22 | Parasailing | Non-member in split — "Dev's friend Kabir" | Name not found in group_memberships | `exclude` | Exclude from split. Add `non_member` anomaly flag. |
| 13 | 8 | Movie night snacks | Lowercase payer — "priya" | Name normalization to lowercase | `keep` | All names normalized to lowercase before matching. |
| 14 | 10 | Groceries DMart | Name alias — "Priya S" | Name normalization strips spaces, maps "priyas" → "priya" | `keep` | Aliases table handles common variations. |
| 15 | 26 | Airport cab | Trailing space in name — "rohan " | Name normalization trims whitespace | `keep` | Trim before matching. |
| 16 | 26 | Airport cab | Corrupted date — "Mar-14" | Unrecognized format (could be 2014 or March 14) | `infer_date` | Parser does not accept 2-digit years. Falls back to inference from previous row date + 1 day. |
| 17 | 33 | Deep cleaning service | Ambiguous date — 5/4/2026 | Could be May 4 or April 5 | `keep` | Use MM/DD/YYYY parsing → May 4, 2026. Add `ambiguous_date` flag. |
| 18 | 30 | Dinner order Swiggy | Zero amount | amount === 0 | `skip` | Skip zero-amount rows. Note says "counted twice earlier." |
| 19 | 9 | Cylinder refill | Sub-paisa precision — ₹899.995 | Decimal places > 2 detected | `round_amount` | Round to 2 decimal places → ₹900.00 |
| 20 | 6 | Electricity Feb | Comma in amount — "1,200" | Regex detects comma in amount string | `round_amount` | Strip commas before parsing. Result: 1200.00 |
| 21 | 41 | Furniture for common room | Split type mismatch — says "equal" but has explicit shares | split_type='equal' AND split_details not empty | `use_explicit_shares` | Trust explicit shares over the label. Use the share values. |
| 22 | 35 | Groceries BigBasket | Stale member — Meera after moving out | expense_date > Meera's left_at | `exclude` | Exclude Meera from split. Add `stale_membership_excluded` flag. |
| 23 | Various | Membership-over-time | Dev guest for trip, Sam joins mid-April | System design — `group_memberships` table with `joined_at`/`left_at` | `exclude`/`include` | Each expense checks membership dates. Only active members on that date are included in splits. |

**Total rows in CSV:** 42  
**Anomalies detected:** 23 (some rows have multiple issues)  
**Rows needing user input:** 1 (House cleaning supplies)  
**Rows skipped:** 2 (exact duplicate, zero amount)  
**Rows converted to settlements:** 1 (Rohan paid Aisha back)  
**Rows with normalized percentages:** 2 (Pizza Friday, Weekend brunch)  
**Rows with currency conversion:** 4 (Goa villa, Beach shack, Parasailing, Parasailing refund)  
**Rows with excluded members:** 3+ (Meera stale, Kabir non-member, Dev on non-trip expenses)  
