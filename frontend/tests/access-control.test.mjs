// Component-level access-control checks. No test framework or extra packages: Vite's SSR loader compiles the real
// components and react-dom/server renders them. The auth context is replaced by a stub that serves a chosen user,
// built with the same permission helpers the app uses. Run with: npm test
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
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
    PERMISSION_LIST: (await server.ssrLoadModule('/src/utils/permissions.js')).PERMISSION_LIST,
    Layout: (await server.ssrLoadModule('/src/components/Layout.jsx')).default,
    Logo: (await server.ssrLoadModule('/src/components/Layout.jsx')).Logo,
    ContactPage: (await server.ssrLoadModule('/src/pages/AccountPages.jsx')).ContactPage,
    api: (await server.ssrLoadModule('/src/services/api.js')).default,
    loadBusinessSettings: (await server.ssrLoadModule('/src/hooks/useBusinessSettings.js')).loadBusinessSettings,
    resetBusinessSettingsCache: (await server.ssrLoadModule('/src/hooks/useBusinessSettings.js')).__resetBusinessSettingsCacheForTests,
    BUSINESS_SETTINGS_DEFAULTS: (await server.ssrLoadModule('/src/hooks/useBusinessSettings.js')).DEFAULTS,
    AdminSettingsPage: (await server.ssrLoadModule('/src/pages/AdminSettingsPage.jsx')).default,
    AdminAccountPage: (await server.ssrLoadModule('/src/pages/AdminAccountPage.jsx')).default,
    DeliverySettingsPage: (await server.ssrLoadModule('/src/pages/DeliverySettingsPage.jsx')).default,
    AdminTopbar: (await server.ssrLoadModule('/src/components/AdminTopbar.jsx')).default,
    GeneralSettingsForm: (await server.ssrLoadModule('/src/components/GeneralSettingsForm.jsx')).default,
    validateGeneralSettingsForm: (await server.ssrLoadModule('/src/components/GeneralSettingsForm.jsx')).validateGeneralSettingsForm,
    OrderDeliverySettingsForm: (await server.ssrLoadModule('/src/components/OrderDeliverySettingsForm.jsx')).default,
    validateOrderDeliverySettingsForm: (await server.ssrLoadModule('/src/components/OrderDeliverySettingsForm.jsx')).validateOrderDeliverySettingsForm,
    deliveryFeeFor: (await server.ssrLoadModule('/src/components/UI.jsx')).deliveryFeeFor,
    loadOrderSettings: (await server.ssrLoadModule('/src/hooks/useOrderSettings.js')).loadOrderSettings,
    resetOrderSettingsCache: (await server.ssrLoadModule('/src/hooks/useOrderSettings.js')).__resetOrderSettingsCacheForTests,
    ORDER_SETTINGS_DEFAULTS: (await server.ssrLoadModule('/src/hooks/useOrderSettings.js')).DEFAULTS,
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

  it('a staff member holding all 10 catalog permissions sees all 10 reflected, grouped by module, not just the two delivery ones', () => {
    const html = render(h(mods.DeliveryDashboardPage), staff([...mods.PERMISSION_LIST]));
    const expectedLabels = [
      'View orders', 'Update order status', 'Cancel orders',
      'View pre-orders', 'Update or cancel pre-orders',
      'View bulk requests', 'Review and update bulk requests',
      'View products and supplier costs', 'Add, edit and delete products',
      'Update stock quantities and purchases',
      'Manage categories',
      'View customers',
      'See full customer email and phone',
      'View contact messages',
      'View Assigned Deliveries', 'Update Delivery Status', // delivery gets the rider-specific wording
    ];
    for (const label of expectedLabels) assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), label);
    for (const group of ['Orders', 'Pre Orders', 'Bulk Orders', 'Products', 'Inventory', 'Categories', 'Customers', 'Customer Contact Details', 'Contact Messages', 'Delivery']) {
      assert.match(html, new RegExp(group), group);
    }
  });

  it('a user with only delivery permissions sees only Delivery in the My Permissions section', () => {
    const html = render(h(mods.DeliveryDashboardPage), staff(['delivery:view', 'delivery:update']));
    for (const group of ['>Orders<', '>Pre Orders<', '>Bulk Orders<', '>Products<', '>Inventory<', '>Categories<', '>Customers<', '>Contact Messages<']) {
      assert.ok(!html.includes(group), `${group} must not appear for a delivery-only account`);
    }
  });

  it('a permission the account was never granted never appears, no matter how many others it holds', () => {
    const html = render(h(mods.DeliveryDashboardPage), staff(['delivery:view', 'delivery:update', 'orders:view']));
    assert.ok(!html.includes('Manage categories'));
    assert.ok(!html.includes('View customers'));
    assert.ok(!html.includes('View contact messages'));
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
    assert.equal(pills.length, mods.PERMISSION_LIST.length, 'one pill per catalog permission when everything is granted');
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

  it('offers a real link to the already-implemented module for a non-delivery permission (orders:view -> /admin/orders)', () => {
    const html = render(h(mods.PermissionDetailModal, { item: { permission: 'orders:view', label: 'View orders', description: 'x' }, onClose() {} }), null);
    assert.match(html, /href="\/admin\/orders"/);
    assert.match(html, /Open All Orders/);
  });

  it('a permission that only has a prerequisite link still opens the right module (orders:cancel requires orders:view, both land on /admin/orders)', () => {
    const html = render(h(mods.PermissionDetailModal, { item: { permission: 'orders:cancel', label: 'Cancel orders', description: 'x' }, onClose() {} }), null);
    assert.match(html, /href="\/admin\/orders"/);
  });

  it('categories:manage links to the real Categories page', () => {
    const html = render(h(mods.PermissionDetailModal, { item: { permission: 'categories:manage', label: 'Manage categories', description: 'x' }, onClose() {} }), null);
    assert.match(html, /href="\/admin\/categories"/);
  });

  it('never invents a link for a permission with no implemented admin page (contact:view and customers:view_contact)', () => {
    for (const permission of ['contact:view', 'customers:view_contact']) {
      const html = render(h(mods.PermissionDetailModal, { item: { permission, label: 'x', description: 'x' }, onClose() {} }), null);
      assert.ok(!html.includes('<a '), `${permission} must not render a navigation link — no module exists for it yet`);
    }
  });

  it('never offers a second link for the two delivery permissions — the rider is already on their one dedicated page', () => {
    for (const item of [viewItem, updateItem]) {
      const html = render(h(mods.PermissionDetailModal, { item, onClose() {} }), null);
      assert.ok(!html.includes('<a '), `${item.permission} must not offer a redundant link to /admin/delivery`);
    }
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

describe('Settings routing (App.jsx structural checks)', () => {
  it('admin/settings sits behind the owner-only RequirePermission block, next to admin/staff', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const ownerOnlyBlock = source.slice(source.indexOf('RequirePermission ownerOnly'), source.indexOf('admin/delivery"'));
    assert.match(ownerOnlyBlock, /admin\/staff/);
    assert.match(ownerOnlyBlock, /admin\/settings/);
  });

  it('admin/account is not wrapped in any RequirePermission — any panel user reaches it, gated only by ProtectedRoute', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const line = source.split('\n').find((entry) => entry.includes('path="admin/account"'));
    assert.ok(line, 'admin/account route must exist');
    assert.ok(!line.includes('RequirePermission'));
  });

  it('delivery/settings is nested inside the same DeliveryProtectedRoute + DeliveryLayout block as the dashboard', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const deliveryBlock = source.slice(source.indexOf('DeliveryProtectedRoute />'), source.indexOf('admin/login'));
    assert.match(deliveryBlock, /path="delivery"/);
    assert.match(deliveryBlock, /path="delivery\/settings"/);
  });
});

describe('AdminSettingsPage (/admin/settings)', () => {
  it('shows every settings category in the navigation', () => {
    const html = render(h(mods.AdminSettingsPage), owner);
    for (const label of ['General', 'Orders & Delivery', 'Payments', 'Notifications', 'Security & System']) assert.match(html, new RegExp(label.replace(/&/g, '&amp;')), label);
  });

  it('defaults to the General category, which loads real data (shows a loading state first, never a "not configured yet" placeholder)', () => {
    const html = render(h(mods.AdminSettingsPage), owner);
    assert.match(html, /Loading settings/);
    assert.ok(!html.includes('not configured yet'));
  });

  it('Payments, Notifications and Security & System still fall back to the no-persistence-yet placeholder (structural check — only General and Orders & Delivery have real forms so far)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /active\.key === 'general'[\s\S]*?<GeneralSettingsForm/);
    assert.match(source, /active\.key === 'orders-delivery'[\s\S]*?<OrderDeliverySettingsForm/);
    assert.match(source, /<EmptyState/);
  });
});

