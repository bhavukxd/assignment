# Scope & Anomaly Log

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

### group_memberships (key table)
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

The CSV `expenses_export.csv` contains 18 deliberate data problems. The importer detects each one and handles it according to the policy below.

| # | Row | Description | Problem | Detection | Action | Policy |
|---|-----|-------------|---------|-----------|--------|--------|
| 1 | 5 | dinner - marina bites | Exact duplicate of row 4 | Same date, normalized description, same amount, same payer | `skip` | First occurrence wins. Exact duplicates are silently skipped. |
| 2 | 6 | Electricity Feb | Comma in amount: "1,200" | Regex detects comma in amount string | `round_amount` | Strip commas before parsing. Result: 1200.00 |
| 3 | 8 | Movie night snacks | Lowercase payer: "priya" | Name normalization to lowercase | `keep` | All names normalized to lowercase before matching. |
| 4 | 9 | Cylinder refill | Sub-paisa precision: 899.995 | Decimal places > 2 detected | `round_amount` | Round to 2 decimal places → 900.00 |
| 5 | 10 | Groceries DMart | Name alias: "Priya S" | Name normalization strips spaces, maps "priyas" → "priya" | `keep` | Aliases table handles common variations. |
| 6 | 12 | House cleaning supplies | Missing payer | Empty `paid_by` field | `needs_user_input` | Surface to user in review modal. User enters payer name. |
| 7 | 13 | Rohan paid Aisha back | Settlement logged as expense | Keywords: "paid back" in description | `convert_to_settlement` | Move to `settlements` table. Not an expense. |
| 8 | 14 | Pizza Friday | Percentages sum to 110% | 30+30+30+20 = 110 | `normalize_percentages` | Normalize proportionally to 100%. Each person gets × (100/110). |
| 9 | 19 | Goa villa booking | Foreign currency (USD) | currency = 'USD' | `convert_currency` | Convert to INR using stored rate (83.00) at import time. |
| 10 | 20 | Beach shack lunch | Foreign currency (USD) | currency = 'USD' | `convert_currency` | Convert to INR using stored rate. |
| 11 | 22 | Parasailing | Non-member in split: "Dev's friend Kabir" | Name not found in group_memberships | `exclude` | Exclude from split. Add `non_member` anomaly flag. |
| 12 | 23-24 | Dinner at Thalassa / Thalassa dinner | Conflicting duplicate (different amounts: 2400 vs 2450) | Same date, similar description, different amounts | `keep` | Note says "Aisha also logged this I think hers is wrong." No clear rule on which to delete, so both kept with flags. User can clean up manually. |
| 13 | 25 | Parasailing refund | Negative amount: -30 USD | amount < 0 | `treat_as_refund` | Mark expense status as 'refund'. Applied against original expense in balance calc. |
| 14 | 26 | Airport cab | Corrupted date "Mar-14" | Unrecognized format | `infer_date` | Infer from previous row date + 1 day. |
| 15 | 26 | Airport cab | Trailing space in name "rohan " | Name normalization trims whitespace | `keep` | Trim before matching. |
| 16 | 27 | Groceries DMart | Missing currency | Empty currency field | `default_inr` | Default to INR when currency is blank. |
| 17 | 30 | Dinner order Swiggy | Zero amount | amount === 0 | `skip` | Skip zero-amount rows. Note says "counted twice earlier." |
| 18 | 31 | Weekend brunch | Percentages sum to 110% | 30+30+30+20 = 110 | `normalize_percentages` | Normalize to 100% proportionally. |
| 19 | 33 | Deep cleaning service | Ambiguous date: 5/4/2026 | Could be May 4 or April 5 | `keep` | Use MM/DD/YYYY parsing → May 4, 2026. Add `ambiguous_date` flag. |
| 20 | 35 | Groceries BigBasket | Stale member: Meera after moving out | expense_date > Meera's left_at | `exclude` | Exclude Meera from split. Add `stale_membership_excluded` flag. |
| 21 | 41 | Furniture for common room | Split type mismatch: says "equal" but has explicit shares | split_type='equal' AND split_details not empty | `use_explicit_shares` | Trust explicit shares over the label. Use the share values. |

**Total rows in CSV:** 42  
**Anomalies detected:** 21 (some rows have multiple issues)  
**Rows needing user input:** 1 (House cleaning supplies)  
**Rows skipped:** 2 (exact duplicate, zero amount)  
**Rows converted to settlements:** 1 (Rohan paid Aisha back)  
**Rows with normalized percentages:** 2 (Pizza Friday, Weekend brunch)  
**Rows with currency conversion:** 4 (Goa villa, Beach shack, Parasailing, Parasailing refund)  
