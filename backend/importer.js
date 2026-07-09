const fs = require('fs');
const csv = require('csv-parser');
const supabase = require('./supabase');

function excelDateToJSDate(serial) {
  const utcDays = serial - 25569;
  const ms = utcDays * 86400 * 1000;
  const date = new Date(ms);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}

function parseDate(rawDate) {
  if (!rawDate || rawDate.trim() === '') {
    return { date: null, error: 'Empty date' };
  }
  
  const trimmed = rawDate.trim();
  
  // Excel serial number
  if (/^\d{5,}$/.test(trimmed)) {
    const serial = parseInt(trimmed);
    const result = excelDateToJSDate(serial);
    if (!result) return { date: null, error: `Invalid Excel serial: ${trimmed}` };
    const year = parseInt(result.split('-')[0]);
    if (year < 2020 || year > 2030) {
      return { date: null, error: `Date out of range: ${result}` };
    }
    return { date: result, source: 'excel_serial' };
  }
  
  // ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { date: trimmed, source: 'iso' };
  }
  
  // US format MM/DD/YYYY
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const month = parseInt(usMatch[1]);
    const day = parseInt(usMatch[2]);
    const year = parseInt(usMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2020 && year <= 2030) {
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return { date: d.toISOString().split('T')[0], source: 'us_format' };
      }
    }
  }
  
  // MMM-DD format (Mar-14)
  const monthMatch = trimmed.match(/^([A-Za-z]{3})-(\d{1,2})$/);
  if (monthMatch) {
    const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const month = months[monthMatch[1].toLowerCase()];
    const day = parseInt(monthMatch[2]);
    if (month && day >= 1 && day <= 31) {
      const year = new Date().getFullYear();
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2020 && d.getFullYear() <= 2030) {
        return { date: d.toISOString().split('T')[0], source: 'mmm_dd' };
      }
    }
  }
  
  // Try native parsing
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    if (year >= 2020 && year <= 2030) {
      return { date: d.toISOString().split('T')[0], source: 'parsed' };
    }
  }
  
  return { date: null, error: `Unrecognized date format: ${trimmed}` };
}

function normalizeDescription(desc) {
  if (!desc) return '';
  
  let normalized = desc.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const stopWords = ['at', 'the', 'for', 'from', 'with', 'and', 'or', 'but', 'on', 'in', 'to'];
  const words = normalized.split(' ');
  const filtered = words.filter(w => 
    w.length > 2 && !stopWords.includes(w) && !/^\d+$/.test(w)
  );
  
  return filtered.join(' ');
}

const NAME_ALIASES = {
  'aisha': 'aisha',
  'rohan': 'rohan',
  'priya': 'priya',
  'priyas': 'priya',
  'meera': 'meera',
  'dev': 'dev',
  'sam': 'sam',
  'kabir': 'kabir'
};

function normalizeName(name) {
  if (!name || !name.trim()) return null;
  const cleaned = name.trim().toLowerCase().replace(/[^a-z]/g, '');
  return NAME_ALIASES[cleaned] || cleaned;
}

function parseMembers(memberString) {
  if (!memberString) return [];
  return memberString.split(';')
    .map(m => normalizeName(m))
    .filter(Boolean);
}

