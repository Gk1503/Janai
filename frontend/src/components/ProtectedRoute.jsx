import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader } from './UI'
import { useAuth } from '../context/AppContexts'

export default function ProtectedRoute({ admin = false }) {
  const { user, authLoading } = useAuth()
  const location = useLocation()
  if (authLoading) return <Loader label="Checking your Janai account" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}
