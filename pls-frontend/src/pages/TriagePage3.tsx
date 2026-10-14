import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { usePatientTriage } from '../hooks/usePatientTriage';
import { TRIAGE_COLOR } from '../types/triageColor';
import { usePatientLocationStore } from '../stores/patientLocationStore';
import { useWorkContextStore } from '../stores/workContextStore';
import PatientLocationStatus from '../components/PatientLocationStatus';
import PatientLabel from '../components/PatientLabel';
import ClinicalFlagsPanel from '../components/ClinicalFlagsPanel';
import { FaUserInjured } from 'react-icons/fa';

export default function TriagePage3() {
  const navigate = useNavigate();
  const location = useLocation();
  const [red, setRed] = useState(false);
  const [yellow, setYellow] = useState(false);
  const patientId = useWorkContextStore((state) => state.patientId);
  const triageResult = location.state?.triageResult;
  const ensurePatientLocation = usePatientLocationStore((state) => state.ensurePatientLocation);
  const { setTriageColor, error: saveError, saving } = usePatientTriage(patientId);

  useEffect(() => {
    void ensurePatientLocation(patientId);
  }, [ensurePatientLocation, patientId]);

  useEffect(() => {
    setRed(triageResult === TRIAGE_COLOR.ROT);
    setYellow(triageResult === TRIAGE_COLOR.GELB);
  }, [triageResult]);

  const handleRed = async () => {
    if (await setTriageColor(TRIAGE_COLOR.ROT, { blutung: false })) setRed(true);
  };

  const handleYellow = async () => {
    if (await setTriageColor(TRIAGE_COLOR.GELB, { blutung: true })) setYellow(true);
  };

  const handleNewPatient = () => {
    navigate('/ScanPatient');
  };

  const handleBodyClick = () => {
    const result = red ? TRIAGE_COLOR.ROT : yellow ? TRIAGE_COLOR.GELB : undefined;
    navigate('/ShowBodyFront', { state: { returnTo: '/TriagePage3', triageResult: result } });
  };

  function renderContent() {
    if (!red && !yellow) {
      return (
        <>
          <header className="triage-header">
            <PatientLabel />
            <br /> nicht gehfähig
            <br /> Atmung suffizient
          </header>
          <main className="triage-main">
            <div className="triage-actions triage-actions--two">
              <button className="triage-button" disabled={saving} onClick={handleYellow}>Blutung Stillbar</button>
              <button className="triage-button" disabled={saving} onClick={handleRed}>Blutung nicht stillbar</button>
            </div>
          </main>
        </>
      );
    } else if (red) {
      return (
        <>
          <header className="triage-header">
            <PatientLabel />
            <br /> nicht gehfähig
            <br /> Atmung
          </header>
          <main className="triage-main triage-main--result">
            <p className="triage-result triage-result--red">Patient wurde mit der Kategorie ROT versehen</p>
            <ClinicalFlagsPanel triageResult={TRIAGE_COLOR.ROT} />
            <button className="triage-button triage-button--wide" onClick={handleNewPatient}>Nächsten Patienten laden</button>
          </main>
        </>
      );
    } else if (yellow) {
      return (
        <>
          <header className="triage-header">
            <PatientLabel />
            <br /> nicht gehfähig
            <br /> Atmung
          </header>
          <main className="triage-main triage-main--result">
            <p className="triage-result triage-result--yellow">Patient wurde mit der Kategorie Gelb versehen</p>
            <ClinicalFlagsPanel triageResult={TRIAGE_COLOR.GELB} />
            <button className="triage-button triage-button--wide" onClick={handleNewPatient}>Nächsten Patienten laden</button>
          </main>
        </>
      );
    }
  }

  return (
    <div className="triage-page">
      {renderContent()}
      {saveError && <p className="msg-error" role="alert">{saveError}</p>}
      <footer className="triage-footer">
        <section className="triage-location">
          <h4>GPS Status:</h4>
          <PatientLocationStatus patientId={patientId} />
        </section>
        <button className="triage-body-button" onClick={handleBodyClick} title="Körper markieren">
          <FaUserInjured aria-hidden="true" />
          <span>Körper markieren</span>
        </button>
      </footer>
    </div>
  );
}
