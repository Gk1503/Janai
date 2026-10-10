import { BarChart3, Bell, Bike, Boxes, CalendarClock, CalendarDays, ChefHat, CircleX, Clock, CreditCard, Inbox, IndianRupee, LayoutDashboard, Package, PackageCheck, Settings, ShoppingBag, Tags, Truck, UserRoundCheck, Users } from 'lucide-react'

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
      { label: 'All Orders', path: '/admin/orders', end: true, icon: ShoppingBag },
      { label: 'Pending', path: '/admin/orders/pending', icon: Clock },
      { label: 'Processing', path: '/admin/orders/processing', icon: ChefHat },
      { label: 'Out for Delivery', path: '/admin/orders/out-for-delivery', icon: Bike },
      { label: 'Delivered', path: '/admin/orders/delivered', icon: PackageCheck },
      { label: 'Cancelled', path: '/admin/orders/cancelled', icon: CircleX },
    ],
  },
  {
    label: 'PRE ORDERS',
    items: [
      { label: 'All Pre Orders', path: '/admin/pre-orders', end: true, icon: CalendarDays },
      { label: 'Scheduled', path: '/admin/pre-orders/scheduled', icon: CalendarClock },
    ],
  },
  {
    label: 'BULK ORDERS',
    items: [
      { label: 'All Bulk Orders', path: '/admin/bulk-orders', end: true, icon: Boxes },
      { label: 'Requests', path: '/admin/bulk-orders/requests', icon: Inbox },
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
