// Component-level access-control checks. No test framework or extra packages: Vite's SSR loader compiles the real
// components and react-dom/server renders them. The auth context is replaced by a stub that serves a chosen user,
// built with the same permission helpers the app uses. Run with: npm test
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
let server;
let renderToStaticMarkup;
let MemoryRouter;
let React;
let mods;

const authStub = `
import { createCan, hasPanelAccess, isOwnerAccount } from '/src/utils/permissions.js'
export function useAuth() {
  const state = globalThis.__testAuth || { user: null, authLoading: false }
  const user = state.user
  return { user, authLoading: state.authLoading, can: createCan(user), isOwner: isOwnerAccount(user), hasPanelAccess: hasPanelAccess(user), logout() {}, refreshUser: async () => user }
}
export function useToast() { return () => {} }
export function useCart() { return { cart: { items: [] } } }
`;

before(async () => {
  server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    plugins: [{
      name: 'auth-context-stub',
      enforce: 'pre',
      resolveId(source) { return source.endsWith('/context/AppContexts') || source.endsWith('/context/AppContexts.jsx') ? '\0auth-stub' : null; },
      load(id) { return id === '\0auth-stub' ? authStub : null; },
    }],
  });
  // Same module instances Vite externalises for the components, so React contexts and hooks line up.
  React = (await import('react')).default;
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  ({ MemoryRouter } = await import('react-router-dom'));
  mods = {
    RequirePermission: (await server.ssrLoadModule('/src/components/RequirePermission.jsx')).default,
    ProtectedRoute: (await server.ssrLoadModule('/src/components/ProtectedRoute.jsx')).default,
    AdminSidebar: (await server.ssrLoadModule('/src/components/AdminSidebar.jsx')).default,
    AdminHomePage: (await server.ssrLoadModule('/src/pages/AdminHomePage.jsx')).default,
    ForcePasswordChangePage: (await server.ssrLoadModule('/src/pages/ForcePasswordChangePage.jsx')).default,
    classifyAuthError: (await server.ssrLoadModule('/src/utils/sessionErrors.js')).classifyAuthError,
    OrderTable: (await server.ssrLoadModule('/src/pages/AdminOrderPages.jsx')).OrderTable,
    OrderDetailsModal: (await server.ssrLoadModule('/src/pages/AdminOrderPages.jsx')).OrderDetailsModal,
    AdminStaffPage: (await server.ssrLoadModule('/src/pages/AdminStaffPage.jsx')).default,
    PermissionGrid: (await server.ssrLoadModule('/src/components/PermissionGrid.jsx')).default,
    DeliveryProtectedRoute: (await server.ssrLoadModule('/src/components/DeliveryProtectedRoute.jsx')).default,
    DeliveryLayout: (await server.ssrLoadModule('/src/components/DeliveryLayout.jsx')).default,
    DeliveryDashboardPage: (await server.ssrLoadModule('/src/pages/DeliveryDashboardPage.jsx')).default,
    DeliveryCard: (await server.ssrLoadModule('/src/pages/DeliveryDashboardPage.jsx')).DeliveryCard,
    ConfirmDeliveredModal: (await server.ssrLoadModule('/src/pages/DeliveryDashboardPage.jsx')).ConfirmDeliveredModal,
    MyPermissions: (await server.ssrLoadModule('/src/pages/DeliveryDashboardPage.jsx')).MyPermissions,
    PermissionDetailModal: (await server.ssrLoadModule('/src/pages/DeliveryDashboardPage.jsx')).PermissionDetailModal,
    isDeliveryStaff: (await server.ssrLoadModule('/src/utils/permissions.js')).isDeliveryStaff,
    homeRedirectFor: (await server.ssrLoadModule('/src/utils/permissions.js')).homeRedirectFor,
    Layout: (await server.ssrLoadModule('/src/components/Layout.jsx')).default,
  };
});

after(async () => { await server?.close(); });

const owner = { role: 'admin', isActive: true, firstName: 'Janai', lastName: 'Admin' };
const customer = { role: 'customer', isActive: true, firstName: 'Cust', lastName: 'Omer' };
const staff = (permissions, extra = {}) => ({ role: 'staff', isActive: true, firstName: 'Sam', lastName: 'Staff', permissions, ...extra });

