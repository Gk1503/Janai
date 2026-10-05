import { Outlet, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '../context/AppContexts'

export default function AdminLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  function signOut() {
    logout()
    navigate('/admin/login', { replace: true })
  }
  return <div className="app-shell"><header className="site-header"><div className="page-container admin-bar"><div className="brand-logo"><img src="/Janai-logo.jpg" alt="Janai" /></div><button className="button button-outline" onClick={signOut}>Log out<LogOut size={15} /></button></div></header><main><Outlet /></main></div>
}
