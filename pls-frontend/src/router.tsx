import { createBrowserRouter } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import QRAuthenticator from './pages/QRAuthenticator';
import AdminLandingPage from './pages/AdminLandingPage';
import RoleSelectionPage from './pages/RoleSelectionPage';
import ScanPatient from './pages/ScanPatient';
import TriagePage1 from './pages/TriagePage1';
import TriagePage2 from './pages/TriagePage2';
import TriagePage3 from './pages/TriagePage3';
import AmbulanzprotokollPage1 from './pages/AmbulanzprotokollPage1';
import ShowBodyFront from './pages/ShowBodyFront';
import ShowBodyBack from './pages/ShowBodyBack';
import SituationRoomTable from './pages/SituationRoomTable';
import AdminSettingsPage from './pages/AdminSettingsPage';
import ChangeAdminPasswordPage from './pages/ChangeAdminPasswordPage';
import CreateLoginQrCodesPage from './pages/CreateLoginQrCodesPage';
import ShowUnusedLoginQrCodesPage from './pages/ShowUnusedLoginQrCodesPage';
import CreatePatientQrCodes from './pages/CreatePatientQrCodes';
import ShowUnusedPatientQrCodesPage from './pages/ShowUnusedPatientQrCodesPage';
import EditOperationScene from './pages/EditOperationScene';
import CreateOperationScene from './pages/CreateOperationScene';
import CreateNewAdminUserPage from './pages/CreateNewAdminUserPage';
import ManageUsersPage from './pages/ManageUsersPage';
import OrganisationsPage from './pages/OrganisationsPage';
import AdminPatientsPage from './pages/AdminPatientsPage';
import NotFound from './pages/NotFound';
import ProtectedRoute from './components/ProtectedRoute';
import { ADMIN_ONLY, ALL_ROLES, PASSWORD_ROLES, STAFF_ROLES } from './auth/roles';

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/qrAuthenticator', element: <QRAuthenticator /> },
  { path: '/AdminLandingPage', element: <AdminLandingPage /> },

  // Responder, QR session and staff (TriageWrite)
  { path: '/RoleSelection', element: <ProtectedRoute roles={ALL_ROLES} offlineTolerant element={<RoleSelectionPage />} /> },
  { path: '/ScanPatient', element: <ProtectedRoute roles={ALL_ROLES} offlineTolerant element={<ScanPatient />} /> },
  { path: '/TriagePage1', element: <ProtectedRoute roles={ALL_ROLES} offlineTolerant element={<TriagePage1 />} /> },
  { path: '/TriagePage2', element: <ProtectedRoute roles={ALL_ROLES} offlineTolerant element={<TriagePage2 />} /> },
  { path: '/TriagePage3', element: <ProtectedRoute roles={ALL_ROLES} offlineTolerant element={<TriagePage3 />} /> },
  { path: '/AmbulanzprotokollPage1/:patientId', element: <ProtectedRoute roles={ALL_ROLES} offlineTolerant element={<AmbulanzprotokollPage1 />} /> },
  { path: '/ShowBodyFront', element: <ProtectedRoute roles={ALL_ROLES} offlineTolerant element={<ShowBodyFront />} /> },
  { path: '/ShowBodyBack', element: <ProtectedRoute roles={ALL_ROLES} offlineTolerant element={<ShowBodyBack />} /> },
  { path: '/SituationRoomTable', element: <ProtectedRoute roles={ALL_ROLES} offlineTolerant element={<SituationRoomTable />} /> },

  // Staff pages (parity plan WP 1.4); the server enforces the same policies
  { path: '/AdminSettingsPage', element: <ProtectedRoute roles={STAFF_ROLES} element={<AdminSettingsPage />} /> },
  { path: '/ChangeAdminPasswordPage', element: <ProtectedRoute roles={PASSWORD_ROLES} allowPendingPasswordChange element={<ChangeAdminPasswordPage />} /> },
  { path: '/CreateLoginQrCodesPage', element: <ProtectedRoute roles={STAFF_ROLES} element={<CreateLoginQrCodesPage />} /> },
  { path: '/ShowUnusedLoginQrCodesPage', element: <ProtectedRoute roles={STAFF_ROLES} element={<ShowUnusedLoginQrCodesPage />} /> },
  { path: '/CreatePatientQrCodePage', element: <ProtectedRoute roles={ADMIN_ONLY} element={<CreatePatientQrCodes />} /> },
  { path: '/ShowUnusedPatientQrCodesPage', element: <ProtectedRoute roles={STAFF_ROLES} element={<ShowUnusedPatientQrCodesPage />} /> },
  { path: '/EditOperationScene', element: <ProtectedRoute roles={STAFF_ROLES} element={<EditOperationScene />} /> },
  { path: '/CreateOperationScene', element: <ProtectedRoute roles={STAFF_ROLES} element={<CreateOperationScene />} /> },
  { path: '/CreateNewAdminUserPage', element: <ProtectedRoute roles={ADMIN_ONLY} element={<CreateNewAdminUserPage />} /> },
  { path: '/ManageUsersPage', element: <ProtectedRoute roles={ADMIN_ONLY} element={<ManageUsersPage />} /> },
  { path: '/OrganisationsPage', element: <ProtectedRoute roles={ADMIN_ONLY} element={<OrganisationsPage />} /> },
  { path: '/AdminPatientsPage', element: <ProtectedRoute roles={ADMIN_ONLY} element={<AdminPatientsPage />} /> },

  { path: '*', element: <NotFound /> },
]);