function render(element, user, { authLoading = false, path = '/admin' } = {}) {
  globalThis.__testAuth = { user, authLoading };
  const { createElement } = React;
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, element));
}
const h = (...args) => React.createElement(...args);

describe('RequirePermission', () => {
  const page = (props) => h(mods.RequirePermission, props, null);
  // Layout routes render an <Outlet/>; outside <Routes> it renders nothing, so the allowed state is "no Access denied".
  const denied = (user, props) => render(page(props), user).includes('Access denied');

  it('owner always passes; staff pass only with a matching permission; customers and anonymous are denied', () => {
    assert.equal(denied(owner, { any: ['orders:view'] }), false);
    assert.equal(denied(owner, { ownerOnly: true }), false);
    assert.equal(denied(staff(['orders:view']), { any: ['orders:view'] }), false);
    assert.equal(denied(staff(['bulk:view']), { any: ['orders:view'] }), true);
    assert.equal(denied(staff([]), { any: ['orders:view'] }), true);
    assert.equal(denied(staff(['orders:cancel']), { any: ['orders:cancel'] }), true); // missing prerequisite
    assert.equal(denied(staff(['bogus']), { any: ['bogus'] }), true);
    assert.equal(denied(staff(['orders:view']), { ownerOnly: true }), true);
    assert.equal(denied(customer, { any: ['orders:view'] }), true);
    assert.equal(denied(null, { any: ['orders:view'] }), true);
  });
});

describe('ProtectedRoute', () => {
  const protectedPage = (props) => h(mods.ProtectedRoute, props);

  it('shows a loader while the session is being checked', () => {
    assert.match(render(protectedPage({ admin: true }), null, { authLoading: true }), /Checking your Janai account/);
  });

  it('shows only the password-change screen while a temporary password is pending', () => {
    const html = render(protectedPage({ admin: true }), staff(['orders:view'], { mustChangePassword: true }));
    assert.match(html, /Choose a new password/);
    assert.match(html, /Temporary password/);
  });

  it('does not render anything for customers or anonymous visitors on admin routes', () => {
    for (const user of [customer, null]) {
      const html = render(protectedPage({ admin: true }), user);
      assert.ok(!html.includes('Choose a new password') && !html.includes('Access denied'));
    }
  });
});

