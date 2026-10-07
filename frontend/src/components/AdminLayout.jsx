import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import AdminSidebar from './AdminSidebar'
import AdminTopbar from './AdminTopbar'

export default function AdminLayout() {
  const [menuOpen, setMenuOpen] = useState(false)

  return <div className="adm-shell">
    <button type="button" className={`adm-backdrop${menuOpen ? ' is-visible' : ''}`} aria-label="Close menu" tabIndex={menuOpen ? 0 : -1} onClick={() => setMenuOpen(false)} />
    <AdminSidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
    <div className="adm-main">
      <AdminTopbar onMenuClick={() => setMenuOpen(true)} />
      <main className="adm-body"><Outlet /></main>
    </div>
  </div>
}
