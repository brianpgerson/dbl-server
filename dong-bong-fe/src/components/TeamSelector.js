import React from 'react';
import '../TeamSelector.css';

const TeamSelector = ({ teams, selectedTeam, onSelectTeam }) => {
  return (
    <div className="team-selector">
      <h3>Teams</h3>
      <ul>
        <li 
          className={selectedTeam === null ? 'selected' : ''}
          onClick={() => onSelectTeam(null)}>
          All Teams
        </li>
        {teams.map(team => (
          <li 
            key={team.id}
            className={selectedTeam?.id === team.id ? 'selected' : ''}
            onClick={() => onSelectTeam(team)}>
            {team.name}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TeamSelector;