describe('sidebar', () => {
  const links = (user) => [...render(h(mods.AdminSidebar, { open: true }), user).matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

  it('owner sees the full navigation including Staff & Access', () => {
    const owned = links(owner);
    for (const path of ['/admin', '/admin/orders', '/admin/pre-orders', '/admin/bulk-orders', '/admin/products', '/admin/customers', '/admin/staff', '/admin/settings']) assert.ok(owned.includes(path), path);
  });

  it('staff only see permitted sections, never Staff & Access', () => {
    const orderStaff = links(staff(['orders:view', 'orders:update_status']));
    assert.deepEqual(orderStaff.filter((path) => path.startsWith('/admin')), ['/admin/orders']);
    assert.ok(!links(staff(['customers:view'])).includes('/admin/staff'));
    assert.ok(!links(staff(['products:view', 'inventory:update'])).includes('/admin/orders'));
    assert.deepEqual(links(staff([])).filter((path) => path.startsWith('/admin')), []);
  });

  it('hides group headings whose items are all hidden', () => {
    const html = render(h(mods.AdminSidebar, { open: true }), staff(['orders:view']));
    assert.match(html, /ORDERS/);
    for (const heading of ['PRODUCTS', 'CUSTOMERS', 'OPERATIONS', 'BUSINESS']) assert.ok(!html.includes(heading), heading);
  });
});

describe('landing page', () => {
  it('staff with no permissions get an explanatory message and no data', () => {
    const html = render(h(mods.AdminHomePage), staff([]));
    assert.match(html, /No access assigned yet/);
  });

  it('staff with permissions are redirected (nothing from the dashboard is rendered)', () => {
    const html = render(h(mods.AdminHomePage), staff(['orders:view']));
    assert.ok(!html.includes('Admin Dashboard') && !html.includes('No access assigned yet'));
  });
});

describe('order actions', () => {
  const order = { _id: 'o1', orderType: 'normal', orderStatus: 'placed', user: { firstName: 'A', lastName: 'B' }, items: [], totalAmount: 100, createdAt: new Date().toISOString(), deliveryAddress: {} };
  const columns = ['id', 'status', 'actions'];
  const table = (user, o = order) => render(h(mods.OrderTable, { orders: [o], columns, onView() {}, onAdvance() {}, busyId: null }), user);

  it('the advance button needs the update permission for that order type', () => {
    assert.match(table(owner), /Confirm/);
    assert.match(table(staff(['orders:view', 'orders:update_status'])), /Confirm/);
    assert.ok(!/Confirm/.test(table(staff(['orders:view']))));
    assert.ok(!/Confirm/.test(table(staff(['preorders:view', 'preorders:update']))));
    assert.match(table(staff(['preorders:view', 'preorders:update']), { ...order, orderType: 'preorder' }), /Confirm/);
    assert.ok(!/Confirm/.test(table(staff(['orders:view', 'orders:update_status']), { ...order, orderType: 'preorder' })));
  });

  const modal = (user, o = order) => render(h(mods.OrderDetailsModal, { order: o, onClose() {}, onStatusChange() {}, busy: false }), user);

  it('the status editor and Cancelled option follow update and cancel permissions', () => {
    assert.match(modal(owner), /Update status/);
    assert.match(modal(owner), /Cancelled/);
    const noCancel = modal(staff(['orders:view', 'orders:update_status']));
    assert.match(noCancel, /Update status/);
    assert.ok(!/<option[^>]*>Cancelled</.test(noCancel));
    assert.ok(!/Update status/.test(modal(staff(['orders:view']))));
  });

  it('status history appears only when the backend supplied it', () => {
    assert.ok(!/Status history/.test(modal(owner)));
    const withHistory = { ...order, statusHistory: [{ fromStatus: 'placed', toStatus: 'confirmed', at: new Date().toISOString(), actor: { name: 'Sam Staff', loginId: 'sam', role: 'staff' } }] };
    assert.match(modal(owner, withHistory), /Status history/);
    assert.match(modal(owner, withHistory), /Sam Staff/);
  });
});

describe('Staff & Access page and permission grid', () => {
  it('the permission grid groups every module and flags the unavailable Delivery module', () => {
    const html = render(h(mods.PermissionGrid, { value: ['orders:view'], onChange() {} }), owner);
    for (const label of ['Orders', 'Pre Orders', 'Bulk Orders', 'Products', 'Inventory', 'Categories', 'Customers', 'Customer Contact Details', 'Contact Messages', 'Delivery']) assert.ok(html.includes(label), label);
    assert.match(html, /Module not available yet/);
    assert.match(html, /customers:view_contact/);
    assert.match(html, /requires “View orders”/);
    assert.match(html, /<input type="checkbox" checked=""/);
  });

  it('the page renders its loading state first and exposes no password fields', () => {
    const html = render(h(mods.AdminStaffPage), owner, { path: '/admin/staff' });
    assert.match(html, /Staff &amp; Access/);
    assert.match(html, /Add Staff/);
    assert.ok(!/type="password"/.test(html));
  });
});

describe('delivery portal: isDeliveryStaff', () => {
  it('requires role staff AND delivery:view — the owner is excluded even though it holds every permission', () => {
    assert.equal(mods.isDeliveryStaff(staff(['delivery:view', 'delivery:update'])), true);
    assert.equal(mods.isDeliveryStaff(staff(['delivery:view'])), true); // delivery:update not required just to view
    assert.equal(mods.isDeliveryStaff(staff(['orders:view'])), false);
    assert.equal(mods.isDeliveryStaff(staff([])), false);
    assert.equal(mods.isDeliveryStaff(owner), false, 'the owner is not role staff, so it must be excluded despite holding every permission');
    assert.equal(mods.isDeliveryStaff(customer), false);
    assert.equal(mods.isDeliveryStaff(null), false);
    assert.equal(mods.isDeliveryStaff(staff(['delivery:view'], { isActive: false })), false);
  });
});

describe('home redirect target for panel users (Layout + permissions)', () => {
  it('computes the right destination: delivery-only staff -> /delivery, everyone else with panel access -> /admin', () => {
    assert.equal(mods.homeRedirectFor(owner), '/admin');
    assert.equal(mods.homeRedirectFor(staff(['delivery:view'])), '/delivery');
    assert.equal(mods.homeRedirectFor(staff(['delivery:view', 'delivery:update'])), '/delivery');
    assert.equal(mods.homeRedirectFor(staff(['delivery:view', 'orders:view'])), '/admin', 'other admin-panel access keeps the existing /admin destination');
    assert.equal(mods.homeRedirectFor(staff([])), '/admin', 'zero-permission staff keep the existing /admin destination (unchanged behaviour)');
    assert.equal(mods.homeRedirectFor(staff(['delivery:view'], { isActive: false })), '/admin', 'not reached in practice since hasPanelAccess is already false, but must default safely, never to /delivery');
    assert.equal(mods.homeRedirectFor(customer), '/admin', 'not reached in practice since hasPanelAccess is already false for customers');
    assert.equal(mods.homeRedirectFor(null), '/admin');
  });

  it('Layout still redirects every panel user away from the customer homepage chrome, regardless of destination, and still shows it normally for a customer', () => {
    const deliveryOnlyHtml = render(h(mods.Layout, null), staff(['delivery:view']));
    assert.ok(!deliveryOnlyHtml.includes('site-header'), 'a delivery-only staff member must never see the customer homepage chrome');
    const ownerHtml = render(h(mods.Layout, null), owner);
    assert.ok(!ownerHtml.includes('site-header'), 'the owner must still be redirected away from the customer homepage, same as before');
    const customerHtml = render(h(mods.Layout, null), customer, { path: '/' });
    assert.match(customerHtml, /site-header/);
  });
});

describe('DeliveryProtectedRoute', () => {
  const page = () => h(mods.DeliveryProtectedRoute, null);

  it('shows a loader while the session is being checked', () => {
    assert.match(render(page(), null, { authLoading: true }), /Checking your delivery session/);
  });

  it('denies the owner, a customer, a non-delivery staff member — visiting the route directly must not grant access', () => {
    for (const user of [owner, customer, staff(['orders:view']), staff([])]) {
      assert.match(render(page(), user), /Delivery access required/, JSON.stringify(user));
    }
  });

  it('an anonymous visitor gets redirected (no access-denied message rendered)', () => {
    assert.ok(!render(page(), null).includes('Delivery access required'));
  });

  it('lets an active delivery staff member through (neither the loader nor the denial renders)', () => {
    const html = render(page(), staff(['delivery:view', 'delivery:update']));
    assert.ok(!html.includes('Checking your delivery session'));
    assert.ok(!html.includes('Delivery access required'));
  });

  it('a deactivated delivery staff account is denied just like any other ineligible account', () => {
    assert.match(render(page(), staff(['delivery:view', 'delivery:update'], { isActive: false })), /Delivery access required/);
  });
});

describe('DeliveryLayout', () => {
  it('shows the rider name and a delivery-partner label with a logout control, no admin sidebar markup', () => {
    const html = render(h(mods.DeliveryLayout, null), staff(['delivery:view'], { firstName: 'Ravi', lastName: 'Rider' }));
    assert.match(html, /Ravi Rider/);
    assert.match(html, /Delivery Partner/);
    assert.match(html, /Logout/);
    assert.ok(!html.includes('adm-sidebar'));
  });
});

describe('DeliveryDashboardPage', () => {
  it('renders its loading state first, before any order data arrives', () => {
    const html = render(h(mods.DeliveryDashboardPage), staff(['delivery:view', 'delivery:update']));
    assert.match(html, /Loading your deliveries/);
    assert.match(html, /My Deliveries/);
  });

  it('shows the "My Permissions" section populated from the real session permissions, with readable labels', () => {
    const html = render(h(mods.DeliveryDashboardPage), staff(['delivery:view', 'delivery:update']));
    assert.match(html, /My Permissions/);
    assert.match(html, /View Assigned Deliveries/);
    assert.match(html, /Update Delivery Status/);
  });

  it('a rider with only delivery:view sees that permission listed but not "Update Delivery Status" — nothing is ever shown as granted when it is not', () => {
    const html = render(h(mods.DeliveryDashboardPage), staff(['delivery:view']));
    assert.match(html, /View Assigned Deliveries/);
    assert.ok(!html.includes('Update Delivery Status'));
  });

  it('other, unrelated permissions the account happens to hold do not get fabricated delivery labels', () => {
    const html = render(h(mods.DeliveryDashboardPage), staff(['delivery:view', 'delivery:update', 'orders:view', 'products:manage']));
    assert.match(html, /View Assigned Deliveries/);
    assert.match(html, /Update Delivery Status/);
    // Only the two delivery permissions are ever rendered by this section, regardless of what else the account holds.
    const permSection = html.slice(html.indexOf('My Permissions'));
    assert.ok(!permSection.includes('orders:view') && !permSection.includes('products:manage'));
  });
});

describe('MyPermissions (direct)', () => {
  it('reads permissions dynamically from `can` — never hardcoded, never shows what is not granted', () => {
    const grantsBoth = (permission) => ['delivery:view', 'delivery:update'].includes(permission);
    const html = render(h(mods.MyPermissions, { can: grantsBoth }), null);
    assert.match(html, /View Assigned Deliveries/);
    assert.match(html, /Update Delivery Status/);
  });

  it('shows nothing extra when only delivery:view is granted', () => {
    const viewOnly = (permission) => permission === 'delivery:view';
    const html = render(h(mods.MyPermissions, { can: viewOnly }), null);
    assert.match(html, /View Assigned Deliveries/);
    assert.ok(!html.includes('Update Delivery Status'));
  });

  it('renders nothing at all when no delivery permission is granted (defensive — the route guard should already prevent this)', () => {
    const html = render(h(mods.MyPermissions, { can: () => false }), null);
    assert.ok(!html.includes('My Permissions'));
  });

  it('each pill is a real, keyboard-accessible <button> with an onClick wired — never a clickable <div> or <span>', () => {
    const html = render(h(mods.MyPermissions, { can: () => true }), null);
    const pills = [...html.matchAll(/<(button|span|div)[^>]*class="rider-permission-pill"[^>]*>/g)];
    assert.equal(pills.length, 2);
    assert.ok(pills.every((match) => match[1] === 'button'), 'every pill must be a <button>, not a <div>/<span>');
    assert.ok(pills.every((match) => match[0].includes('type="button"')));
  });
});

describe('PermissionDetailModal (the popup a pill click opens)', () => {
  const viewItem = { permission: 'delivery:view', label: 'View Assigned Deliveries', description: 'Lets you see the orders currently assigned to you — customer name and phone, delivery address, schedule and payment details.' };
  const updateItem = { permission: 'delivery:update', label: 'Update Delivery Status', description: 'Lets you move your assigned orders forward: starting delivery (Ready → Out for Delivery) and marking an order as Delivered.' };

  it('explains delivery:view in plain language and shows its exact permission code', () => {
    const html = render(h(mods.PermissionDetailModal, { item: viewItem, onClose() {} }), null);
    assert.match(html, /View Assigned Deliveries/);
    assert.match(html, /view their assigned deliveries|see the orders currently assigned to you/i);
    assert.match(html, /<code>delivery:view<\/code>/);
    assert.match(html, /Close/);
  });

  it('explains delivery:update in plain language, mentioning starting delivery and marking as delivered, with its exact permission code', () => {
    const html = render(h(mods.PermissionDetailModal, { item: updateItem, onClose() {} }), null);
    assert.match(html, /Update Delivery Status/);
    assert.match(html, /starting delivery/i);
    assert.match(html, /[Mm]arking (an order )?as [Dd]elivered/);
    assert.match(html, /<code>delivery:update<\/code>/);
  });

  it('reuses the shared Modal, so Escape-to-close and click-outside-to-close already work the same as everywhere else in the app', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/DeliveryDashboardPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /PermissionDetailModal[\s\S]*?<Modal /);
    const uiSource = readFileSync(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
    assert.match(uiSource, /key === 'Escape'/, 'Modal must still close on Escape');
    assert.match(uiSource, /adm-modal-overlay[\s\S]*?onClick=\{onClose\}/, 'Modal must still close on an outside click');
  });
});

