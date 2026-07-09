import React from 'react';

const GroupCard = ({ group }) => {
  if (!group) {
    return (
      <div className="group-card empty">
        <p>No group selected</p>
      </div>
    );
  }

  return (
    <div className="group-card">
      <div className="group-header">
        <h3>{group.name}</h3>
        <span className="group-id">ID: {group.id?.slice(0, 8)}</span>
      </div>
      
      <div className="group-members">
        <h4>Members</h4>
        <div className="member-list">
          {group.members?.map((member) => (
            <span key={member.user_id} className="member-tag">
              {member.users?.name}
            </span>
          ))}
        </div>
      </div>

      <div className="group-stats">
        <div className="stat">
          <span className="stat-value">{group.members?.length || 0}</span>
          <span className="stat-label">Members</span>
        </div>
        <div className="stat">
          <span className="stat-value">{group.base_currency || 'INR'}</span>
          <span className="stat-label">Currency</span>
        </div>
      </div>
    </div>
  );
};

export default GroupCard;