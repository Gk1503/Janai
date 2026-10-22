import { Link, useLocation } from 'react-router-dom'
import { Bell, ChevronDown, Menu, Search } from 'lucide-react'
import { useAuth } from '../context/AppContexts'
import { adminNavigation } from './adminNavigation'

function currentTitle(pathname) {
  for (const group of adminNavigation) {
    const item = group.items.find((entry) => entry.end ? pathname === entry.path : pathname === entry.path || pathname.startsWith(`${entry.path}/`))
    if (item) return item.label
  }
  return 'Admin'
}

export default function AdminTopbar({ onMenuClick }) {
  const { pathname } = useLocation()
  const { user, isOwner } = useAuth()
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}` || 'A'
  // The owner's own settings are the business ones; every other staff account gets the personal
  // account page. AdminAccountPage itself also redirects an owner here if they land on it directly.
  const accountPath = isOwner ? '/admin/settings' : '/admin/account'

  return <header className="adm-topbar">
    <button type="button" className="adm-icon-button adm-menu-toggle" aria-label="Open menu" onClick={onMenuClick}><Menu size={20} /></button>
    <h1 className="adm-topbar-title">{currentTitle(pathname)}</h1>
    <div className="adm-topbar-actions">
      <label className="adm-search"><Search size={15} /><input type="search" placeholder="Search" aria-label="Search" /></label>
      <button type="button" className="adm-icon-button" aria-label="Notifications"><Bell size={17} /></button>
      <Link to={accountPath} className="adm-profile" aria-label={isOwner ? 'Settings' : 'My Account'}>
        <span className="adm-avatar">{initials}</span>
        <span className="adm-profile-name">{user?.firstName || 'Admin'}</span>
        <ChevronDown size={14} />
      </Link>
    </div>
  </header>
}