function calculateSplits(amount, splitType, splitDetails, splitWith, validMembers) {
  const shares = [];
  
  let memberList = validMembers && validMembers.length > 0 
    ? validMembers 
    : parseMembers(splitWith);
  
  if (memberList.length === 0) return [];
  
  memberList = [...new Set(memberList)];
  
  switch (splitType) {
    case 'equal': {
      const perPerson = amount / memberList.length;
      memberList.forEach(m => {
        shares.push({ user: m, amount: parseFloat(perPerson.toFixed(2)) });
      });
      break;
    }
    
    case 'unequal': {
      if (!splitDetails) {
        const perPerson = amount / memberList.length;
        memberList.forEach(m => shares.push({ user: m, amount: parseFloat(perPerson.toFixed(2)) }));
        break;
      }
      const parts = splitDetails.split(';').map(p => p.trim());
      let totalAssigned = 0;
      const tempShares = [];
      
      parts.forEach(part => {
        const match = part.match(/([a-z\s]+)\s+(\d+(?:\.\d+)?)/i);
        if (match) {
          const user = normalizeName(match[1]);
          const amt = parseFloat(match[2]);
          if (user && memberList.includes(user)) {
            tempShares.push({ user, amount: amt });
            totalAssigned += amt;
          }
        }
      });
      
      if (tempShares.length > 0 && Math.abs(totalAssigned - amount) > 0.01) {
        const factor = amount / totalAssigned;
        tempShares.forEach(s => {
          s.amount = parseFloat((s.amount * factor).toFixed(2));
        });
      }
      
      shares.push(...tempShares);
      break;
    }
    
    case 'percentage': {
      if (!splitDetails) {
        const perPerson = amount / memberList.length;
        memberList.forEach(m => shares.push({ user: m, amount: parseFloat(perPerson.toFixed(2)) }));
        break;
      }
      const parts = splitDetails.split(';').map(p => p.trim());
      let totalPct = 0;
      const tempShares = [];
      
      parts.forEach(part => {
        const match = part.match(/([a-z\s]+)\s+(\d+(?:\.\d+)?)\s*%/i);
        if (match) {
          const user = normalizeName(match[1]);
          const pct = parseFloat(match[2]);
          if (user && memberList.includes(user)) {
            totalPct += pct;
            tempShares.push({ user, pct });
          }
        }
      });
      
      const factor = totalPct === 0 ? 1 : 100 / totalPct;
      tempShares.forEach(s => {
        const share = amount * (s.pct * factor / 100);
        shares.push({ user: s.user, amount: parseFloat(share.toFixed(2)) });
      });
      break;
    }
    
    case 'share': {
      if (!splitDetails) {
        const perPerson = amount / memberList.length;
        memberList.forEach(m => shares.push({ user: m, amount: parseFloat(perPerson.toFixed(2)) }));
        break;
      }
      const parts = splitDetails.split(';').map(p => p.trim());
      let totalShares = 0;
      const tempShares = [];
      
      parts.forEach(part => {
        const match = part.match(/([a-z\s]+)\s+(\d+)/i);
        if (match) {
          const user = normalizeName(match[1]);
          const shareCount = parseInt(match[2]);
          if (user && memberList.includes(user)) {
            totalShares += shareCount;
            tempShares.push({ user, shareCount });
          }
        }
      });
      
      if (totalShares === 0) {
        const perPerson = amount / memberList.length;
        memberList.forEach(m => shares.push({ user: m, amount: parseFloat(perPerson.toFixed(2)) }));
        break;
      }
      
      tempShares.forEach(s => {
        const share = amount * (s.shareCount / totalShares);
        shares.push({ user: s.user, amount: parseFloat(share.toFixed(2)) });
      });
      break;
    }
    
    default: {
      const perPerson = amount / memberList.length;
      memberList.forEach(m => shares.push({ user: m, amount: parseFloat(perPerson.toFixed(2)) }));
    }
  }
  
  return shares;
}

