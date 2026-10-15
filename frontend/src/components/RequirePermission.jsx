import { Link, Outlet } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../context/AppContexts'
import { EmptyState } from './UI'

export function AccessDenied() {
  return <section className="adm-panel">
    <EmptyState icon={ShieldAlert} title="Access denied" message="You don’t have permission to open this page. Ask the owner if you need access." />
    <div className="adm-empty-action"><Link className="button button-outline" to="/admin">Back to my dashboard</Link></div>
  </section>
}

// Layout route: renders the nested page only when the signed-in user may use it, so a page that is not
// allowed never mounts and therefore never requests its data. The backend still enforces everything.
//   <RequirePermission any={['orders:view']} />   needs at least one of these
//   <RequirePermission ownerOnly />                owner account only
export default function RequirePermission({ any = [], ownerOnly = false }) {
  const { can, isOwner } = useAuth()
  if (isOwner) return <Outlet />
  if (ownerOnly || !any.some((permission) => can(permission))) return <AccessDenied />
  return <Outlet />
}
