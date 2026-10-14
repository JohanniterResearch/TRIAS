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

export default function TriagePage1() {
  const navigate = useNavigate();
  const location = useLocation();
  const [green, setGreen] = useState(false);
  const [black, setBlack] = useState(false);
  const patientId = useWorkContextStore((state) => state.patientId);
  const triageResult = location.state?.triageResult;
  const ensurePatientLocation = usePatientLocationStore((state) => state.ensurePatientLocation);
  const { setTriageColor, error: saveError, saving } = usePatientTriage(patientId);

  useEffect(() => {
    void ensurePatientLocation(patientId);
  }, [ensurePatientLocation, patientId]);

  useEffect(() => {
    setGreen(triageResult === TRIAGE_COLOR.GRUEN);
    setBlack(triageResult === TRIAGE_COLOR.SCHWARZ);
  }, [triageResult]);

  const handleGreen = async () => {
    if (await setTriageColor(TRIAGE_COLOR.GRUEN)) setGreen(true);
  };

  const handleBlack = async () => {
    if (await setTriageColor(TRIAGE_COLOR.SCHWARZ)) setBlack(true);
  };

  const handleNextPage = () => {
    navigate('/TriagePage2');
  };

  const handleNewPatient = () => {
    navigate('/ScanPatient');
  };

  const handleBodyClick = () => {
    const result = green ? TRIAGE_COLOR.GRUEN : black ? TRIAGE_COLOR.SCHWARZ : undefined;
    navigate('/ShowBodyFront', { state: { returnTo: '/TriagePage1', triageResult: result } });
  };

  function renderContent() {
    if (!black && !green) {
      return (
        <>
          <header className="triage-header">
            <p><PatientLabel /></p>
          </header>
          <main className="triage-main">
            <div className="triage-actions triage-actions--two">
              <button className="triage-button" disabled={saving} onClick={handleGreen}>
                Patient gehfähig (ohne weitere Verletzungen)
              </button>
              <button className="triage-button" disabled={saving} onClick={handleNextPage}>
                Patient nicht gehfähig (und/oder weitere Verletzungen)
              </button>
            </div>
            <button className="triage-button triage-button--danger triage-button--wide" disabled={saving} onClick={handleBlack}>
              eindeutiges Todeszeichen
            </button>
          </main>
        </>
      );
    } else if (green) {
      return (
        <>
          <header className="triage-header">
            <p><PatientLabel /></p>
          </header>
          <main className="triage-main triage-main--result">
            <p className="triage-result triage-result--green">Patient wurde mit der Kategorie GRÜN versehen</p>
            <ClinicalFlagsPanel triageResult={TRIAGE_COLOR.GRUEN} />
            <button className="triage-button triage-button--wide" onClick={handleNewPatient}>Nächsten Patienten laden</button>
          </main>
        </>
      );
    } else if (black) {
      return (
        <>
          <header className="triage-header">
            <p><PatientLabel /></p>
          </header>
          <main className="triage-main triage-main--result">
            <p className="triage-result triage-result--black">Patient wurde mit der Kategorie SCHWARZ versehen</p>
            <ClinicalFlagsPanel triageResult={TRIAGE_COLOR.SCHWARZ} />
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
