# AI_USAGE.md — AI Collaboration Log

**Primary AI Tool:** Claude (Anthropic) — used as the primary development collaborator for coding, debugging, and architecture decisions.  
**Secondary:** None.  
**Total interaction time:** ~6 hours across multiple sessions.

---

## Key Prompts Used

1. **"Build a shared expenses app with CSV import, anomaly detection, and balance calculation using React, Node.js, and Supabase."**
   - Used to scaffold the initial project structure, database schema, and API endpoints.

2. **"The CSV has deliberate data problems: duplicates, missing payers, foreign currency, stale memberships, percentage mismatches, negative amounts. How do I detect and handle each one?"**
   - Used to build the `detectAnomalies()` function and the import pipeline.
n3. **"Meera moved out end of March and Sam moved in mid-April. How do I make sure expenses only affect active members?"**
   - Used to design the `group_memberships` table with `joined_at` and `left_at` dates.

4. **"Rohan wants to see exactly which expenses make up his balance. How do I build an itemized breakdown?"**
   - Used to create the `getItemizedBreakdown()` function.

5. **"Review my import output and tell me what's still wrong."**
   - Used to iteratively fix bugs after testing the CSV import.

6. **"My frontend is calling localhost:5000 on Render. How do I fix the API URL for production?"**
   - Used to configure production API URLs and deployment settings.

---

## Concrete Cases Where AI Was Wrong

### Case 1: Stale Memberships — AI Said "Keep" Inactive Members in Splits

**What the AI produced:**
The AI initially wrote the stale_membership anomaly handler with action `keep`:

```javascript
// AI's first version
if (memberLeftDate && expenseDate > memberLeftDate) {
  anomalies.push({ type: 'stale_membership', severity: 'warning' });
  actions.push('keep'); // <-- WRONG
}
```

This meant inactive members were still included in the split calculation. Meera was still being charged for April groceries even though she moved out in March.

**How I caught it:**
I ran the import and checked the expense splits in the database. Meera had a `computed_share` for the April 2 "Groceries BigBasket" row. Sam's requirement also flagged this: "Why would March electricity affect my balance?" — which made me check if the reverse was also true (Meera being charged for April expenses).

**What I changed:**
I changed the action from `keep` to `exclude`. The importer now:
1. Checks `group_memberships` for each person in `split_with`
2. Compares `expense_date` against `joined_at` and `left_at`
3. If the person was not active on that date, they are excluded from `calculateSplits()`
4. An `expense_splits` row is still created for them with `is_excluded=true` and `exclusion_reason='Not active on this date'`

```javascript
// Fixed version
if (!foundActive) {
  excludedMembers.push(memberName);
  rowAnomalies.push({
    type: 'stale_membership_excluded',
    message: `${memberName} was not active on ${expenseDate}. Excluded from split.`,
    severity: 'warning'
  });
}
```

**Lesson:** The AI assumed "flag and keep" was safer. But for financial splits, keeping an inactive member is mathematically wrong. I had to explicitly tell the AI that exclusion is the correct behavior for this domain.

---

### Case 2: Duplicate Detection — AI Only Checked Exact String Matches

**What the AI produced:**
The AI's first `detectAnomalies()` function checked for exact duplicates using the raw description string:

```javascript
// AI's first version
const duplicateIndex = allRows.findIndex((r, i) => 
  i < index && 
  r.date === rawDate && 
  r.description === description && // <-- exact match only
  parseFloat(r.amount || 0) === amount
);
```

This missed "Dinner at Marina Bites" (row 4) and "dinner - marina bites" (row 5) because the capitalization and punctuation differed.

**How I caught it:**
After the first import, both rows appeared in the expense list. The import report showed 0 duplicates detected. I manually compared the CSV and saw the two rows were clearly the same dinner.

**What I changed:**
I added a `normalizeDescription()` function that:
- Converts to lowercase
- Removes punctuation (replaces with spaces)
- Removes stop words ("at", "the", "for", etc.)
- Collapses multiple spaces

```javascript
function normalizeDescription(desc) {
  if (!desc) return '';
  let normalized = desc.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stopWords = ['at', 'the', 'for', 'from', 'with', 'and'];
  const words = normalized.split(' ');
  const filtered = words.filter(w => w.length > 2 && !stopWords.includes(w));
  return filtered.join(' ');
}
```

Now both "Dinner at Marina Bites" and "dinner - marina bites" normalize to "dinner marina bites", so the duplicate is caught.

