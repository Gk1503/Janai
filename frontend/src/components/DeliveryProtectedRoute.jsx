import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { EmptyState, Loader } from './UI'
import { useAuth } from '../context/AppContexts'
import { isDeliveryStaff } from '../utils/permissions'

// Delivery staff sign in purely by OTP and never set or change a password, so — unlike ProtectedRoute —
// this guard deliberately never routes through ForcePasswordChangePage. The backend's rider endpoints
// allow the same thing via requireAuthAllowingPasswordChange, for the identical reason.
export default function DeliveryProtectedRoute() {
  const { user, authLoading } = useAuth()
  const location = useLocation()
  if (authLoading) return <Loader label="Checking your delivery session" />
  if (!user) return <Navigate to="/delivery/login" replace state={{ from: location.pathname }} />
  // Frontend check only for UX (hide the page instead of flashing it) — every /delivery/* API call is
  // independently re-authorized by the backend regardless of what this renders.
  if (!isDeliveryStaff(user)) {
    return <div className="rider-shell rider-shell-centered">
      <EmptyState icon={ShieldAlert} title="Delivery access required" message="This account does not have delivery access. Contact the Janai owner if this seems wrong." action="Back to Home" to="/" />
    </div>
  }
  return <Outlet />
}