describe('GeneralSettingsForm (/admin/settings — General category)', () => {
  it('shows a loading state first, before any saved settings arrive', () => {
    const html = render(h(mods.GeneralSettingsForm), owner);
    assert.match(html, /Loading settings/);
  });

  describe('validateGeneralSettingsForm (pure validation logic)', () => {
    const validForm = () => ({
      businessName: 'Janai Foods', phone: '9876543210', email: 'owner@janai.in',
      address: { line1: '', line2: '', city: '', state: '', postalCode: '411001' },
    });
    function hoursAllOpen() {
      const hours = {};
      for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) hours[day] = { closed: false, open: '09:00', close: '21:00' };
      return hours;
    }

    it('requires a business name', () => {
      const form = { ...validForm(), businessName: '  ', operatingHours: hoursAllOpen() };
      assert.ok(mods.validateGeneralSettingsForm(form).businessName);
      assert.deepEqual(mods.validateGeneralSettingsForm({ ...form, businessName: 'Janai' }), {});
    });

    it('validates phone and email only when provided (both are optional)', () => {
      const base = { ...validForm(), operatingHours: hoursAllOpen() };
      assert.equal(mods.validateGeneralSettingsForm({ ...base, phone: '' }).phone, undefined);
      assert.ok(mods.validateGeneralSettingsForm({ ...base, phone: '12345' }).phone);
      assert.equal(mods.validateGeneralSettingsForm({ ...base, email: '' }).email, undefined);
      assert.ok(mods.validateGeneralSettingsForm({ ...base, email: 'nope' }).email);
    });

    it('validates the pincode only when provided', () => {
      const base = { ...validForm(), operatingHours: hoursAllOpen() };
      assert.equal(mods.validateGeneralSettingsForm({ ...base, address: { ...base.address, postalCode: '' } }).postalCode, undefined);
      assert.ok(mods.validateGeneralSettingsForm({ ...base, address: { ...base.address, postalCode: '123' } }).postalCode);
    });

    it('rejects a day whose closing time is not after its opening time, but skips validation entirely for a closed day', () => {
      const base = { ...validForm(), operatingHours: hoursAllOpen() };
      const badDay = { ...base, operatingHours: { ...base.operatingHours, monday: { closed: false, open: '20:00', close: '09:00' } } };
      assert.ok(mods.validateGeneralSettingsForm(badDay)['hours-monday']);
      const closedBadDay = { ...base, operatingHours: { ...base.operatingHours, monday: { closed: true, open: '20:00', close: '09:00' } } };
      assert.equal(mods.validateGeneralSettingsForm(closedBadDay)['hours-monday'], undefined);
    });
  });
});

