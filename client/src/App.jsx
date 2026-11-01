import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ChatProvider } from './context/ChatContext';
import { CallProvider } from './context/CallContext';
import { PageLoader } from './components/ui';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ChatPage from './pages/ChatPage';
import FriendsPage from './pages/FriendsPage';
import DiscoverPage from './pages/DiscoverPage';
import CallsPage from './pages/CallsPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import NotFoundPage from './pages/NotFoundPage';

function RequireAuth({ children }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function GuestOnly({ children }) {
  const { me, loading } = useAuth();
  if (loading) return <PageLoader label="Checking your session…" />;
  if (me) return <Navigate to="/" replace />;
  return children;
}

function AdminOnly({ children }) {
  const { me, loading, can } = useAuth();
  if (loading) return <PageLoader />;
  if (!me) return <Navigate to="/login" replace />;
  if (!can('console.access')) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <SocketProvider>
          <ChatProvider>
            <CallProvider>
              <Routes>
                <Route
                  path="/login"
                  element={
                    <GuestOnly>
                      <LoginPage />
                    </GuestOnly>
                  }
                />
                <Route
                  path="/register"
                  element={
                    <GuestOnly>
                      <RegisterPage />
                    </GuestOnly>
                  }
                />
                <Route
                  path="/forgot-password"
                  element={
                    <GuestOnly>
                      <ForgotPasswordPage />
                    </GuestOnly>
                  }
                />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />

                <Route
                  element={
                    <RequireAuth>
                      <AppLayout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<ChatPage />} />
                  <Route path="friends" element={<FriendsPage />} />
                  <Route path="discover" element={<DiscoverPage />} />
                  <Route path="calls" element={<CallsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="settings/:section" element={<SettingsPage />} />
                  <Route
                    path="admin"
                    element={
                      <AdminOnly>
                        <AdminPage />
                      </AdminOnly>
                    }
                  />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </CallProvider>
          </ChatProvider>
        </SocketProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
