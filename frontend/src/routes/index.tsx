import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { FullPageSpinner } from '@/components/states';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/features/auth/AuthContext';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '@/features/auth/AuthPages';
import { CourseDetailPage, CoursesPage } from '@/features/courses/CoursePages';
import { DashboardPage } from '@/features/dashboard/Dashboards';
import { JoinPage } from '@/features/sessions/JoinPage';
import { SessionPage } from '@/features/sessions/SessionPage';
import { AccountPage } from '@/pages/AccountPage';
import { NotFoundPage } from '@/pages/NotFound';
import type { Role } from '@/types/api';

// Heavier, less frequently used screens load on demand so the live polling view stays light.
const ReportPage = lazy(() => import('@/features/sessions/ReportPage').then((m) => ({ default: m.ReportPage })));
const AdminUsersPage = lazy(() => import('@/features/admin/AdminPages').then((m) => ({ default: m.AdminUsersPage })));
const AdminAuditPage = lazy(() => import('@/features/admin/AdminPages').then((m) => ({ default: m.AdminAuditPage })));

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  // Preserve the destination (including a QR link's ?code=) across sign-in.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <AppShell />;
}

/** UI convenience only: the API enforces every one of these rules independently. */
function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  return user && roles.includes(user.role) ? <Outlet /> : <Navigate to="/" replace />;
}

function JoinRedirect() {
  const [params] = useSearchParams();
  const code = params.get('code');
  return <Navigate to={`/join${code ? `?code=${encodeURIComponent(code)}` : ''}`} replace />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/j" element={<JoinRedirect />} />
        <Route element={<RequireAuth />}>
          <Route index element={<DashboardPage />} />
          <Route path="join" element={<RequireRole roles={['STUDENT']} />}><Route index element={<JoinPage />} /></Route>
          <Route path="courses" element={<CoursesPage />} />
          <Route path="courses/:courseId" element={<CourseDetailPage />} />
          <Route path="sessions/:sessionId" element={<SessionPage />} />
          <Route path="sessions/:sessionId/report" element={<RequireRole roles={['LECTURER']} />}><Route index element={<ReportPage />} /></Route>
          <Route path="account" element={<AccountPage />} />
          <Route path="admin" element={<RequireRole roles={['ADMIN']} />}>
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="audit" element={<AdminAuditPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
