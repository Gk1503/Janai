import { BarChart3, CalendarDays, ClipboardList, LayoutDashboard, Package, Settings, ShoppingBag, Users } from 'lucide-react'

export const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/products', label: 'Products', icon: Package },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingBag },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/admin/pre-orders', label: 'Pre-orders', icon: CalendarDays },
  { to: '/admin/bulk-orders', label: 'Bulk Orders', icon: ClipboardList },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]
