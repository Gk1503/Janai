// Frontend mirror of backend/config/permissions.js. It exists only to drive navigation and to hide
// controls the user cannot use; the backend enforces every permission independently.
// backend/test/frontend-permissions-sync.test.js fails if the names or presets drift from the backend.

export const PERMISSIONS = {
  ORDERS_VIEW: 'orders:view',
  ORDERS_UPDATE_STATUS: 'orders:update_status',
  ORDERS_CANCEL: 'orders:cancel',
  PREORDERS_VIEW: 'preorders:view',
  PREORDERS_UPDATE: 'preorders:update',
  BULK_VIEW: 'bulk:view',
  BULK_UPDATE: 'bulk:update',
  PRODUCTS_VIEW: 'products:view',
  PRODUCTS_MANAGE: 'products:manage',
  INVENTORY_UPDATE: 'inventory:update',
  CATEGORIES_MANAGE: 'categories:manage',
  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_VIEW_CONTACT: 'customers:view_contact',
  CONTACT_VIEW: 'contact:view',
  DELIVERY_VIEW: 'delivery:view',
  DELIVERY_UPDATE: 'delivery:update',
}

export const PERMISSION_LIST = Object.values(PERMISSIONS)

// An action permission only counts while its prerequisite is also held (same rule as the backend).
export const REQUIRES = {
  'orders:update_status': ['orders:view'],
  'orders:cancel': ['orders:view'],
  'preorders:update': ['preorders:view'],
  'bulk:update': ['bulk:view'],
  'products:manage': ['products:view'],
  'delivery:update': ['delivery:view'],
}

export const ROLE_PRESETS = {
  order_manager: { label: 'Order Manager', permissions: ['orders:view', 'orders:update_status', 'orders:cancel', 'customers:view_contact'] },
  preorder_manager: { label: 'Pre-Order Manager', permissions: ['preorders:view', 'preorders:update', 'customers:view_contact'] },
  bulk_order_manager: { label: 'Bulk-Order Manager', permissions: ['bulk:view', 'bulk:update'] },
  inventory_manager: { label: 'Inventory Manager', permissions: ['products:view', 'inventory:update'] },
  customer_support: { label: 'Customer Support', permissions: ['orders:view', 'customers:view', 'customers:view_contact', 'contact:view'] },
  delivery_staff: { label: 'Delivery Staff', permissions: ['delivery:view', 'delivery:update'] },
  custom: { label: 'Custom Role', permissions: [] },
}

// How the Staff & Access form groups permissions. `available: false` marks modules that do not exist yet.
export const PERMISSION_GROUPS = [
  { key: 'orders', label: 'Orders', items: [
    { permission: 'orders:view', label: 'View orders' },
    { permission: 'orders:update_status', label: 'Update order status' },
    { permission: 'orders:cancel', label: 'Cancel orders' },
  ] },
  { key: 'preorders', label: 'Pre Orders', items: [
    { permission: 'preorders:view', label: 'View pre-orders' },
    { permission: 'preorders:update', label: 'Update or cancel pre-orders' },
  ] },
  { key: 'bulk', label: 'Bulk Orders', items: [
    { permission: 'bulk:view', label: 'View bulk requests' },
    { permission: 'bulk:update', label: 'Review and update bulk requests' },
  ] },
  { key: 'products', label: 'Products', items: [
    { permission: 'products:view', label: 'View products and supplier costs' },
    { permission: 'products:manage', label: 'Add, edit and delete products' },
  ] },
  { key: 'inventory', label: 'Inventory', items: [
    { permission: 'inventory:update', label: 'Update stock quantities and purchases' },
  ] },
  { key: 'categories', label: 'Categories', items: [
    { permission: 'categories:manage', label: 'Manage categories' },
  ] },
  { key: 'customers', label: 'Customers', items: [
    { permission: 'customers:view', label: 'View customers' },
  ] },
  { key: 'contact-details', label: 'Customer Contact Details', items: [
    { permission: 'customers:view_contact', label: 'See full customer email and phone' },
  ] },
  { key: 'contact', label: 'Contact Messages', items: [
    { permission: 'contact:view', label: 'View contact messages' },
  ] },
  { key: 'delivery', label: 'Delivery', available: false, items: [
    { permission: 'delivery:view', label: 'View deliveries' },
    { permission: 'delivery:update', label: 'Update deliveries' },
  ] },
]

