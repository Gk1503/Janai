import { useLocation } from 'react-router-dom'
import { Sprout } from 'lucide-react'
import { EmptyState } from '../components/UI'
import { adminNav } from './adminNav'

export default function AdminPlaceholderPage() {
  const { pathname } = useLocation()
  const label = adminNav.find((item) => pathname.startsWith(item.to))?.label || 'This section'

  return <section className="adm-panel adm-placeholder">
    <EmptyState icon={Sprout} title={`${label} is coming soon`} message="This section of the admin panel is not built yet." />
  </section>
}
