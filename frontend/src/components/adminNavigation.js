import { BarChart3, Bell, Boxes, CalendarDays, CreditCard, LayoutDashboard, Package, Settings, ShieldCheck, ShoppingBag, Tags, Truck, UserRoundCheck, Users } from 'lucide-react'

// `access` decides who sees an item: { permission } | { any: [...] } | { owner: true }. Items without it
// are treated as owner-only. See utils/permissions.js; the backend enforces access regardless.
export const adminNavigation = [
  {
    label: 'MAIN',
    collapsible: false,
    items: [
      { label: 'Dashboard', path: '/admin', end: true, icon: LayoutDashboard, access: { owner: true } },
    ],
  },
  {
    label: 'ORDERS',
    items: [
      { label: 'All Orders', path: '/admin/orders', icon: ShoppingBag, access: { permission: 'orders:view' } },
      { label: 'Pre Orders', path: '/admin/pre-orders', icon: CalendarDays, access: { permission: 'preorders:view' } },
      { label: 'Bulk Orders', path: '/admin/bulk-orders', icon: Boxes, access: { permission: 'bulk:view' } },
    ],
  },
  {
    label: 'PRODUCTS',
    items: [
      { label: 'Products', path: '/admin/products', icon: Package, access: { any: ['products:view', 'inventory:update'] } },
      { label: 'Categories', path: '/admin/categories', icon: Tags, access: { permission: 'categories:manage' } },
    ],
  },
  {
    label: 'CUSTOMERS',
    items: [
      { label: 'Customers', path: '/admin/customers', icon: Users, access: { permission: 'customers:view' } },
      { label: 'Payments', path: '/admin/payments', icon: CreditCard, access: { owner: true } },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { label: 'Delivery', path: '/admin/delivery', icon: Truck, access: { permission: 'delivery:view' } },
      { label: 'Delivery Staff', path: '/admin/delivery-staff', icon: UserRoundCheck, access: { owner: true } },
      { label: 'Notifications', path: '/admin/notifications', icon: Bell, access: { owner: true } },
    ],
  },
  {
    label: 'BUSINESS',
    items: [
      { label: 'Reports', path: '/admin/reports', icon: BarChart3, access: { owner: true } },
      { label: 'Staff & Access', path: '/admin/staff', icon: ShieldCheck, access: { owner: true } },
      { label: 'Settings', path: '/admin/settings', icon: Settings, access: { owner: true } },
    ],
  },
]