describe('delivery action cards', () => {
  const baseOrder = {
    _id: 'order123456', orderType: 'normal', orderStatus: 'preparing', totalAmount: 250,
    paymentMethod: 'cod', paymentStatus: 'pending', deliveryDate: new Date().toISOString(), preferredTimeSlot: '',
    user: { firstName: 'Cust', lastName: 'Omer', phone: '9876543210' },
    deliveryAddress: { recipient: 'Cust Omer', phone: '9876543210', house: 'H1', street: 'Street', city: 'City', postalCode: '411001' },
  };
  const card = (order, props = {}) => render(h(mods.DeliveryCard, { order, busy: false, canUpdate: true, onAdvance() {}, ...props }), null);

  it('shows "Start Delivery" for a preparing order and "Mark as Delivered" for one out for delivery, never both', () => {
    assert.match(card(baseOrder), /Start Delivery/);
    assert.ok(!card(baseOrder).includes('Mark as Delivered'));
    const outForDelivery = { ...baseOrder, orderStatus: 'out_for_delivery' };
    assert.match(card(outForDelivery), /Mark as Delivered/);
    assert.ok(!card(outForDelivery).includes('Start Delivery'));
  });

  it('shows no delivery-stage action once an order is delivered (navigation is still offered)', () => {
    const html = card({ ...baseOrder, orderStatus: 'delivered' });
    assert.ok(!html.includes('Start Delivery') && !html.includes('Mark as Delivered'));
    assert.match(html, /Open Navigation/);
  });

  it('never renders an action button for a rider who only holds delivery:view (no delivery:update) — the backend would reject it anyway, so the UI must not offer it', () => {
    const html = card(baseOrder, { canUpdate: false });
    assert.ok(!html.includes('Start Delivery') && !html.includes('Mark as Delivered'));
    assert.match(html, /Open Navigation/, 'navigation has no permission requirement and must still work');
  });

  it('shows the real customer phone as a tel: link when the backend provided one (the assigned-rider case)', () => {
    assert.match(card(baseOrder), /href="tel:\+919876543210"/);
  });

  it('falls back to a plain message when no customer phone is available, never fabricating one', () => {
    const html = card({ ...baseOrder, user: { firstName: 'Cust', lastName: 'Omer' }, deliveryAddress: { ...baseOrder.deliveryAddress, phone: undefined } });
    assert.match(html, /Phone not available/);
    assert.ok(!html.includes('tel:'));
  });

  it('disables the action button and shows "Updating…" while a request for this order is in flight', () => {
    const html = card(baseOrder, { busy: true });
    assert.match(html, /Updating…/);
    assert.match(html, /disabled=""/);
  });
});

