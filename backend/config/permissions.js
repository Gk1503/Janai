// Central permission catalog. Authorization decisions are made from these definitions on the backend;
// the owner (role 'admin') holds every permission, customers hold none, and staff hold only what is
// stored on their account. Staff & Access (managing staff and roles) is deliberately NOT a permission:
// it is guarded by requireOwner and cannot be granted.
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
};

export const PERMISSION_LIST = Object.values(PERMISSIONS);

// An action permission only counts while its prerequisite view permission is also held.
export const REQUIRES = {
  'orders:update_status': ['orders:view'],
  'orders:cancel': ['orders:view'],
  'preorders:update': ['preorders:view'],
  'bulk:update': ['bulk:view'],
  'products:manage': ['products:view'],
  'delivery:update': ['delivery:view'],
};

// Editable starting points; the stored permission list on each staff account is what is enforced.
export const ROLE_PRESETS = {
  order_manager: { label: 'Order Manager', permissions: ['orders:view', 'orders:update_status', 'orders:cancel', 'customers:view_contact'] },
  preorder_manager: { label: 'Pre-Order Manager', permissions: ['preorders:view', 'preorders:update', 'customers:view_contact'] },
  bulk_order_manager: { label: 'Bulk-Order Manager', permissions: ['bulk:view', 'bulk:update'] },
  inventory_manager: { label: 'Inventory Manager', permissions: ['products:view', 'inventory:update'] },
  customer_support: { label: 'Customer Support', permissions: ['orders:view', 'customers:view', 'customers:view_contact', 'contact:view'] },
  delivery_staff: { label: 'Delivery Staff', permissions: ['delivery:view', 'delivery:update'] },
  custom: { label: 'Custom Role', permissions: [] },
};

// Order.orderType -> the permission that governs each action on that type of order.
export const ORDER_TYPE_PERMISSIONS = {
  normal: { view: 'orders:view', update: 'orders:update_status', cancel: 'orders:cancel' },
  preorder: { view: 'preorders:view', update: 'preorders:update', cancel: 'preorders:update' },
  bulk: { view: 'bulk:view', update: 'bulk:update', cancel: 'bulk:update' },
};

// Order.orderStatus values the Delivery Management page considers "eligible" — the order has reached
// (or finished) the delivery stage of the existing placed -> confirmed -> preparing -> out_for_delivery ->
// delivered workflow. "Ready" in the Delivery UI means orderStatus 'preparing'; no new status is added.
export const DELIVERY_ELIGIBLE_STATUSES = ['preparing', 'out_for_delivery', 'delivered'];

// The two forward steps a delivery:update holder may apply even without the order type's broader update
// permission (orders:update_status / preorders:update) — nothing else: not confirm/prepare, not cancel.
// Mirrored in frontend/src/utils/permissions.js and checked for drift in test/frontend-permissions.test.js.
export const DELIVERY_TRANSITIONS = { preparing: 'out_for_delivery', out_for_delivery: 'delivered' };

export function sanitizePermissions(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((entry) => PERMISSION_LIST.includes(entry)))];
}

// Strict validation for permission lists submitted by the owner: unknown names and missing
// prerequisites are reported instead of being silently dropped.
export function validatePermissionSet(list) {
  if (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string')) {
    return { ok: false, permissions: [], unknown: [], missing: [], error: 'Permissions must be a list of permission names.' };
  }
  const permissions = [...new Set(list)];
  const unknown = permissions.filter((entry) => !PERMISSION_LIST.includes(entry));
  const missing = [];
  for (const permission of permissions) {
    for (const required of REQUIRES[permission] || []) {
      if (!permissions.includes(required)) missing.push({ permission, requires: required });
    }
  }
  const ok = !unknown.length && !missing.length;
  let error = '';
  if (unknown.length) error = `Unknown permission${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`;
  else if (missing.length) error = missing.map((entry) => `"${entry.permission}" requires "${entry.requires}".`).join(' ');
  return { ok, permissions, unknown, missing, error };
}

// The permissions a user effectively holds right now, from the freshly loaded account.
export function permissionsOf(user) {
  if (!user || user.isActive === false) return new Set();
  if (user.role === 'admin') return new Set(PERMISSION_LIST);
  if (user.role !== 'staff') return new Set();
  const held = new Set(sanitizePermissions(user.permissions));
  return new Set([...held].filter((permission) => (REQUIRES[permission] || []).every((required) => held.has(required))));
}

export function hasPermission(user, permission) {
  return permissionsOf(user).has(permission);
}

export const isOwner = (user) => user?.role === 'admin' && user.isActive !== false;

// Order types this user may view.
export function viewableOrderTypes(user) {
  return Object.keys(ORDER_TYPE_PERMISSIONS).filter((type) => hasPermission(user, ORDER_TYPE_PERMISSIONS[type].view));
}

// Mongo `$in: [null]` also matches documents that predate the orderType field (they default to normal).
export function orderTypeCondition(types) {
  return { $in: types.includes('normal') ? [...types, null] : types };
}

export const canViewSupplierCosts = (user) => hasPermission(user, 'products:view') || hasPermission(user, 'products:manage');
