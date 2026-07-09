import React from 'react';

const ExpenseTable = ({ expenses }) => {
  if (!expenses || expenses.length === 0) {
    return (
      <div className="empty-state">
        <p>No expenses found. Import a CSV or add one manually.</p>
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Amount</th>
            <th>Paid By</th>
            <th>Split Type</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((exp) => (
            <tr key={exp.id}>
              <td>{exp.expense_date}</td>
              <td>{exp.description}</td>
              <td>{exp.currency} {exp.amount}</td>
              <td>{exp.paid_by?.name || 'Unknown'}</td>
              <td>{exp.split_type}</td>
              <td>
                <span className={`status-badge ${exp.status}`}>
                  {exp.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ExpenseTable;