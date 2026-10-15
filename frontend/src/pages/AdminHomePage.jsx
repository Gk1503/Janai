import { Navigate } from 'react-router-dom'
import { Sprout } from 'lucide-react'
import { useAuth } from '../context/AppContexts'
import { EmptyState } from '../components/UI'
import { adminNavigation } from '../components/adminNavigation'
import { firstPermittedPath } from '../utils/permissions'
import AdminPage from './AdminPage'

// /admin: the owner keeps the existing dashboard. Staff never mount it (it loads every dataset); they are
// sent to the first section they are allowed to use, or told they have no access yet.
export default function AdminHomePage() {
  const { can, isOwner } = useAuth()
  if (isOwner) return <AdminPage />
  const target = firstPermittedPath(adminNavigation, can, false)
  if (target && target !== '/admin') return <Navigate to={target} replace />
  return <section className="adm-panel">
    <EmptyState icon={Sprout} title="No access assigned yet" message="Your account is active but has no permissions. Ask the owner to give you access to the sections you need." />
  </section>
}
