import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronUp, LogOut } from 'lucide-react'
import { useAuth } from '../context/AppContexts'
import { adminNavigation } from './adminNavigation'

const collapsibleLabels = adminNavigation.filter((group) => group.collapsible !== false).map((group) => group.label)
const groupForPath = (pathname) => adminNavigation.find((group) => group.items.some((item) => pathname === item.path || (!item.end && pathname.startsWith(`${item.path}/`))))?.label

export default function AdminSidebar({ open = false, onNavigate = () => {} }) {
  const { logout } = useAuth()
  const { pathname } = useLocation()
  // Groups start collapsed, except the one holding the current page so its active link is visible.
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set(collapsibleLabels.filter((label) => label !== groupForPath(pathname))))
  useEffect(() => {
    const active = groupForPath(pathname)
    setCollapsedGroups((current) => {
      if (!active || !current.has(active)) return current
      const next = new Set(current)
      next.delete(active)
      return next
    })
  }, [pathname])

  function toggleGroup(label) {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  return <aside className={`adm-sidebar${open ? ' is-open' : ''}`} aria-label="Admin navigation">
    <div className="adm-sidebar-brand">
      <span className="brand-logo adm-sidebar-logo"><img src="/Janai-logo.jpg" alt="Janai" /></span>
      <span className="adm-sidebar-brand-text">Admin Panel</span>
    </div>

    <nav className="adm-sidebar-nav">
      {adminNavigation.map((group) => {
        const collapsible = group.collapsible !== false
        const isOpen = !collapsible || !collapsedGroups.has(group.label)
        return <div className="adm-nav-group" key={group.label}>
          {collapsible ? (
            <button type="button" className="adm-nav-group-head" onClick={() => toggleGroup(group.label)} aria-expanded={isOpen}>
              <span>{group.label}</span>
              {isOpen ? <ChevronUp size={14} className="adm-group-chevron" /> : <ChevronDown size={14} className="adm-group-chevron" />}
            </button>
          ) : (
            <span className="adm-nav-group-head is-static">{group.label}</span>
          )}
          <div className={`adm-nav-group-items${isOpen ? ' is-open' : ''}`}>
            <div className="adm-nav-group-items-inner">
              {group.items.map(({ label, path, end, icon: Icon }) => <NavLink key={path} to={path} end={end} onClick={onNavigate} className={({ isActive }) => `adm-nav-link${isActive ? ' active' : ''}`}><Icon size={17} /><span>{label}</span></NavLink>)}
            </div>
          </div>
        </div>
      })}
    </nav>

    <button type="button" className="adm-nav-link adm-logout" onClick={logout}><LogOut size={17} /><span>Logout</span></button>
  </aside>
}
