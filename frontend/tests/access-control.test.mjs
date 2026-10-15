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

  it('re-reads the account when a password change is required, and ignores other 403s', () => {
    assert.equal(mods.classifyAuthError(failure(403, '/admin/orders', { code: 'PASSWORD_CHANGE_REQUIRED' }), true), 'refresh-user');
    assert.equal(mods.classifyAuthError(failure(403, '/admin/orders', { message: 'nope' }), true), null);
    assert.equal(mods.classifyAuthError(failure(500, '/admin/orders'), true), null);
    assert.equal(mods.classifyAuthError({}, true), null);
  });
});