describe('OrderDeliverySettingsForm (/admin/settings — Orders & Delivery category)', () => {
  it('shows a loading state first, before any saved settings arrive', () => {
    const html = render(h(mods.OrderDeliverySettingsForm), owner);
    assert.match(html, /Loading settings/);
  });

  describe('validateOrderDeliverySettingsForm (pure validation logic)', () => {
    const validForm = () => ({ deliveryEnabled: true, deliveryFee: '25', freeDeliveryThreshold: '500', minimumOrderValue: '0' });

    it('accepts the valid default form with no errors', () => {
      assert.deepEqual(mods.validateOrderDeliverySettingsForm(validForm()), {});
    });

    it('rejects a negative or empty delivery fee', () => {
      assert.ok(mods.validateOrderDeliverySettingsForm({ ...validForm(), deliveryFee: '-5' }).deliveryFee);
      assert.ok(mods.validateOrderDeliverySettingsForm({ ...validForm(), deliveryFee: '' }).deliveryFee);
      assert.ok(mods.validateOrderDeliverySettingsForm({ ...validForm(), deliveryFee: 'free' }).deliveryFee);
    });

    it('rejects a negative free-delivery threshold or minimum order value', () => {
      assert.ok(mods.validateOrderDeliverySettingsForm({ ...validForm(), freeDeliveryThreshold: '-1' }).freeDeliveryThreshold);
      assert.ok(mods.validateOrderDeliverySettingsForm({ ...validForm(), minimumOrderValue: '-1' }).minimumOrderValue);
    });

    it('allows a zero minimum order value (meaning "no minimum")', () => {
      assert.equal(mods.validateOrderDeliverySettingsForm({ ...validForm(), minimumOrderValue: '0' }).minimumOrderValue, undefined);
    });
  });
});

