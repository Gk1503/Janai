import { BarChart3, Bell, CalendarDays, CreditCard, IndianRupee, LayoutDashboard, Package, Settings, ShoppingBag, Tags, Truck, UserRoundCheck, Users } from 'lucide-react'

export const adminNavigation = [
  {
    label: 'MAIN',
    collapsible: false,
    items: [
      { label: 'Dashboard', path: '/admin', end: true, icon: LayoutDashboard },
    ],
  },
  {
    label: 'ORDERS',
    items: [
      { label: 'Orders', path: '/admin/orders', icon: ShoppingBag },
      { label: 'Pre Orders', path: '/admin/pre-orders', icon: CalendarDays },
    ],
  },
  {
    label: 'PRODUCTS',
    items: [
      { label: 'Products', path: '/admin/products', icon: Package },
      { label: 'Categories', path: '/admin/categories', icon: Tags },
      { label: 'Pricing', path: '/admin/pricing', icon: IndianRupee },
    ],
  },
  {
    label: 'CUSTOMERS',
    items: [
      { label: 'Customers', path: '/admin/customers', icon: Users },
      { label: 'Payments', path: '/admin/payments', icon: CreditCard },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { label: 'Delivery', path: '/admin/delivery', icon: Truck },
      { label: 'Delivery Staff', path: '/admin/delivery-staff', icon: UserRoundCheck },
      { label: 'Notifications', path: '/admin/notifications', icon: Bell },
    ],
  },
  {
    label: 'BUSINESS',
    items: [
      { label: 'Reports', path: '/admin/reports', icon: BarChart3 },
      { label: 'Settings', path: '/admin/settings', icon: Settings },
    ],
  },
]
