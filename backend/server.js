require('dotenv').config();
const express = require('express');
const cors = require('cors');
const supabase = require('./supabase');
const fs = require('fs');
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ============================================
// HEALTH CHECK
// ============================================
app.get('/', (req, res) => {
  res.json({ message: 'Splitwise API is running' });
});

// ============================================
// AUTH ROUTES
// ============================================
app.get('/api/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email')
      .order('name');
    
    if (error) throw error;
    res.json({ users: data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const bcrypt = require('bcryptjs');
    const password_hash = await bcrypt.hash(password, 10);
    
    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password_hash, name }])
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, user: { id: data.id, email: data.email, name: data.name } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !data) throw new Error('User not found');
    
    const valid = await bcrypt.compare(password, data.password_hash);
    if (!valid) throw new Error('Invalid password');
    
    const token = jwt.sign({ userId: data.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
      success: true, 
      token, 
      user: { id: data.id, email: data.email, name: data.name } 
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// GROUPS ROUTES
// ============================================
app.post('/api/groups', async (req, res) => {
  try {
    const { name, created_by, members } = req.body;
    
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .insert([{ name, created_by }])
      .select()
      .single();
    
    if (groupError) throw groupError;
    
    const memberships = members.map(m => ({
      group_id: group.id,
      user_id: m.user_id,
      joined_at: m.joined_at,
      left_at: m.left_at || null,
      membership_type: m.membership_type || 'resident'
    }));
    
    const { error: memError } = await supabase
      .from('group_memberships')
      .insert(memberships);
    
    if (memError) throw memError;
    
    res.json({ success: true, group });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: group, error: gErr } = await supabase
      .from('groups')
      .select('*')
      .eq('id', id)
      .single();
    
    if (gErr) throw gErr;
    
    const { data: members, error: mErr } = await supabase
      .from('group_memberships')
      .select('*, users(name, email)')
      .eq('group_id', id);
    
    if (mErr) throw mErr;
    
    res.json({ group, members });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const { importCSV } = require('./importer');
const { calculateBalances, getItemizedBreakdown } = require('./balance');

// ============================================
// EXPENSE ROUTES
// ============================================
app.post('/api/expenses', async (req, res) => {
  try {
    const { group_id, description, amount, currency, paid_by_user_id, expense_date, split_type, split_details, split_with, notes } = req.body;
    
    const { data: expense, error } = await supabase
      .from('expenses')
      .insert([{ group_id, description, amount, currency, paid_by_user_id, expense_date, split_type, split_details_raw: split_details, notes }])
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, expense });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/groups/:groupId/expenses', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { data, error } = await supabase
      .from('expenses')
      .select('*, expense_splits(*, users(name)), paid_by:paid_by_user_id(name)')
      .eq('group_id', groupId)
      .order('expense_date', { ascending: false });
    
    if (error) throw error;
    res.json({ expenses: data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// BALANCE ROUTES
// ============================================
app.get('/api/groups/:groupId/balances', async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await calculateBalances(groupId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/groups/:groupId/breakdown/:userId', async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const items = await getItemizedBreakdown(userId, groupId);
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// IMPORT ROUTE
// ============================================
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/api/import', upload.single('csv'), async (req, res) => {
  try {
    const { groupId } = req.body;
    const filePath = req.file.path;
    
    const result = await importCSV(filePath, groupId);
    
    fs.unlinkSync(filePath);
    
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// REVIEW ROUTE - Resolve rows that need user input
// ============================================
app.post('/api/import/review', async (req, res) => {
  try {
    const { groupId, rowData, resolvedPayer } = req.body;
    
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .ilike('name', resolvedPayer)
      .single();
    
    if (!user) {
      throw new Error(`User "${resolvedPayer}" not found`);
    }
    
    const amount = parseFloat(rowData.amount) || 0;
    const expenseDate = rowData.date;
    
    const { data: expense, error } = await supabase
      .from('expenses')
      .insert([{
        group_id: groupId,
        description: rowData.description,
        amount: amount,
        currency: rowData.currency || 'INR',
        paid_by_user_id: user.id,
        expense_date: expenseDate,
        split_type: rowData.split_type || 'equal',
        split_details_raw: rowData.split_details || '',
        notes: rowData.notes || '',
        status: 'active'
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    // Create splits
    const splitWith = rowData.split_with || '';
    const splitMembers = splitWith.split(';').map(m => m.trim()).filter(Boolean);
    
    if (splitMembers.length > 0) {
      const perPerson = amount / splitMembers.length;
      for (const memberName of splitMembers) {
        const { data: memberUser } = await supabase
          .from('users')
          .select('id')
          .ilike('name', memberName)
          .single();
        
        if (memberUser) {
          await supabase.from('expense_splits').insert([{
            expense_id: expense.id,
            user_id: memberUser.id,
            computed_share: parseFloat(perPerson.toFixed(2)),
            raw_share_input: rowData.split_details || '',
            is_excluded: false,
            exclusion_reason: null
          }]);
        }
      }
    }
    
    res.json({ success: true, message: 'Expense created with payer', expense });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// CLEANUP ROUTE - Remove duplicates
// ============================================
app.post('/api/cleanup-duplicates', async (req, res) => {
  try {
    const { groupId } = req.body;
    
    const { data: expenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('group_id', groupId);
    
    const toDelete = [];
    const seen = new Set();
    
    for (const exp of expenses) {
      const key = `${exp.expense_date}|${exp.description.toLowerCase().trim()}`;
      if (seen.has(key)) {
        toDelete.push(exp.id);
      } else {
        seen.add(key);
      }
    }
    
    if (toDelete.length > 0) {
      await supabase
        .from('expenses')
        .delete()
        .in('id', toDelete);
    }
    
    res.json({ 
      success: true, 
      deleted: toDelete.length,
      message: `Removed ${toDelete.length} duplicate expenses`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// SETTLEMENT ROUTES
// ============================================
app.post('/api/settlements', async (req, res) => {
  try {
    const { group_id, from_user_id, to_user_id, amount, currency, settlement_date, notes } = req.body;
    
    const { data, error } = await supabase
      .from('settlements')
      .insert([{ group_id, from_user_id, to_user_id, amount, currency, settlement_date, notes }])
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, settlement: data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/groups/:groupId/settlements', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { data, error } = await supabase
      .from('settlements')
      .select('*, from:from_user_id(name), to:to_user_id(name)')
      .eq('group_id', groupId)
      .order('settlement_date', { ascending: false });
    
    if (error) throw error;
    res.json({ settlements: data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
// ============================================
// IMPORT REPORT DOWNLOAD
// ============================================

app.get('/api/imports/:id/report', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('import_batches')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    // Parse the resolution_log if it exists
    let resolutionLog = {};
    if (data.resolution_log) {
      // If it's a string, parse it; if it's already an object, use it
      resolutionLog = typeof data.resolution_log === 'string' 
        ? JSON.parse(data.resolution_log) 
        : data.resolution_log;
    }
    
    // Get the actual imported/skipped counts from the results
    const results = resolutionLog.results || [];
    const imported = results.filter(r => r.status === 'imported').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const settlements = results.filter(r => r.status === 'converted_to_settlement').length;
    const needsReview = results.filter(r => r.status === 'needs_review').length;
    
    // Get anomalies
    const anomalies = resolutionLog.anomalies || [];
    
    // Create CSV for download
    let csv = 'Import Report\n';
    csv += '='.repeat(50) + '\n\n';
    csv += `Import ID: ${data.id}\n`;
    csv += `Group ID: ${data.group_id}\n`;
    csv += `File: ${data.filename}\n`;
    csv += `Imported At: ${data.created_at}\n`;
    csv += `Total Rows: ${data.total_rows || 0}\n`;
    csv += `Imported: ${imported}\n`;
    csv += `Skipped: ${skipped}\n`;
    csv += `Settlements: ${settlements}\n`;
    csv += `Needs Review: ${needsReview}\n`;
    csv += `Anomalies Found: ${data.anomalies_found || 0}\n`;
    csv += `Anomalies Resolved: ${data.anomalies_resolved || 0}\n`;
    csv += `Success Rate: ${data.total_rows > 0 ? ((imported / data.total_rows) * 100).toFixed(1) : 0}%\n\n`;
    csv += '='.repeat(50) + '\n\n';
    
    // Add anomalies table
    csv += 'ANOMALIES FOUND:\n';
    csv += '-'.repeat(50) + '\n';
    csv += 'Row,Description,Anomaly Type,Action\n';
    
    if (anomalies && anomalies.length > 0) {
      const anomaliesWithIssues = anomalies.filter(a => a.anomalies && a.anomalies.length > 0);
      if (anomaliesWithIssues.length > 0) {
        anomaliesWithIssues.forEach(a => {
          const row = a.row || 'N/A';
          const desc = (a.description || 'N/A').replace(/,/g, ';').replace(/"/g, '""');
          const type = a.anomalies[0]?.type || 'N/A';
          const action = a.action || 'N/A';
          csv += `${row},"${desc}",${type},${action}\n`;
        });
      } else {
        csv += 'No anomalies found\n';
      }
    } else {
      csv += 'No anomalies found\n';
    }
    
    csv += '\n' + '='.repeat(50) + '\n\n';
    
    // Add detailed results
    csv += 'DETAILED RESULTS:\n';
    csv += '-'.repeat(50) + '\n';
    csv += 'Row,Status,Reason,Expense ID\n';
    
    if (results && results.length > 0) {
      results.forEach(r => {
        const row = r.row || 'N/A';
        const status = r.status || 'N/A';
        const reason = (r.reason || '').replace(/,/g, ';').replace(/"/g, '""');
        const expenseId = r.expense_id || 'N/A';
        csv += `${row},${status},"${reason}",${expenseId}\n`;
      });
    } else {
      // Try to get results from the resolution_log directly
      if (resolutionLog.results) {
        resolutionLog.results.forEach(r => {
          const row = r.row || 'N/A';
          const status = r.status || 'N/A';
          const reason = (r.reason || '').replace(/,/g, ';').replace(/"/g, '""');
          const expenseId = r.expense_id || 'N/A';
          csv += `${row},${status},"${reason}",${expenseId}\n`;
        });
      }
    }
    
    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=import-report-${data.id.slice(0, 8)}.csv`);
    res.send(csv);
    
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(400).json({ error: err.message });
  }
});
const path = require('path');

// Serve React build files
app.use(express.static(path.join(__dirname, '../frontend/build')));

// For any route not handled by API, serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
});
// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// ============================================
// IMPORT DEBUG ENDPOINT
// ============================================
app.get('/api/imports/:id/debug', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('import_batches')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    // Parse resolution_log if needed
    let resolutionLog = data.resolution_log;
    if (typeof resolutionLog === 'string') {
      try {
        resolutionLog = JSON.parse(resolutionLog);
      } catch (e) {
        // leave as string if parse fails
      }
    }

    res.json({
      import: data,
      parsed_log: resolutionLog,
      imported_count: resolutionLog?.results?.filter(r => r.status === 'imported').length || 0,
      skipped_count: resolutionLog?.results?.filter(r => r.status === 'skipped').length || 0,
      settlements_count: resolutionLog?.results?.filter(r => r.status === 'converted_to_settlement').length || 0
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});