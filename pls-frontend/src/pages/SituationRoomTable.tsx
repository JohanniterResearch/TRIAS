import { useEffect, useState } from 'react';
import { getBodyParts } from '../api/endpoints';
import { useSceneLive, type ReceivedBodyParts } from '../hooks/useSceneLive';
import LiveStatus from '../components/LiveStatus';
import TeamsPanel from '../components/TeamsPanel';
import BodyMapDrawing from '../components/BodyMapDrawing';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import '../styles/MarkerStyles.css';
import type { Patient } from '../types';
import { apiErrorMessage } from '../api/client';
import { decodeTriageColor } from '../api/codecs/triage';
import { useWorkContextStore } from '../stores/workContextStore';
import { isLeitstelleOrAdmin, useAuthStore } from '../stores/authStore';
import TriageHistoryPanel from '../components/TriageHistoryPanel';
import { isTriageColor, TRIAGE_COLORS, TRIAGE_COLOR_BACKGROUND, type TriageColor } from '../types/triageColor';

type TriageDisplay =
  | { kind: 'unassigned'; label: string; backgroundColor: string; textColor: string; border?: string }
  | { kind: 'valid'; label: string; canonical: TriageColor; backgroundColor: string; textColor: string; border?: string }
  | { kind: 'invalid'; label: string; backgroundColor: string; textColor: string; border: string };

