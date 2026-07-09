import React from 'react';

const BalanceSummary = ({ balances }) => {
  if (!balances) {
    return <div className="loading-state">Loading balances...</div>;
  }

  return (
    <div>
      <div className="balance-grid">
        {balances.balances?.map((b) => (
          <div key={b.userId} className={`balance-card ${b.status}`}>
            <div className="name">{b.name}</div>
            <div className="amount">{b.net > 0 ? '+' : ''}{b.net.toFixed(2)}</div>
            <div className="status">
              {b.status === 'owed' ? 'is owed money' : 
               b.status === 'owes' ? 'owes money' : 
               'all settled'}
            </div>
          </div>
        ))}
      </div>

      <div className="settlement-section">
        <h3 className="section-title">Who Pays Whom</h3>
        {balances.settlements?.length > 0 ? (
          <ul className="settlement-list">
            {balances.settlements.map((s, i) => (
              <li key={i}>
                <span>
                  <span className="from">{s.from}</span> 
                  <span className="arrow"> → </span>
                  <span className="to">{s.to}</span>
                </span>
                <span className="amount">₹{s.amount.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">All settled!</p>
        )}
      </div>
    </div>
  );
};

export default BalanceSummary;