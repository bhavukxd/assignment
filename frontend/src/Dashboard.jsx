import React, { useState, useEffect } from 'react';
import { ExpenseTable, BalanceSummary, ImportModal, GroupCard } from './components';
import api from './api';

function Dashboard() {
  const [activeTab, setActiveTab] = useState('expenses');
  const [expenses, setExpenses] = useState([]);
  const [balances, setBalances] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [users, setUsers] = useState([]); // NEW: Store users

  const groupId = '85f4a540-38f5-4e0e-98b8-aa3ff8f260ce';

  // NEW: Fetch users on component mount
  useEffect(() => {
    fetchUsers();
  }, []);

  // NEW: Fetch expenses/balances when tab changes
  useEffect(() => {
    if (activeTab === 'expenses') fetchExpenses();
    if (activeTab === 'balances') fetchBalances();
  }, [activeTab]);

  // NEW: Function to fetch users
  const fetchUsers = async () => {
    try {
      const res = await api.get('/api/users');
      setUsers(res.data.users || []);
    } catch (err) {
      setMessage('Error fetching users');
      setMessageType('error');
    }
  };

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/groups/${groupId}/expenses`);
      setExpenses(res.data.expenses || []);
    } catch (err) {
      setMessage('Error fetching expenses');
      setMessageType('error');
    }
    setLoading(false);
  };

  const fetchBalances = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/groups/${groupId}/balances`);
      setBalances(res.data);
    } catch (err) {
      setMessage('Error fetching balances');
      setMessageType('error');
    }
    setLoading(false);
  };

  const handleCleanupDuplicates = async () => {
    try {
      const res = await api.post('/api/cleanup-duplicates', { groupId });
      setMessage(res.data.message);
      setMessageType('success');
      fetchExpenses();
    } catch (err) {
      setMessage('Error cleaning up duplicates: ' + (err.response?.data?.error || err.message));
      setMessageType('error');
    }
  };

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>💰 Splitwise <span>v1.0</span></h1>
        <div className="header-user">
          <span className="user-name">👋 {user.name || 'User'}</span>
          <button className="btn-logout" onClick={() => { localStorage.clear(); window.location.href = '/login'; }}>
            Logout
          </button>
        </div>
      </header>

      <div className="tabs">
        {['expenses', 'balances', 'import', 'add-expense', 'settlement'].map(tab => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'add-expense' ? '➕ Add Expense' : 
             tab === 'settlement' ? '💳 Record Payment' : 
             tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {message && <div className={`message ${messageType}`}>{message}</div>}
      {loading && <div className="loading-state">⏳ Loading...</div>}

      {activeTab === 'expenses' && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">📊 Expenses</h2>
            <button className="btn btn-danger" onClick={handleCleanupDuplicates}>
              🧹 Clean Up Duplicates
            </button>
          </div>
          <ExpenseTable expenses={expenses} />
        </div>
      )}

      {activeTab === 'balances' && (
        <div className="card">
          <h2 className="card-title">💰 Balance Summary</h2>
          <BalanceSummary balances={balances} />
        </div>
      )}

      {activeTab === 'import' && (
        <div className="card">
          <h2 className="card-title">📥 Import CSV</h2>
          <p style={{ color: '#6c757d', marginBottom: 16 }}>
            Upload the <code>expenses_export.csv</code> file. The app will detect anomalies and show you a report.
          </p>
          
          <button className="btn btn-success" onClick={() => setShowImportModal(true)}>
            ⬆️ Open Import Modal
          </button>

          <ImportModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            onImportComplete={(result) => {
              setMessage(`Import complete! Imported: ${result.imported}, Skipped: ${result.skipped}, Settlements: ${result.settlements}`);
              setMessageType('success');
              fetchExpenses();
            }}
            groupId={groupId}
          />
        </div>
      )}

      {activeTab === 'add-expense' && (
        <div className="card">
          <h2 className="card-title">➕ Add Expense</h2>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const form = e.target;
            const data = {
              group_id: groupId,
              description: form.description.value,
              amount: parseFloat(form.amount.value),
              currency: form.currency.value,
              paid_by_user_id: form.paid_by.value, // Now this is a UUID
              expense_date: form.date.value,
              split_type: form.split_type.value,
              split_details: form.split_details.value,
              split_with: form.split_with.value,
              notes: form.notes.value
            };

            try {
              await api.post('/api/expenses', data);
              setMessage('✅ Expense added!');
              setMessageType('success');
              form.reset();
              fetchExpenses();
            } catch (err) {
              setMessage('Error: ' + (err.response?.data?.error || err.message));
              setMessageType('error');
            }
          }}>
            <div className="form-group">
              <label>Description</label>
              <input name="description" placeholder="e.g., Dinner at restaurant" required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Amount</label>
                <input name="amount" type="number" step="0.01" placeholder="0.00" required />
              </div>
              <div className="form-group">
                <label>Currency</label>
                <select name="currency" defaultValue="INR">
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Paid By</label>
              <select name="paid_by" required>
                <option value="">Select who paid...</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input name="date" type="date" required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Split Type</label>
                <select name="split_type">
                  <option value="equal">Equal</option>
                  <option value="unequal">Unequal</option>
                  <option value="percentage">Percentage</option>
                  <option value="share">Share</option>
                </select>
              </div>
              <div className="form-group">
                <label>Split With (semicolon-separated names)</label>
                <input name="split_with" placeholder="Aisha;Rohan;Priya" />
              </div>
            </div>
            <div className="form-group">
              <label>Split Details</label>
              <input name="split_details" placeholder="Aisha 30%; Rohan 30%; Priya 40%" />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input name="notes" placeholder="Optional notes" />
            </div>
            <button type="submit" className="btn btn-primary">➕ Add Expense</button>
          </form>
        </div>
      )}

      {activeTab === 'settlement' && (
        <div className="card">
          <h2 className="card-title">💳 Record Payment</h2>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const form = e.target;
            const data = {
              group_id: groupId,
              from_user_id: form.from.value, // Now this is a UUID
              to_user_id: form.to.value, // Now this is a UUID
              amount: parseFloat(form.amount.value),
              currency: form.currency.value,
              settlement_date: form.date.value,
              notes: form.notes.value
            };

            try {
              await api.post('/api/settlements', data);
              setMessage('✅ Settlement recorded!');
              setMessageType('success');
              form.reset();
              fetchBalances();
            } catch (err) {
              setMessage('Error: ' + (err.response?.data?.error || err.message));
              setMessageType('error');
            }
          }}>
            <div className="form-row">
              <div className="form-group">
                <label>From (Payer)</label>
                <select name="from" required>
                  <option value="">Select payer...</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>To (Receiver)</label>
                <select name="to" required>
                  <option value="">Select receiver...</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Amount</label>
                <input name="amount" type="number" step="0.01" placeholder="0.00" required />
              </div>
              <div className="form-group">
                <label>Currency</label>
                <select name="currency" defaultValue="INR">
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input name="date" type="date" required />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input name="notes" placeholder="Optional notes" />
            </div>
            <button type="submit" className="btn btn-success">💳 Record Payment</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default Dashboard;