**Lesson:** The AI assumed raw string equality was sufficient. Real-world data has inconsistent formatting. I had to add fuzzy matching logic that the AI did not suggest initially.

---

### Case 3: Settlement Detection — AI Suggested Manual SQL Cleanup Instead of Automatic Handling

**What the AI produced:**
When the AI reviewed the import output and saw "Rohan paid Aisha back" was still in the expenses table, it suggested running manual SQL commands to fix it:

```sql
-- AI suggested this as a "fix"
INSERT INTO settlements (...)
SELECT ... FROM expenses WHERE description = 'Rohan paid Aisha back';
DELETE FROM expenses WHERE description = 'Rohan paid Aisha back';
```

The AI treated this as a one-time cleanup task rather than a pattern to handle automatically.

**How I caught it:**
I realized that manual SQL is not a scalable solution. The assignment says the importer must handle anomalies automatically. I told the AI: "we cannot make if else for everything" and "leave it i am not doing in sql." The AI's approach violated the core requirement that the importer must detect, surface, and handle problems during the import itself — not require post-hoc manual fixes.

**What I changed:**
I added automatic settlement detection using regex patterns:

```javascript
// Detect "X paid Y back" pattern
const paidBackMatch = descLower.match(/(\w+)\s+paid\s+(\w+)\s+back/i);
if (paidBackMatch) {
  const from = normalizeName(paidBackMatch[1]);
  const to = normalizeName(paidBackMatch[2]);
  anomalies.push({
    type: 'settlement_mislabeled',
    message: `This is a settlement: ${from} paid ${to} back`,
    severity: 'info'
  });
  actions.push('convert_to_settlement');
}
```

And in the import loop, when `convert_to_settlement` is the action:
```javascript
if (resolvedAction === 'convert_to_settlement') {
  await supabase.from('settlements').insert([{
    group_id: groupId,
    from_user_id: fromUser.id,
    to_user_id: toUser.id,
    amount: Math.abs(amount),
    currency: currency || 'INR',
    settlement_date: expenseDate,
    notes: notes || description
  }]);
  results.push({ row: rowNum, status: 'converted_to_settlement' });
  continue; // skip inserting as expense
}
```

**Lesson:** The AI defaulted to manual database fixes because it was "safer." But the assignment explicitly requires automatic handling. I had to push the AI to write automatic detection and conversion logic instead of SQL patches.

---

## Additional AI Corrections (Minor)

### Date Parsing: AI Missed "Mar-14" Format
The AI's `parseDate()` function handled Excel serials, ISO dates, and US formats, but missed the corrupted "Mar-14" date in row 26. I had to add:

```javascript
const monthMatch = trimmed.match(/^([A-Za-z]{3})-(\d{1,2})$/);
if (monthMatch) {
  const months = { jan: 1, feb: 2, mar: 3, ... };
  const month = months[monthMatch[1].toLowerCase()];
  const day = parseInt(monthMatch[2]);
  // ... parse as current year
}
```

### Amount Parsing: AI Did Not Handle Commas
The AI's `parseFloat()` on "1,200" returned 1 instead of 1200. I added `amountStr.replace(/,/g, '')` before parsing.

### Deployment: AI Suggested Vercel for Backend
The AI initially suggested deploying the backend on Vercel. I knew Vercel is for static sites and serverless functions, not Express servers with file uploads. I chose Render instead for the full-stack deployment.

---

## Overall Assessment of AI Collaboration

**What AI did well:**
- Scaffolded the entire project structure quickly (React components, Express routes, Supabase schema)
- Identified most anomalies in the CSV on the first pass
- Wrote the balance calculation algorithm (min-transaction optimization) correctly
- Generated the review modal UI for missing payer resolution
- Helped with deployment configuration and troubleshooting

**What AI did poorly:**
- Tended toward "safe" manual fixes rather than automatic handling
- Assumed data was cleaner than it was (exact string matching, no comma handling)
- Did not initially consider time-based memberships as a first-class requirement
- Over-engineered some solutions (suggested separate `refunds` table, complex SQL cleanup scripts)
- Suggested Vercel for backend deployment without considering the file upload requirement

**My role as engineer:**
- I reviewed every line of AI-generated code before using it
- I tested the import with the actual CSV and caught bugs the AI missed
- I made the final decisions on handling policies (exclude vs keep, normalize vs reject)
- I simplified AI suggestions that were too complex for a 2-day demo (e.g., rejected separate refunds table)
- I chose the deployment platform based on the actual requirements (Render over Vercel for backend)
- I debugged the production deployment issues (API URL configuration, static file serving, path corrections)