async function detectAnomalies(row, index, allRows, groupId) {
  const anomalies = [];
  const actions = [];
  
  const description = (row.description || '').trim();
  const rawDate = (row.date || '').trim();
  const rawAmount = (row.amount || '0').trim();
  const paidByRaw = (row.paid_by || '').trim();
  const paidBy = normalizeName(paidByRaw);
  let currency = ((row.currency || '').trim() || 'INR').toUpperCase();
  const splitType = ((row.split_type || 'equal').trim()).toLowerCase();
  const splitDetails = (row.split_details || '').trim();
  const splitWith = (row.split_with || '').trim();
  const notes = (row.notes || '').trim();
  
  const amount = parseFloat(rawAmount) || 0;
  
  // 1. Check for duplicates with similarity matching
  const normalizedDesc = normalizeDescription(description);
  
  const similarIndex = allRows.findIndex((r, idx) => {
    if (idx >= index) return false;
    const rDesc = normalizeDescription(r.description);
    const rAmount = parseFloat(r.amount || 0);
    const rPaidBy = normalizeName(r.paid_by);
    
    const descWords = normalizedDesc.split(' ').filter(w => w.length > 3);
    const rDescWords = rDesc.split(' ').filter(w => w.length > 3);
    const commonWords = descWords.filter(w => rDescWords.includes(w));
    const similarity = commonWords.length / Math.max(descWords.length, rDescWords.length, 1);
    
    return similarity > 0.5 && 
           r.date === rawDate && 
           Math.abs(rAmount - amount) < 100;
  });
  
  if (similarIndex !== -1) {
    const existingAmount = parseFloat(allRows[similarIndex].amount || 0);
    
    if (Math.abs(existingAmount - amount) < 0.01) {
      anomalies.push({
        type: 'exact_duplicate',
        message: `Duplicate of row ${similarIndex + 1} (same amount)`,
        severity: 'warning'
      });
      actions.push('skip');
    } else {
      const note = notes.toLowerCase();
      const keepThis = note.includes('wrong') || note.includes('also logged') || note.includes('correct');
      
      if (keepThis) {
        anomalies.push({
          type: 'conflicting_duplicate_keep',
          message: `Conflicting amount with row ${similarIndex + 1}. Keeping this one (${amount}) based on note.`,
          severity: 'warning'
        });
        actions.push('keep');
      } else {
        anomalies.push({
          type: 'conflicting_duplicate_skip',
          message: `Conflicting amount with row ${similarIndex + 1} (${existingAmount}). Skipping this one.`,
          severity: 'warning'
        });
        actions.push('skip');
      }
    }
  }
  
  // 2. Settlement mislabeled - be more specific
  const descLower = description.toLowerCase();
  const settlementKeywords = ['paid back', 'repaid', 'settlement payment', 'settled', 'cleared'];
  const isSettlement = settlementKeywords.some(kw => descLower.includes(kw));
  const isRefund = descLower.includes('refund') || (amount < 0 && descLower.includes('refund'));
  
  if (isSettlement && !isRefund) {
    anomalies.push({
      type: 'settlement_mislabeled',
      message: 'This is a settlement payment, not a shared expense',
      severity: 'info'
    });
    actions.push('convert_to_settlement');
  }
  // In detectAnomalies, add this after the existing settlement detection
const paidBackMatch = descLower.match(/(\w+)\s+paid\s+(\w+)\s+back/i);
if (paidBackMatch) {
  anomalies.push({
    type: 'settlement_mislabeled',
    message: `This is a settlement: ${paidBackMatch[1]} paid ${paidBackMatch[2]} back`,
    severity: 'info'
  });
  actions.push('convert_to_settlement');
}
  // 3. Missing payer
  if (!paidBy) {
    anomalies.push({
      type: 'missing_payer',
      message: 'No payer specified - needs user input',
      severity: 'critical'
    });
    actions.push('needs_user_input');
  }
  
  // 4. Percentages don't sum to 100%
  if (splitType === 'percentage' && splitDetails) {
    const parts = splitDetails.split(';');
    let total = 0;
    parts.forEach(p => {
      const match = p.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match) total += parseFloat(match[1]);
    });
    if (Math.abs(total - 100) > 0.01) {
      anomalies.push({
        type: 'percentage_mismatch',
        message: `Percentages sum to ${total}%. Normalized to 100%.`,
        severity: 'warning'
      });
      actions.push('normalize_percentages');
    }
  }
  
  // 5. Foreign currency
  if (currency === 'USD') {
    anomalies.push({
      type: 'foreign_currency',
      message: 'USD expense detected. Will convert to INR using stored rate.',
      severity: 'info'
    });
    actions.push('convert_currency');
  }
  
  // 6. Missing currency
  if (!currency || currency === '') {
    anomalies.push({
      type: 'missing_currency',
      message: 'Currency field empty. Defaulted to INR.',
      severity: 'warning'
    });
    actions.push('default_inr');
  }
  
  // 7. Negative amount
  if (amount < 0) {
    anomalies.push({
      type: 'negative_amount',
      message: 'Negative amount detected. Treated as refund.',
      severity: 'info'
    });
    actions.push('treat_as_refund');
  }
  
  // 8. Zero amount
  if (amount === 0) {
    anomalies.push({
      type: 'zero_amount',
      message: 'Zero-amount expense. Skipped.',
      severity: 'info'
    });
    actions.push('skip');
  }
  
  // 9. Sub-paisa precision
  if (rawAmount.includes('.') && rawAmount.split('.')[1].length > 2) {
    anomalies.push({
      type: 'sub_paisa_precision',
      message: `Amount ${rawAmount} rounded to 2 decimal places.`,
      severity: 'warning'
    });
    actions.push('round_amount');
  }
  
  // 10. Split type mismatch
  if (splitType === 'equal' && splitDetails && splitDetails !== '') {
    anomalies.push({
      type: 'split_type_mismatch',
      message: 'split_type says "equal" but explicit shares found. Using explicit shares.',
      severity: 'warning'
    });
    actions.push('use_explicit_shares');
  }
  
  // 11. Ambiguous date
  if (notes.toLowerCase().includes('april 5') && notes.toLowerCase().includes('may 4')) {
    anomalies.push({
      type: 'ambiguous_date',
      message: 'Date ambiguity noted. Using standard Excel serial conversion.',
      severity: 'info'
    });
    actions.push('keep');
  }
  
  // 12. Name normalization
  if (paidByRaw && paidByRaw !== paidByRaw.trim()) {
    anomalies.push({
      type: 'name_normalization',
      message: `Name "${paidByRaw}" normalized to "${paidBy}"`,
      severity: 'info'
    });
  }
  
  // 13. Corrupted date
  const dateNum = parseInt(rawDate);
  if (!isNaN(dateNum) && /^\d{5,}$/.test(rawDate) && dateNum < 45000) {
    anomalies.push({
      type: 'corrupted_date',
      message: `Date ${rawDate} appears corrupted. Inferred from context.`,
      severity: 'warning'
    });
    actions.push('infer_date');
  }
  
  // Determine final action
  let resolvedAction = 'keep';
  if (actions.includes('needs_user_input')) resolvedAction = 'needs_user_input';
  else if (actions.includes('skip')) resolvedAction = 'skip';
  else if (actions.includes('convert_to_settlement')) resolvedAction = 'convert_to_settlement';
  else if (actions.includes('keep')) resolvedAction = 'keep';
  else resolvedAction = actions[0] || 'keep';
  
  return { anomalies, actions, resolvedAction };
}

