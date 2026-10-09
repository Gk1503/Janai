import { useState } from 'react'
import { BarChart3, Package, ShoppingBag, Users, Wallet } from 'lucide-react'
import { useAuth } from '../context/AppContexts'
import { EmptyState } from '../components/UI'

const stats = [
  { label: 'Orders', value: '0', icon: ShoppingBag },
  { label: 'Revenue', value: '₹0', icon: Wallet },
  { label: 'Customers', value: '0', icon: Users },
  { label: 'Products', value: '0', icon: Package },
]

export default function AdminDashboardPage() {
  const { user } = useAuth()
  const [today] = useState(() => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))

  return <div className="adm-dashboard">
    <section className="adm-welcome">
      <div>
        <span className="eyebrow">JANAI OPERATIONS</span>
        <h2>Welcome back, {user?.firstName || 'Admin'}</h2>
        <p>{today}</p>
      </div>
    </section>

    <section className="adm-stat-grid" aria-label="Summary">
      {stats.map(({ label, value, icon: Icon }) => <article className="adm-stat" key={label}>
        <span className="adm-stat-icon"><Icon size={19} /></span>
        <small>{label}</small>
        <strong>{value}</strong>
      </article>)}
    </section>

    <div className="adm-grid">
      <section className="adm-panel adm-panel-wide">
        <div className="adm-panel-head"><h3>Sales overview</h3><span className="adm-muted">Last 7 days</span></div>
        <div className="adm-chart-placeholder">
          <BarChart3 size={28} />
          <p>Sales trends will appear here once orders are placed.</p>
        </div>
      </section>

      <section className="adm-panel">
        <div className="adm-panel-head"><h3>Recent orders</h3></div>
        <EmptyState title="No orders yet" message="New customer orders will show up here." />
      </section>

      <section className="adm-panel">
        <div className="adm-panel-head"><h3>Low-stock products</h3></div>
        <EmptyState title="No low-stock products" message="Products running low on stock will be listed here." />
      </section>
    </div>
  </div>
}