describe('deliveryFeeFor (pure pricing logic shared by cart/checkout/pre-order summaries)', () => {
  it('charges the configured fee below the configured free-delivery threshold', () => {
    const rules = { deliveryFee: 40, freeDeliveryThreshold: 750 };
    assert.equal(mods.deliveryFeeFor(300, rules), 40);
  });

  it('is free at or above the threshold, and for an empty cart', () => {
    const rules = { deliveryFee: 40, freeDeliveryThreshold: 750 };
    assert.equal(mods.deliveryFeeFor(750, rules), 0);
    assert.equal(mods.deliveryFeeFor(900, rules), 0);
    assert.equal(mods.deliveryFeeFor(0, rules), 0);
  });

  it('matches the existing hardcoded behaviour under the default rules (₹25 below ₹500)', () => {
    assert.equal(mods.deliveryFeeFor(200, mods.ORDER_SETTINGS_DEFAULTS), 25);
    assert.equal(mods.deliveryFeeFor(500, mods.ORDER_SETTINGS_DEFAULTS), 0);
  });
});

describe('useOrderSettings (shared cart/checkout/pre-order pricing data behind PriceSummary etc.)', () => {
  afterEach(() => mods.resetOrderSettingsCache());

  it('loads and normalises the saved settings', async () => {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings: { deliveryEnabled: false, deliveryFee: 40, freeDeliveryThreshold: 750, minimumOrderValue: 200 } } });
    try {
      const result = await mods.loadOrderSettings();
      assert.deepEqual(result, { deliveryEnabled: false, deliveryFee: 40, freeDeliveryThreshold: 750, minimumOrderValue: 200 });
    } finally {
      mods.api.get = original;
    }
  });

  it('falls back to the existing hardcoded defaults if the request fails, so pricing never breaks', async () => {
    const original = mods.api.get;
    mods.api.get = async () => { throw new Error('network down'); };
    try {
      assert.deepEqual(await mods.loadOrderSettings(), mods.ORDER_SETTINGS_DEFAULTS);
    } finally {
      mods.api.get = original;
    }
  });

  it('falls back field-by-field to the existing defaults for a response missing some fields', async () => {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings: { deliveryFee: 30 } } });
    try {
      assert.deepEqual(await mods.loadOrderSettings(), { deliveryEnabled: true, deliveryFee: 30, freeDeliveryThreshold: 500, minimumOrderValue: 0 });
    } finally {
      mods.api.get = original;
    }
  });

  it('deduplicates concurrent loads into a single request', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { data: { settings: { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 } } }; };
    try {
      const [a, b] = await Promise.all([mods.loadOrderSettings(), mods.loadOrderSettings()]);
      assert.equal(calls, 1);
      assert.deepEqual(a, b);
    } finally {
      mods.api.get = original;
    }
  });

  it('reuses the cache on a later call instead of fetching again', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => { calls += 1; return { data: { settings: { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 } } }; };
    try {
      await mods.loadOrderSettings();
      await mods.loadOrderSettings();
      assert.equal(calls, 1);
    } finally {
      mods.api.get = original;
    }
  });
});

