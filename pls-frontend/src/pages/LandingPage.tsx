import { Navigate } from 'react-router-dom';
import { isLeitstelleOrAdmin, useAuthStore } from '../stores/authStore';

export default function LandingPage() {
  const session = useAuthStore((state) => state.session);
  if (!session) return <Navigate to="/qrAuthenticator" />;
  return <Navigate to={isLeitstelleOrAdmin(session.role) ? '/AdminSettingsPage' : '/RoleSelection'} />;
}