export const isOwnerAccount = (user) => user?.role === 'admin' && user.isActive !== false
export const hasPanelAccess = (user) => Boolean(user) && ['admin', 'staff'].includes(user.role) && user.isActive !== false

// The permissions this user effectively holds: all for the owner, none for customers or a missing user.
export function effectivePermissions(user) {
  if (!user || user.isActive === false) return new Set()
  if (user.role === 'admin') return new Set(PERMISSION_LIST)
  if (user.role !== 'staff') return new Set()
  const held = new Set((Array.isArray(user.permissions) ? user.permissions : []).filter((entry) => PERMISSION_LIST.includes(entry)))
  return new Set([...held].filter((permission) => (REQUIRES[permission] || []).every((required) => held.has(required))))
}

export function createCan(user) {
  const held = effectivePermissions(user)
  return (permission) => held.has(permission)
}

// Includes the permissions a given permission needs, so the form can keep selections valid.
export function withPrerequisites(permissions) {
  const result = new Set(permissions)
  for (const permission of permissions) for (const required of REQUIRES[permission] || []) result.add(required)
  return [...result]
}

// Removes everything that depends on a permission being un-ticked.
export function withoutDependents(permissions, removed) {
  const result = new Set(permissions)
  result.delete(removed)
  let changed = true
  while (changed) {
    changed = false
    for (const permission of [...result]) {
      if ((REQUIRES[permission] || []).some((required) => !result.has(required))) { result.delete(permission); changed = true }
    }
  }
  return [...result]
}

// Navigation items declare `access`: { permission } | { any: [...] } | { owner: true }. Items without
// a declaration are treated as owner-only so a new item can never be exposed by accident.
export function canAccessItem(item, can, owner) {
  const access = item.access || { owner: true }
  if (owner) return true
  if (access.owner) return false
  if (access.permission) return can(access.permission)
  if (Array.isArray(access.any)) return access.any.some((permission) => can(permission))
  return false
}

// Removes inaccessible items and any group left empty.
export function filterNavigation(navigation, can, owner) {
  return navigation
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccessItem(item, can, owner)) }))
    .filter((group) => group.items.length > 0)
}

export function firstPermittedPath(navigation, can, owner) {
  const groups = filterNavigation(navigation, can, owner)
  return groups.length ? groups[0].items[0].path : null
}

// Which actions this user may take on an order of the given type (mirrors ORDER_TYPE_PERMISSIONS).
const ORDER_ACTIONS = {
  normal: { update: 'orders:update_status', cancel: 'orders:cancel' },
  preorder: { update: 'preorders:update', cancel: 'preorders:update' },
  bulk: { update: 'bulk:update', cancel: 'bulk:update' },
}

export function orderActions(can, order) {
  const actions = ORDER_ACTIONS[order?.orderType || 'normal']
  if (!actions) return { canUpdate: false, canCancel: false }
  return { canUpdate: can(actions.update), canCancel: can(actions.cancel) }
}

const sameSet = (a, b) => a.length === b.length && a.every((entry) => b.includes(entry))

// A preset is only a starting point: if the owner changes the ticks the account is labelled "Custom Role".
export const presetKeyFor = (chosen, permissions) => (chosen && chosen !== 'custom' && ROLE_PRESETS[chosen] && sameSet(ROLE_PRESETS[chosen].permissions, permissions) ? chosen : 'custom')