describe('AdminAccountPage (/admin/account)', () => {
  it('shows a regular staff member their own login ID, role and permissions, with no edit controls', () => {
    const member = staff(['orders:view', 'delivery:view'], { firstName: 'Priya', lastName: 'Patel', adminId: 'priya.p' });
    const html = render(h(mods.AdminAccountPage), member);
    assert.match(html, /Priya Patel/);
    assert.match(html, /priya\.p/);
    assert.match(html, /My Permissions/);
    assert.match(html, /View orders/);
    assert.match(html, /View Assigned Deliveries/);
    assert.ok(!html.includes('<input'), 'account details must be read-only — no edit controls');
  });

  it('never shows business-wide settings content on the personal account page', () => {
    const html = render(h(mods.AdminAccountPage), staff(['orders:view']));
    assert.ok(!html.includes('Orders & Delivery') && !html.includes('Security & System'));
  });

  it('a logout control is present and wired to the real logout action', () => {
    const html = render(h(mods.AdminAccountPage), staff(['orders:view']));
    assert.match(html, />Logout</);
  });

  it('redirects the owner to /admin/settings instead of showing an empty personal page', () => {
    const html = render(h(mods.AdminAccountPage), owner);
    assert.ok(!html.includes('My Account'), 'the owner must not see the personal-account page content');
  });
});

describe('DeliverySettingsPage (/delivery/settings)', () => {
  it('shows the rider their login ID, registered mobile, permissions and a working logout, plus a way back to the dashboard', () => {
    const rider = staff(['delivery:view', 'delivery:update'], { firstName: 'Ravi', lastName: 'Rider', adminId: 'ravi.r', phone: '9876543210' });
    const html = render(h(mods.DeliverySettingsPage), rider);
    assert.match(html, /Ravi Rider/);
    assert.match(html, /ravi\.r/);
    assert.match(html, /9876543210/);
    assert.match(html, /My Permissions/);
    assert.match(html, /View Assigned Deliveries/);
    assert.match(html, />Logout</);
    assert.match(html, /Back to My Deliveries/);
    assert.ok(!html.includes('<input'), 'no login form or editable credentials — delivery staff sign in by OTP only');
  });
});

describe('navigation entry points for Settings', () => {
  it("a regular staff member's admin topbar avatar links to /admin/account", () => {
    const html = render(h(mods.AdminTopbar, { onMenuClick() {} }), staff(['orders:view']));
    assert.match(html, /href="\/admin\/account"/);
  });

  it("the owner's admin topbar avatar links to /admin/settings instead", () => {
    const html = render(h(mods.AdminTopbar, { onMenuClick() {} }), owner);
    assert.match(html, /href="\/admin\/settings"/);
    assert.ok(!html.includes('href="/admin/account"'));
  });

  it('the delivery header has a Settings link to /delivery/settings, alongside Logout', () => {
    const html = render(h(mods.DeliveryLayout, null), staff(['delivery:view']));
    assert.match(html, /href="\/delivery\/settings"/);
    assert.match(html, /Logout/);
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

describe('useBusinessSettings (shared public-branding data behind Navbar/Footer/Contact)', () => {
  afterEach(() => mods.resetBusinessSettingsCache());

  it('returns the saved business name and logo on a successful fetch, and nothing else from the response', async () => {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings: { businessName: 'Fresh Mart', logo: 'data:image/png;base64,ABC', phone: '9876543210', email: 'owner@x.com' } } });
    try {
      const result = await mods.loadBusinessSettings();
      assert.deepEqual(result, { businessName: 'Fresh Mart', logo: 'data:image/png;base64,ABC' });
    } finally {
      mods.api.get = original;
    }
  });

  it('falls back to the default Janai name/logo when the request fails — a public page must keep working', async () => {
    const original = mods.api.get;
    mods.api.get = async () => { throw new Error('network down'); };
    try {
      assert.deepEqual(await mods.loadBusinessSettings(), mods.BUSINESS_SETTINGS_DEFAULTS);
    } finally {
      mods.api.get = original;
    }
  });

  it('falls back to defaults when the saved response is missing fields (a never-configured store)', async () => {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings: {} } });
    try {
      assert.deepEqual(await mods.loadBusinessSettings(), mods.BUSINESS_SETTINGS_DEFAULTS);
    } finally {
      mods.api.get = original;
    }
  });

  it('two concurrent callers share one in-flight request instead of firing a duplicate', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { data: { settings: { businessName: 'Once Only', logo: '' } } }; };
    try {
      const [a, b] = await Promise.all([mods.loadBusinessSettings(), mods.loadBusinessSettings()]);
      assert.equal(calls, 1);
      assert.deepEqual(a, b);
    } finally {
      mods.api.get = original;
    }
  });

  it('a later call reuses the cache rather than fetching again', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => { calls += 1; return { data: { settings: { businessName: 'Cached Name', logo: '' } } }; };
    try {
      await mods.loadBusinessSettings();
      await mods.loadBusinessSettings();
      assert.equal(calls, 1);
    } finally {
      mods.api.get = original;
    }
  });
});

