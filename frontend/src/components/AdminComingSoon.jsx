import { useLocation } from 'react-router-dom'
import { Sprout } from 'lucide-react'
import { EmptyState } from './UI'
import { adminNavigation } from './adminNavigation'

function currentLabel(pathname) {
  for (const group of adminNavigation) {
    const item = group.items.find((entry) => pathname === entry.path || pathname.startsWith(`${entry.path}/`))
    if (item) return item.label
  }
  return 'This section'
}

export default function AdminComingSoon() {
  const { pathname } = useLocation()
  return <section className="adm-panel">
    <EmptyState icon={Sprout} title={`${currentLabel(pathname)} is coming soon`} message="This part of the admin panel has not been built yet." />
  </section>
}
