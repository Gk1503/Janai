import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader } from './UI'
import { useAuth } from '../context/AppContexts'
import ForcePasswordChangePage from '../pages/ForcePasswordChangePage'

export default function ProtectedRoute({ admin = false }) {
  const { user, authLoading, hasPanelAccess } = useAuth()
  const location = useLocation()
  if (authLoading) return <Loader label="Checking your Janai account" />
  if (!user) return <Navigate to={admin ? '/admin/login' : '/login'} replace state={{ from: location.pathname }} />
  // Owner and staff may enter the panel; customers (and anyone else) go back to the shop.
  if (admin && !hasPanelAccess) return <Navigate to="/" replace />
  // A temporary or reset password must be replaced before anything else loads or fetches.
  if (user.mustChangePassword) return <ForcePasswordChangePage />
  return <Outlet />
}
