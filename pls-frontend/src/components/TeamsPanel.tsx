import { useState } from 'react';
import { createTeam, updateTeam, type Patient, type Team } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';

type TeamChange = Partial<Pick<Team, 'status' | 'assignedPatientId' | 'assignedLocation' | 'contactInfo'>>;

const STATUS_LABEL: Record<string, string> = { free: 'frei', busy: 'im Einsatz', unavailable: 'nicht verfügbar' };

interface Props {
  sceneId: number;
  teams: Team[];
  patients: Patient[];
  /** Leitstelle and Admin create teams; every role may update them (WP 5.2). */
  canCreate: boolean;
  onSaved: (team: Team) => void;
}

export default function TeamsPanel({ sceneId, teams, patients, canCreate, onSaved }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const save = async (team: Team, change: TeamChange) => {
    setError('');
    try {
      const { data } = await updateTeam(team.id, change);
      onSaved(data);
    } catch (cause) {
      setError(apiErrorMessage(cause, `Team ${team.name} konnte nicht gespeichert werden.`));
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const { data } = await createTeam(sceneId, name.trim());
      onSaved(data);
      setName('');
    } catch (cause) {
      setError(apiErrorMessage(cause, 'Team konnte nicht angelegt werden.'));
    }
  };

  // Free-text fields save when the field is left, not on every keystroke.
  const text = (team: Team, field: 'assignedLocation' | 'contactInfo', label: string) => (
    <input
      aria-label={`${label} ${team.name}`}
      defaultValue={team[field] ?? ''}
      key={`${team.id}-${field}-${team[field] ?? ''}`}
      onBlur={(e) => {
        const value = e.target.value.trim() || null;
        if (value !== (team[field] ?? null)) void save(team, { [field]: value });
      }}
    />
  );

  return (
    <section aria-label="Teams" style={{ margin: '12px 15px', textAlign: 'left' }}>
      <h3>Teams</h3>
      {error && <p className="msg-error" role="alert">{error}</p>}
      {teams.length === 0 ? (
        <p>Keine Teams.</p>
      ) : (
        <table border={1}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Status</th>
              <th>Patient:In</th>
              <th>Ort</th>
              <th>Kontakt</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id}>
                <td>{team.name}</td>
                <td>
                  <select aria-label={`Status ${team.name}`} value={team.status ?? ''} onChange={(e) => void save(team, { status: (e.target.value || null) as Team['status'] })}>
                    <option value="">–</option>
                    {Object.entries(STATUS_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={`Patient:In ${team.name}`}
                    value={team.assignedPatientId ?? ''}
                    onChange={(e) => void save(team, { assignedPatientId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">–</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.id}
                        {patient.humanReadableId ? ` (${patient.humanReadableId})` : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{text(team, 'assignedLocation', 'Ort')}</td>
                <td>{text(team, 'contactInfo', 'Kontakt')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canCreate && (
        <form onSubmit={(e) => void handleCreate(e)} style={{ marginTop: '8px' }}>
          <label htmlFor="new-team-name">Neues Team (Name oder Funkrufname) </label>
          <input id="new-team-name" value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit" disabled={!name.trim()}>Team anlegen</button>
        </form>
      )}
    </section>
  );
}