describe('ConfirmDeliveredModal', () => {
  const order = { _id: 'order123456', user: { firstName: 'Cust', lastName: 'Omer' }, deliveryAddress: {} };

  it('names the customer and asks for confirmation, disabling both buttons while busy', () => {
    const html = render(h(mods.ConfirmDeliveredModal, { order, busy: false, onClose() {}, onConfirm() {} }), null);
    assert.match(html, /Cust Omer/);
    assert.match(html, /mark as delivered/i);
    const busyHtml = render(h(mods.ConfirmDeliveredModal, { order, busy: true, onClose() {}, onConfirm() {} }), null);
    assert.match(busyHtml, /Updating…/);
  });
});

describe('session error handling', () => {
  const failure = (status, url, data = {}) => ({ response: { status, data }, config: { url } });

  it('signs out when an authenticated request is rejected as unauthorised', () => {
    assert.equal(mods.classifyAuthError(failure(401, '/admin/orders'), true), 'sign-out');
    assert.equal(mods.classifyAuthError(failure(401, '/auth/me'), true), 'sign-out');
  });

  it('does not treat a wrong password or a signed-out visitor as an expired session', () => {
    for (const url of ['/auth/login', '/auth/admin-login', '/auth/verify-login-otp', '/auth/change-password']) assert.equal(mods.classifyAuthError(failure(401, url), true), null, url);
    assert.equal(mods.classifyAuthError(failure(401, '/admin/orders'), false), null);
  });

  it('does not treat a wrong/expired delivery OTP as an expired session either (a stale allowlist here would spuriously sign out an unrelated, still-valid session on the same browser)', () => {
    for (const url of ['/auth/send-delivery-otp', '/auth/resend-delivery-otp', '/auth/verify-delivery-otp']) assert.equal(mods.classifyAuthError(failure(401, url), true), null, url);
  });

  it('re-reads the account when a password change is required, and ignores other 403s', () => {
    assert.equal(mods.classifyAuthError(failure(403, '/admin/orders', { code: 'PASSWORD_CHANGE_REQUIRED' }), true), 'refresh-user');
    assert.equal(mods.classifyAuthError(failure(403, '/admin/orders', { message: 'nope' }), true), null);
    assert.equal(mods.classifyAuthError(failure(500, '/admin/orders'), true), null);
    assert.equal(mods.classifyAuthError({}, true), null);
  });
});