function SituationRoomTable() {
  const navigate = useNavigate();
  const operationSceneId = useWorkContextStore((state) => state.operationSceneId);
  // Live scene state (WP 5.1): realtime while connected, polling every 10 s while not.
  const { patients: persons, teams, bodyParts: liveBodyParts, connection, loading: isLoading, error: loadError, applyTeam } = useSceneLive(operationSceneId);
  const [bodyMapPatient, setBodyMapPatient] = useState('');
  const [loadedBodyParts, setLoadedBodyParts] = useState<({ id: number } & ReceivedBodyParts) | null>(null);
  const [bodyMapError, setBodyMapError] = useState('');
  const setPatient = useWorkContextStore((state) => state.setPatient);
  const isStaff = useAuthStore((state) => isLeitstelleOrAdmin(state.session?.role));

  // Mean of the known positions. react-leaflet reads `center` only when the map mounts, which is
  // after the first list arrived, so live updates never move the map under the user.
  function mapCenterOf(personsList: Patient[]): [number, number] {
    const located = personsList.filter((person) => person.latitudePatient != null && person.longitudePatient != null);
    if (located.length === 0) return [48.2715, 16.403];
    return [
      located.reduce((sum, person) => sum + person.latitudePatient!, 0) / located.length,
      located.reduce((sum, person) => sum + person.longitudePatient!, 0) / located.length,
    ];
  }


  useEffect(() => {
    if (!bodyMapPatient) return;
    let active = true;
    getBodyParts(Number(bodyMapPatient))
      .then(({ data }) => active && setLoadedBodyParts({ id: Number(bodyMapPatient), regions: data.bodyParts, receivedAt: Date.now() }))
      .catch((error) => active && setBodyMapError(apiErrorMessage(error, 'Körperregionen konnten nicht geladen werden.')));
    return () => {
      active = false;
    };
  }, [bodyMapPatient]);
  // Whichever arrived last is shown: a push after the load, or a fresh load after an older push
  // (WP 5.4, security review 3 L3).
  const live = bodyMapPatient ? liveBodyParts[Number(bodyMapPatient)] : undefined;
  const loaded = bodyMapPatient && loadedBodyParts?.id === Number(bodyMapPatient) ? loadedBodyParts : undefined;
  const shownBodyParts = [live, loaded].filter((entry) => entry !== undefined).sort((a, b) => b.receivedAt - a.receivedAt)[0]?.regions ?? null;

  const getTriageDisplay = (triageColor: string | null | undefined): TriageDisplay => {
    const normalized = decodeTriageColor(triageColor);
    if (!normalized) {
      return {
        kind: 'unassigned',
        label: 'Keine Farbe',
        backgroundColor: 'white',
        textColor: 'black',
        border: '1px solid #ccc',
      };
    }

    if (isTriageColor(normalized)) {
      return {
        kind: 'valid',
        canonical: normalized,
        label: normalized,
        backgroundColor: TRIAGE_COLOR_BACKGROUND[normalized],
        textColor: normalized === 'gelb' ? 'black' : 'white',
      };
    }

    return {
      kind: 'invalid',
      label: `Ungültig: ${triageColor}`,
      backgroundColor: '#ff8c00',
      textColor: 'black',
      border: '2px solid #8a4b00',
    };
  };

  const createMarkerIcon = (color: string) =>
    L.divIcon({
      className: 'custom-div-icon',
      html: `<div style='background-color:${color};' class='marker-pin'></div>`,
      iconSize: [30, 42],
      iconAnchor: [15, 42],
    });

  // Teams are shown at the position of their assigned patient (WP 5.2).
  const renderTeamMarkers = () =>
    teams.map((team) => {
      const patient = persons.find((person) => person.id === team.assignedPatientId);
      if (patient?.latitudePatient == null || patient.longitudePatient == null) return null;
      return (
        <Marker key={`team-${team.id}`} position={[patient.latitudePatient, patient.longitudePatient]} icon={createMarkerIcon('#2b6cb0')}>
          <Popup>
            Team: {team.name}
            <br />
            bei Patient:In {patient.id}
          </Popup>
        </Marker>
      );
    });

  const renderMarkers = () =>
    persons.map((person) =>
      person.latitudePatient != null && person.longitudePatient != null ? (
        <Marker
          key={person.id}
          position={[person.latitudePatient, person.longitudePatient]}
          icon={createMarkerIcon(getTriageDisplay(person.triagefarbe).backgroundColor)}
        >
          <Popup>
            Nummer: {person.id}
            {person.humanReadableId ? ` (${person.humanReadableId})` : ''}
            <br />
            Kontaminiert: {person.kontaminiert ? 'Ja' : 'Nein'}
          </Popup>
        </Marker>
      ) : null
    );

  const openPage1 = (patientId: number) => {
    setPatient(patientId, persons.find((person) => person.id === patientId)?.humanReadableId ?? null);
    navigate(`/AmbulanzprotokollPage1/${patientId}`);
  };

  if (!operationSceneId) return <p role="alert">Bitte zuerst einen Einsatzort in der Rollenauswahl auswählen.</p>;
  if (isLoading) return <p role="status">Lädt...</p>;
  // A failed poll keeps the last picture on screen with a note (final review M4); only a scene
  // that could never be loaded shows the error alone.
  if (loadError && persons.length === 0 && teams.length === 0) return <p role="alert">{loadError}</p>;
  if (persons.length === 0) {
    return (
      <>
        <LiveStatus state={connection} />
        {loadError && <p role="status">{loadError}</p>}
        <p>Keine Personen gefunden.</p>
        <TeamsPanel sceneId={operationSceneId} teams={teams} patients={persons} canCreate={isStaff} onSaved={applyTeam} />
      </>
    );
  }

  const triageDisplays = persons.map((person) => ({
    person,
    triageDisplay: getTriageDisplay(person.triagefarbe),
  }));

  const colorCounts = TRIAGE_COLORS.reduce<Record<TriageColor, number>>((acc, color) => {
    acc[color] = triageDisplays.filter(({ triageDisplay }) => triageDisplay.kind === 'valid'
      && triageDisplay.canonical === color).length;
    return acc;
  }, { rot: 0, gelb: 0, grün: 0, schwarz: 0 });
  const unassigned = triageDisplays.filter(({ triageDisplay }) => triageDisplay.kind === 'unassigned').length;
  const invalid = triageDisplays.filter(({ triageDisplay }) => triageDisplay.kind === 'invalid').length;

  const badgeTextColor: Record<TriageColor, string> = {
    rot: 'white',
    gelb: 'black',
    grün: 'white',
    schwarz: 'white',
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '20%',
        left: '0',
        width: '100%',
        textAlign: 'center',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <LiveStatus state={connection} />
      {loadError && <p role="status">Letzter Stand wird angezeigt: {loadError}</p>}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', margin: '12px 0' }}>
        {TRIAGE_COLORS.map((color) =>
          colorCounts[color] > 0 ? (
            <span
              key={color}
              style={{
                backgroundColor: TRIAGE_COLOR_BACKGROUND[color],
                color: badgeTextColor[color],
                padding: '6px 14px',
                borderRadius: '4px',
                fontWeight: 'bold',
                fontSize: '1rem',
              }}
            >
              {colorCounts[color]} {color.charAt(0).toUpperCase() + color.slice(1)}
            </span>
          ) : null
        )}
        {unassigned > 0 && (
          <span
            style={{
              backgroundColor: 'white',
              color: 'black',
              padding: '6px 14px',
              borderRadius: '4px',
              fontWeight: 'bold',
              fontSize: '1rem',
              border: '1px solid #ccc',
            }}
          >
            {unassigned} Keine Farbe
          </span>
        )}
        {invalid > 0 && (
          <span
            style={{
              backgroundColor: '#ff8c00',
              color: 'black',
              padding: '6px 14px',
              borderRadius: '4px',
              fontWeight: 'bold',
              fontSize: '1rem',
              border: '2px solid #8a4b00',
            }}
          >
            {invalid} Ungültig
          </span>
        )}
      </div>
      <div>
        <table border={1} style={{ margin: 15 }}>
          <thead>
            <tr>
              <th>Nummer</th>
              <th>Atmung</th>
              <th>Blutung</th>
              <th>Triagefarbe</th>
              <th>Transport</th>
              <th>Dringend</th>
              <th>Name</th>
              <th>Position (Longitude)</th>
              <th>Position (Latitude)</th>
              <th>Erfasst</th>
              <th>Letztes Update</th>
            </tr>
          </thead>
          <tbody>
            {triageDisplays.map(({ person, triageDisplay }) => (
              // The row stays a table row (its cells remain readable); the button in the first cell
              // opens the protocol from the keyboard, a click anywhere on the row with the mouse.
              <tr key={person.id} onClick={() => openPage1(person.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <button
                    type="button"
                    className="admin-text"
                    aria-label={`Ambulanzprotokoll für Patient ${person.id} öffnen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openPage1(person.id);
                    }}
                  >
                    {person.id}
                    {person.humanReadableId ? ` (${person.humanReadableId})` : ''}
                  </button>
                </td>
                <td>{person.atmung ? 'Ja' : 'Nein'}</td>
                <td>{person.blutung ? 'Ja' : 'Nein'}</td>
                <td>
                  <div
                    style={{
                      backgroundColor: triageDisplay.backgroundColor,
                      color: triageDisplay.textColor,
                      border: triageDisplay.border,
                    }}
                  >
                    {triageDisplay.label}
                  </div>
                </td>
                <td>{person.transport ? 'Ja' : 'Nein'}</td>
                <td>{person.dringend ? 'Ja' : 'Nein'}</td>
                <td>{person.name || 'N/A'}</td>
                <td>{person.longitudePatient || 'N/A'}</td>
                <td>{person.latitudePatient || 'N/A'}</td>
                <td>{person.createdAt}</td>
                <td>{person.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isStaff && <TriageHistoryPanel persons={persons} />}
      <TeamsPanel sceneId={operationSceneId} teams={teams} patients={persons} canCreate={isStaff} onSaved={applyTeam} />
      <section aria-label="Körperregionen" style={{ margin: '12px 15px', textAlign: 'left' }}>
        <label htmlFor="body-map-patient">Körperregionen für Patient:In </label>
        <select
          id="body-map-patient"
          value={bodyMapPatient}
          onChange={(e) => {
            setBodyMapError('');
            setBodyMapPatient(e.target.value);
          }}
        >
          <option value="">auswählen</option>
          {persons.map((person) => (
            <option key={person.id} value={person.id}>
              {person.id}
              {person.humanReadableId ? ` (${person.humanReadableId})` : ''}
            </option>
          ))}
        </select>
        {bodyMapError && <p className="msg-error" role="alert">{bodyMapError}</p>}
        {shownBodyParts && <BodyMapDrawing server={shownBodyParts} label={`Körperregionen Patient ${bodyMapPatient}`} />}
      </section>
      <div style={{ height: '400px', width: '100%' }}>
        <MapContainer
          center={mapCenterOf(persons)}
          zoom={13}
          style={{ flex: 1, height: '300px', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {renderMarkers()}
          {renderTeamMarkers()}
        </MapContainer>
      </div>
    </div>
  );
}

export default SituationRoomTable;
