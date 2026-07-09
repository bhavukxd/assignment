const supabase = require('./supabase');

// ============================================
// CURRENCY CONVERTER
// ============================================
async function convertToBase(amount, currency, date) {
  if (!currency || currency === '') {
    currency = 'INR';
  }
  
  if (currency === 'INR') return amount;
  
  try {
    const { data: rate } = await supabase
      .from('currency_rates')
      .select('rate')
      .eq('from_currency', currency)
      .eq('to_currency', 'INR')
      .lte('effective_date', date || new Date().toISOString().split('T')[0])
      .order('effective_date', { ascending: false })
      .limit(1)
      .single();
    
    const conversionRate = rate?.rate || 83;
    return parseFloat((amount * conversionRate).toFixed(2));
  } catch (err) {
    console.error(`Error converting ${currency} to INR:`, err.message);
    return amount * 83;
  }
}

// ============================================
// BALANCE CALCULATION
// ============================================
async function calculateBalances(groupId, asOfDate = new Date().toISOString().split('T')[0]) {
  try {
    const { data: expenses } = await supabase
      .from('expenses')
      .select('*, expense_splits(*, users(name))')
      .eq('group_id', groupId)
      .eq('status', 'active')
      .lte('expense_date', asOfDate);
    
    const { data: settlements } = await supabase
      .from('settlements')
      .select('*')
      .eq('group_id', groupId)
      .lte('settlement_date', asOfDate);
    
    const { data: memberships } = await supabase
      .from('group_memberships')
      .select('*, users(id, name)')
      .eq('group_id', groupId);
    
    const balances = {};
    const memberNames = {};
    
    memberships.forEach(m => {
      balances[m.users.id] = 0;
      memberNames[m.users.id] = m.users.name;
    });
    
    for (const exp of (expenses || [])) {
      const baseAmount = await convertToBase(exp.amount, exp.currency, exp.expense_date);
      
      if (balances[exp.paid_by_user_id] !== undefined) {
        balances[exp.paid_by_user_id] += baseAmount;
      }
      
      for (const split of (exp.expense_splits || [])) {
        if (!split.is_excluded && balances[split.user_id] !== undefined) {
          balances[split.user_id] -= split.computed_share;
        }
      }
    }
    
    for (const s of (settlements || [])) {
      const baseAmount = await convertToBase(s.amount, s.currency, s.settlement_date);
      if (balances[s.from_user_id] !== undefined) {
        balances[s.from_user_id] -= baseAmount;
      }
      if (balances[s.to_user_id] !== undefined) {
        balances[s.to_user_id] += baseAmount;
      }
    }
    
    const debtors = [];
    const creditors = [];
    
    for (const [userId, balance] of Object.entries(balances)) {
      if (balance < -0.01) {
        debtors.push({ userId, name: memberNames[userId], amount: -balance });
      } else if (balance > 0.01) {
        creditors.push({ userId, name: memberNames[userId], amount: balance });
      }
    }
    
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);
    
    const transactions = [];
    
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      
      const amount = Math.min(debtor.amount, creditor.amount);
      
      if (amount > 0.01) {
        transactions.push({
          from: debtor.name,
          fromId: debtor.userId,
          to: creditor.name,
          toId: creditor.userId,
          amount: parseFloat(amount.toFixed(2))
        });
      }
      
      debtor.amount -= amount;
      creditor.amount -= amount;
      
      if (debtor.amount < 0.01) i++;
      if (creditor.amount < 0.01) j++;
    }
    
    return {
      balances: Object.entries(balances).map(([id, amount]) => ({
        userId: id,
        name: memberNames[id] || 'Unknown',
        net: parseFloat(amount.toFixed(2)),
        status: amount > 0.01 ? 'owed' : amount < -0.01 ? 'owes' : 'settled'
      })),
      settlements: transactions,
      totalOwed: parseFloat(creditors.reduce((sum, c) => sum + c.amount, 0).toFixed(2)),
      totalDebt: parseFloat(debtors.reduce((sum, d) => sum + d.amount, 0).toFixed(2))
    };
  } catch (err) {
    console.error('Error calculating balances:', err);
    throw err;
  }
}

// ============================================
// ITEMIZED BREAKDOWN
// ============================================
async function getItemizedBreakdown(userId, groupId) {
  const { data: expenses } = await supabase
    .from('expenses')
    .select('*, expense_splits(*, users(name)), paid_by:paid_by_user_id(name)')
    .eq('group_id', groupId)
    .eq('status', 'active');
  
  const items = [];
  
  for (const exp of (expenses || [])) {
    const userSplit = exp.expense_splits.find(s => s.user_id === userId);
    const isPayer = exp.paid_by_user_id === userId;
    
    if (userSplit || isPayer) {
      const totalAmount = await convertToBase(exp.amount, exp.currency, exp.expense_date);
      const paidAmount = isPayer ? totalAmount : 0;
      const shareAmount = userSplit && !userSplit.is_excluded ? userSplit.computed_share : 0;
      
      items.push({
        date: exp.expense_date,
        description: exp.description,
        totalAmount: totalAmount,
        currency: 'INR',
        youPaid: parseFloat(paidAmount.toFixed(2)),
        yourShare: parseFloat(shareAmount.toFixed(2)),
        net: parseFloat((paidAmount - shareAmount).toFixed(2))
      });
    }
  }
  
  return items;
}

module.exports = { calculateBalances, getItemizedBreakdown, convertToBase };