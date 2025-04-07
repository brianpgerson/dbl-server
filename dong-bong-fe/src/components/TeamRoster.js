import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../TeamRoster.css';

const TeamRoster = ({ team }) => {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    setLoading(true);
    axios.get(`${process.env.REACT_APP_API_URL}/api/team/${team.id}/roster-with-hrs`)
      .then(response => {
        setRoster(response.data);
        setLoading(false);
        setError(null);
      })
      .catch(error => {
        console.error('Error fetching roster:', error);
        setError('Failed to load roster data');
        setLoading(false);
      });
  }, [team.id]);
  
  if (loading) return <div className="team-roster-loading">Loading roster data...</div>;
  if (error) return <div className="team-roster-error">{error}</div>;
  
  return (
    <div className="team-roster">
      <h3>{team.name}</h3>
      <div className="team-roster-manager">Manager: {team.manager_name}</div>
      
      <table className="roster-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Position</th>
            <th>HR</th>
          </tr>
        </thead>
        <tbody>
          {roster.map(player => (
            <tr key={player.player_id} className={player.status === 'BENCH' ? 'bench-player' : ''}>
              <td>{player.name}</td>
              <td>{player.position}</td>
              <td>{player.hr_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TeamRoster;