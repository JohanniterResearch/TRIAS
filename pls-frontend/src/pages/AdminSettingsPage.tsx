import { useNavigate } from 'react-router-dom';
import { IoIosLogOut } from 'react-icons/io';
import { FaKey } from 'react-icons/fa';
import Appbar from '../components/Appbar';
import { endSession } from '../auth/session';
import { useAuthStore } from '../stores/authStore';

export default function AdminSettingsPage() {
  const navigate = useNavigate();
  const role = useAuthStore((state) => state.session?.role);
  const isAdmin = role === 'admin';

  const handleLogout = async () => {
    await endSession();
    navigate('/AdminLandingPage', { replace: true });
  };

  return (
    <>
      <Appbar />
      <div className="page">
        <div className="page-container">
          <div className="btn-row">
            <button onClick={() => void handleLogout()} className="btn-action">
              <IoIosLogOut /> Logout
            </button>
            <button onClick={() => navigate('/ChangeAdminPasswordPage')} className="btn-primary" style={{ width: 'auto' }}>
              <FaKey style={{ marginRight: '6px' }} /> Passwort ändern
            </button>
          </div>

          <div className="settings-section">
            <p className="settings-section-title">Lagebild</p>
            <button onClick={() => navigate('/RoleSelection')} className="wide-button" style={{ flex: '1 1 100%' }}>
              Einsatzort und Funktion wählen
            </button>
          </div>

          <div className="settings-section">
            <p className="settings-section-title">Authorizierungs QR-Codes (Einsatzkräfte)</p>
            <button onClick={() => navigate('/CreateLoginQrCodesPage')} className="wide-button">
              QR-Codes für Authorizierung erzeugen
            </button>
            <button onClick={() => navigate('/ShowUnusedLoginQrCodesPage')} className="wide-button">
              Nicht verwendete QR-Codes anzeigen
            </button>
          </div>

          <div className="settings-section">
            <p className="settings-section-title">Patienten QR-Codes</p>
            {isAdmin && (
              <button onClick={() => navigate('/CreatePatientQrCodePage')} className="wide-button">
                Patienten QR-Codes erzeugen
              </button>
            )}
            <button onClick={() => navigate('/ShowUnusedPatientQrCodesPage')} className="wide-button">
              Nicht verwendete QR-Codes anzeigen
            </button>
          </div>

          <div className="settings-section">
            <p className="settings-section-title">Einsatzort</p>
            <button onClick={() => navigate('/EditOperationScene')} className="wide-button" style={{ flex: '1 1 100%' }}>
              Einsatzort erstellen/bearbeiten
            </button>
          </div>

          {isAdmin && (
            <div className="settings-section">
              <p className="settings-section-title">Admin-Management</p>
              <button onClick={() => navigate('/CreateNewAdminUserPage')} className="wide-button">
                Benutzer erstellen
              </button>
              <button onClick={() => navigate('/ManageUsersPage')} className="wide-button">
                Benutzer verwalten
              </button>
              <button onClick={() => navigate('/OrganisationsPage')} className="wide-button">
                Organisationen
              </button>
              <button onClick={() => navigate('/AdminPatientsPage')} className="wide-button">
                Patient:innen suchen und korrigieren
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