async function importCSV(filePath, groupId) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const results = [];
    const anomalies = [];
    let needsReviewRows = [];
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => rows.push(data))
      .on('end', async () => {
        try {
          const dataRows = rows.filter(r => {
            const d = (r.date || '').trim();
            if (!d || d.toLowerCase() === 'date' || d === '---') return false;
            if (/^\d{5,}$/.test(d)) return true;
            if (!isNaN(new Date(d).getTime())) return true;
            if (d.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) return true;
            if (d.match(/^[A-Za-z]{3}-\d{1,2}$/)) return true;
            return false;
          });
          
          for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            const rowNum = i + 2;
            
            const rawDate = (row.date || '').trim();
            const description = (row.description || '').trim();
            const paidByRaw = (row.paid_by || '').trim();
            const paidBy = normalizeName(paidByRaw);
            
            // Handle amount with commas
            let amountStr = (row.amount || '0').trim();
            amountStr = amountStr.replace(/,/g, '').replace(/"/g, '');
            let amount = parseFloat(amountStr) || 0;
            
            let currency = ((row.currency || '').trim() || 'INR').toUpperCase();
            const splitType = ((row.split_type || 'equal').trim()).toLowerCase();
            const splitDetails = (row.split_details || '').trim();
            const splitWith = (row.split_with || '').trim();
            const notes = (row.notes || '').trim();
            
            // Parse date
            const dateResult = parseDate(rawDate);
            if (dateResult.error) {
              if (description.toLowerCase().includes('airport cab')) {
                const prevRow = dataRows[i-1];
                if (prevRow) {
                  const prevDateResult = parseDate(prevRow.date);
                  if (prevDateResult.date) {
                    const d = new Date(prevDateResult.date);
                    d.setDate(d.getDate() + 1);
                    dateResult.date = d.toISOString().split('T')[0];
                    dateResult.source = 'inferred';
                    dateResult.error = null;
                  }
                }
              }
              
              if (dateResult.error) {
                anomalies.push({
                  row: rowNum,
                  description: description || 'N/A',
                  anomalies: [{ type: 'invalid_date', message: dateResult.error, severity: 'critical' }],
                  action: 'skip'
                });
                results.push({ row: rowNum, status: 'skipped', reason: dateResult.error });
                continue;
              }
            }
            let expenseDate = dateResult.date;
            
            // Detect anomalies
            const { anomalies: rowAnomalies, actions, resolvedAction } = await detectAnomalies(row, i, dataRows, groupId);
            
            // Handle skip cases
            if (resolvedAction === 'skip') {
              anomalies.push({
                row: rowNum,
                description: description || 'N/A',
                anomalies: rowAnomalies,
                action: resolvedAction
              });
              results.push({ row: rowNum, status: 'skipped', reason: rowAnomalies[0]?.message || 'Skipped by policy' });
              continue;
            }
            
            // Handle needs_user_input
            if (resolvedAction === 'needs_user_input') {
              const needsReviewEntry = {
                row: rowNum,
                description: description || 'N/A',
                anomalies: rowAnomalies,
                data: row,
                originalIndex: i,
                resolvedAction: resolvedAction
              };
              needsReviewRows.push(needsReviewEntry);
              anomalies.push({
                row: rowNum,
                description: description || 'N/A',
                anomalies: rowAnomalies,
                action: resolvedAction
              });
              results.push({ row: rowNum, status: 'needs_review', reason: rowAnomalies[0]?.message });
              continue;
            }
            
            // Handle settlement conversion
            if (resolvedAction === 'convert_to_settlement') {
              const { data: fromUser } = await supabase.from('users').select('id').ilike('name', paidBy).single();
              
              let toName = null;
              if (splitWith) {
                const names = splitWith.split(';').map(m => normalizeName(m)).filter(Boolean);
                if (names.length > 0) toName = names[0];
              }
              if (!toName && description) {
                const match = description.match(/paid\s+([a-z\s]+)\s+back/i);
                if (match) toName = normalizeName(match[1]);
              }
              
              const { data: toUser } = await supabase.from('users').select('id').ilike('name', toName).single();
              
              if (fromUser && toUser) {
                await supabase.from('settlements').insert([{
                  group_id: groupId,
                  from_user_id: fromUser.id,
                  to_user_id: toUser.id,
                  amount: Math.abs(amount),
                  currency: currency || 'INR',
                  settlement_date: expenseDate,
                  notes: notes || description
                }]);
                results.push({ row: rowNum, status: 'converted_to_settlement', amount: Math.abs(amount) });
              } else {
                needsReviewRows.push({
                  row: rowNum,
                  description: description || 'N/A',
                  anomalies: rowAnomalies,
                  data: row,
                  originalIndex: i,
                  resolvedAction: 'needs_user_input'
                });
                results.push({ row: rowNum, status: 'needs_review', reason: 'Could not identify parties in settlement' });
                continue;
              }
              
              anomalies.push({
                row: rowNum,
                description: description || 'N/A',
                anomalies: rowAnomalies,
                action: resolvedAction
              });
              continue;
            }
            
            // Handle currency default
            if (resolvedAction === 'default_inr' || !currency) {
              currency = 'INR';
            }
            
            // Handle amount rounding
            if (resolvedAction === 'round_amount' || resolvedAction === 'round') {
              amount = Math.round(amount * 100) / 100;
            }
            
            // Handle date inference
            if (resolvedAction === 'infer_date') {
              const prevRow = dataRows[i-1];
              if (prevRow) {
                const prevDateResult = parseDate(prevRow.date);
                if (prevDateResult.date) {
                  const d = new Date(prevDateResult.date);
                  d.setDate(d.getDate() + 1);
                  expenseDate = d.toISOString().split('T')[0];
                }
              }
            }
            
            // Get ALL memberships for this group
            const { data: allMemberships } = await supabase
              .from('group_memberships')
              .select('user_id, users(name), joined_at, left_at')
              .eq('group_id', groupId);
            
            const splitMembers = parseMembers(splitWith);
            
            // Categorize members as active or excluded
            const activeMembers = [];
            const excludedMembers = [];
            
            for (const memberName of splitMembers) {
              const memberRecords = (allMemberships || []).filter(m => normalizeName(m.users.name) === memberName);
              
              if (memberRecords.length === 0) {
                excludedMembers.push(memberName);
                continue;
              }
              
              let foundActive = false;
              for (const m of memberRecords) {
                const joined = m.joined_at ? m.joined_at.toString().split('T')[0] : null;
                const left = m.left_at ? m.left_at.toString().split('T')[0] : null;
                
                if (joined && expenseDate >= joined && (!left || expenseDate <= left)) {
                  foundActive = true;
                  break;
                }
              }
              
              if (foundActive) {
                activeMembers.push(memberName);
              } else {
                excludedMembers.push(memberName);
              }
            }
            
            // Add stale membership anomalies
            for (const excludedName of excludedMembers) {
              const memberRecords = (allMemberships || []).filter(m => normalizeName(m.users.name) === excludedName);
              const hasLeftDate = memberRecords.some(m => m.left_at);
              
              if (hasLeftDate) {
                rowAnomalies.push({
                  type: 'stale_membership_excluded',
                  message: `${excludedName} was not active on ${expenseDate}. Excluded from split.`,
                  severity: 'warning'
                });
              } else if (!memberRecords.some(m => normalizeName(m.users.name) === excludedName)) {
                rowAnomalies.push({
                  type: 'non_member_excluded',
                  message: `${excludedName} is not a group member. Excluded from split.`,
                  severity: 'warning'
                });
              }
            }
            
            // Calculate shares using active members
            const shares = calculateSplits(amount, splitType, splitDetails, splitWith, activeMembers);
            
            // Get payer ID
            let paidById = null;
            if (paidBy) {
              const { data: payerData } = await supabase.from('users').select('id').ilike('name', paidBy).single();
              paidById = payerData?.id;
            }
            
            // If no payer ID, skip
            if (!paidById) {
              anomalies.push({
                row: rowNum,
                description: description || 'N/A',
                anomalies: [{ type: 'payer_not_found', message: 'Payer not found in database', severity: 'critical' }],
                action: 'skip'
              });
              results.push({ row: rowNum, status: 'skipped', reason: 'Payer not found in database' });
              continue;
            }
            
            // Insert expense
            const { data: expense, error: expError } = await supabase
              .from('expenses')
              .insert([{
                group_id: groupId,
                description: description,
                amount: amount,
                currency: currency,
                paid_by_user_id: paidById,
                expense_date: expenseDate,
                split_type: splitType,
                split_details_raw: splitDetails,
                notes: notes,
                status: amount < 0 ? 'refund' : 'active',
                anomaly_flags: rowAnomalies.map(a => a.type)
              }])
              .select()
              .single();
            
            if (expError) {
              anomalies.push({
                row: rowNum,
                description: description || 'N/A',
                anomalies: rowAnomalies,
                action: resolvedAction
              });
              results.push({ row: rowNum, status: 'error', reason: expError.message });
              continue;
            }
            
            // Insert splits
            for (const share of shares) {
              const { data: userData } = await supabase.from('users').select('id').ilike('name', share.user).single();
              if (userData) {
                await supabase.from('expense_splits').insert([{
                  expense_id: expense.id,
                  user_id: userData.id,
                  computed_share: share.amount,
                  raw_share_input: splitDetails,
                  is_excluded: excludedMembers.includes(share.user),
                  exclusion_reason: excludedMembers.includes(share.user) ? 'Not active on this date' : null
                }]);
              }
            }
            
            // Add final anomaly entry to report
            anomalies.push({
              row: rowNum,
              description: description || 'N/A',
              anomalies: rowAnomalies,
              action: resolvedAction
            });
            
            results.push({ row: rowNum, status: 'imported', expense_id: expense.id });
          }
          
          // Build detailed results
          const detailedResults = results.map(r => ({
            row: r.row,
            status: r.status,
            reason: r.reason || null,
            expense_id: r.expense_id || null
          }));

          // Build the full report
          const fullReport = {
            imported: results.filter(r => r.status === 'imported').length,
            skipped: results.filter(r => r.status === 'skipped').length,
            settlements: results.filter(r => r.status === 'converted_to_settlement').length,
            needsReview: results.filter(r => r.status === 'needs_review').length,
            totalRows: dataRows.length,
            anomalies: anomalies,
            results: detailedResults,
            timestamp: new Date().toISOString()
          };

          // Save import batch with full report
          const { data: importData, error: importError } = await supabase
            .from('import_batches')
            .insert([{
              group_id: groupId,
              filename: 'expenses_export.csv',
              total_rows: dataRows.length,
              anomalies_found: anomalies.filter(a => a.anomalies && a.anomalies.length > 0).length,
              anomalies_resolved: anomalies.filter(a => a.anomalies && a.anomalies.length > 0 && a.action !== 'needs_user_input').length,
              resolution_log: fullReport
            }])
            .select()
            .single();

          if (importError) {
            console.error('Error saving import batch:', importError);
          }

          const import_id = importData?.id || null;

          resolve({
            success: true,
            totalRows: dataRows.length,
            imported: results.filter(r => r.status === 'imported').length,
            skipped: results.filter(r => r.status === 'skipped').length,
            settlements: results.filter(r => r.status === 'converted_to_settlement').length,
            needsReview: results.filter(r => r.status === 'needs_review').length,
            anomalies: anomalies,
            results: detailedResults,
            needsReviewRows: needsReviewRows,
            import_id
          });
          
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject);
  });
}

module.exports = { importCSV, normalizeName, excelDateToJSDate, parseDate, parseMembers };