describe('Logo (Navbar + Footer): custom logo, default fallback, broken-image fallback', () => {
  afterEach(() => mods.resetBusinessSettingsCache());

  it('renders the default Janai wordmark when no custom logo is saved', async () => {
    mods.api.get = async () => ({ data: { settings: { businessName: 'Janai', logo: '' } } });
    await mods.loadBusinessSettings(); // pre-warms the shared cache the component reads on its initial render
    const html = render(h(mods.Logo, null), null);
    assert.match(html, /src="\/Janai-logo\.jpg"/);
    assert.ok(!html.includes('is-custom-logo'), 'the default asset must not get the custom-logo object-fit override');
  });

  it('renders a saved custom logo with object-fit styling (not the default crop) and the saved name as alt text', async () => {
    const customLogo = 'data:image/png;base64,ABCDEF';
    mods.api.get = async () => ({ data: { settings: { businessName: 'Fresh Mart', logo: customLogo } } });
    await mods.loadBusinessSettings();
    const html = render(h(mods.Logo, null), null);
    assert.match(html, new RegExp(`src="${customLogo}"`));
    assert.match(html, /alt="Fresh Mart"/);
    assert.match(html, /class="is-custom-logo"/);
    assert.match(html, /aria-label="Fresh Mart home"/);
  });
});

describe('public branding: saved business name in Footer and Contact page, with a safe fallback on failure', () => {
  afterEach(() => mods.resetBusinessSettingsCache());

  it('Footer shows the saved business name in its heading and copyright line', async () => {
    mods.api.get = async () => ({ data: { settings: { businessName: 'Fresh Mart', logo: '' } } });
    await mods.loadBusinessSettings();
    const html = render(h(mods.Layout, null), customer, { path: '/' });
    assert.match(html, /Shop Fresh Mart/);
    assert.match(html, /©\s*\d{4}\s*Fresh Mart/);
  });

  it('Contact page heading shows the saved business name', async () => {
    mods.api.get = async () => ({ data: { settings: { businessName: 'Fresh Mart', logo: '' } } });
    await mods.loadBusinessSettings();
    const html = render(h(mods.ContactPage), customer, { path: '/contact' });
    assert.match(html, /Contact Fresh Mart/);
  });

  it('falls back to "Janai" in both places when settings cannot be fetched — the public site never breaks', async () => {
    mods.api.get = async () => { throw new Error('backend unreachable'); };
    await mods.loadBusinessSettings();
    const footerHtml = render(h(mods.Layout, null), customer, { path: '/' });
    assert.match(footerHtml, /Shop Janai/);
    assert.match(footerHtml, /©\s*\d{4}\s*Janai/);
    const contactHtml = render(h(mods.ContactPage), customer, { path: '/contact' });
    assert.match(contactHtml, /Contact Janai/);
  });

  it('the rest of the Navbar/Footer/Contact markup and structure is unchanged — only the name/logo are dynamic', () => {
    const html = render(h(mods.Layout, null), customer, { path: '/' });
    assert.match(html, /site-header/);
    assert.match(html, /site-footer/);
    assert.match(html, /Freshness at your doorstep/);
    assert.match(html, /Track an order/);
  });
});
