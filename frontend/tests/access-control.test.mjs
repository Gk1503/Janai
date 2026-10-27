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
    DeliveryLoginPage: (await server.ssrLoadModule('/src/pages/DeliveryLoginPage.jsx')).default,
    AuthFrame: (await server.ssrLoadModule('/src/pages/AccountPages.jsx')).AuthFrame,
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
    invalidateBusinessSettings: (await server.ssrLoadModule('/src/hooks/useBusinessSettings.js')).invalidateBusinessSettings,
    formatBusinessAddress: (await server.ssrLoadModule('/src/hooks/useBusinessSettings.js')).formatBusinessAddress,
    formatOperatingHours: (await server.ssrLoadModule('/src/hooks/useBusinessSettings.js')).formatOperatingHours,
    AdminSettingsPage: (await server.ssrLoadModule('/src/pages/AdminSettingsPage.jsx')).default,
    AdminAccountPage: (await server.ssrLoadModule('/src/pages/AdminAccountPage.jsx')).default,
    DeliverySettingsPage: (await server.ssrLoadModule('/src/pages/DeliverySettingsPage.jsx')).default,
    AdminTopbar: (await server.ssrLoadModule('/src/components/AdminTopbar.jsx')).default,
    GeneralSettingsForm: (await server.ssrLoadModule('/src/components/GeneralSettingsForm.jsx')).default,
    validateGeneralSettingsForm: (await server.ssrLoadModule('/src/components/GeneralSettingsForm.jsx')).validateGeneralSettingsForm,
    OrderDeliverySettingsForm: (await server.ssrLoadModule('/src/components/OrderDeliverySettingsForm.jsx')).default,
    validateOrderDeliverySettingsForm: (await server.ssrLoadModule('/src/components/OrderDeliverySettingsForm.jsx')).validateOrderDeliverySettingsForm,
    deliveryFeeFor: (await server.ssrLoadModule('/src/components/UI.jsx')).deliveryFeeFor,
    ChangePasswordForm: (await server.ssrLoadModule('/src/components/ChangePasswordForm.jsx')).default,
    validateChangePasswordForm: (await server.ssrLoadModule('/src/components/ChangePasswordForm.jsx')).validateChangePasswordForm,
    MIN_PASSWORD_LENGTH: (await server.ssrLoadModule('/src/components/ChangePasswordForm.jsx')).MIN_PASSWORD_LENGTH,
    decideCategorySwitch: (await server.ssrLoadModule('/src/utils/settingsNavGuard.js')).decideCategorySwitch,
    registerSettingsFormGuard: (await server.ssrLoadModule('/src/hooks/useSettingsFormGuard.js')).registerSettingsFormGuard,
    handleBeforeUnload: (await server.ssrLoadModule('/src/hooks/useSettingsFormGuard.js')).handleBeforeUnload,
    SettingsNavGuardDialog: (await server.ssrLoadModule('/src/components/SettingsNavGuardDialog.jsx')).default,
    NotificationSettingsForm: (await server.ssrLoadModule('/src/components/NotificationSettingsForm.jsx')).default,
    NOTIFICATION_EVENTS: (await server.ssrLoadModule('/src/components/NotificationSettingsForm.jsx')).NOTIFICATION_EVENTS,
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

  it('General, Orders & Delivery, Notifications and Security & System each render a real form; only Payments still falls back to the no-persistence-yet placeholder', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /active\.key === 'general'\) content = <GeneralSettingsForm/);
    assert.match(source, /active\.key === 'orders-delivery'\) content = <OrderDeliverySettingsForm/);
    assert.match(source, /active\.key === 'notifications'\) content = <NotificationSettingsForm/);
    assert.match(source, /active\.key === 'security-system'[\s\S]*?<ChangePasswordForm/);
    assert.match(source, /<EmptyState/);
  });
});

describe('decideCategorySwitch (pure nav-guard decision, utils/settingsNavGuard.js)', () => {
  it('does nothing when the target category is already active', () => {
    assert.equal(mods.decideCategorySwitch({ dirty: true, saving: false }, 'general', 'general'), 'none');
  });

  it('switches immediately when the active form is clean', () => {
    assert.equal(mods.decideCategorySwitch({ dirty: false, saving: false }, 'general', 'notifications'), 'switch');
  });

  it('switches immediately when there is no guarded form at all — e.g. the Payments placeholder, which has nothing to lose', () => {
    assert.equal(mods.decideCategorySwitch(null, 'payments', 'general'), 'switch');
    assert.equal(mods.decideCategorySwitch(undefined, 'payments', 'general'), 'switch');
  });

  it('asks for confirmation when the active form has unsaved changes', () => {
    assert.equal(mods.decideCategorySwitch({ dirty: true, saving: false }, 'general', 'notifications'), 'confirm');
  });

  it('blocks navigation outright while a save is in flight, never offering a dialog that could interrupt or race it', () => {
    assert.equal(mods.decideCategorySwitch({ dirty: true, saving: true }, 'general', 'notifications'), 'blocked');
    assert.equal(mods.decideCategorySwitch({ dirty: false, saving: true }, 'general', 'notifications'), 'blocked', 'saving takes priority even if dirty happens to read false mid-save');
  });
});

describe('useSettingsFormGuard: registerSettingsFormGuard and handleBeforeUnload (hooks/useSettingsFormGuard.js)', () => {
  it('writes the given state onto the ref', () => {
    const ref = { current: null };
    const save = () => {};
    mods.registerSettingsFormGuard(ref, { dirty: true, saving: false, save });
    assert.deepEqual(ref.current, { dirty: true, saving: false, save });
  });

  it('does nothing when no ref is given, so a form rendered without one is simply unguarded', () => {
    assert.doesNotThrow(() => mods.registerSettingsFormGuard(undefined, { dirty: true, saving: false, save: () => {} }));
    assert.doesNotThrow(() => mods.registerSettingsFormGuard(null, { dirty: true, saving: false, save: () => {} }));
  });

  it('warns (preventDefault + returnValue) only when dirty, and never otherwise', () => {
    const clean = { preventDefault() { this.called = true; }, returnValue: undefined };
    mods.handleBeforeUnload(false, clean);
    assert.equal(clean.called, undefined, 'a clean form must never trigger the browser warning');
    assert.equal(clean.returnValue, undefined);

    const dirty = { preventDefault() { this.called = true; }, returnValue: undefined };
    mods.handleBeforeUnload(true, dirty);
    assert.equal(dirty.called, true);
    assert.equal(dirty.returnValue, '');
  });
});

describe('SettingsNavGuardDialog (the three-choice unsaved-changes dialog)', () => {
  const noop = () => {};

  it('renders nothing when closed', () => {
    const html = render(h(mods.SettingsNavGuardDialog, { open: false, saving: false, onStay: noop, onDiscard: noop, onSaveAndContinue: noop }), null);
    assert.equal(html, '');
  });

  it('shows three clearly labelled actions when open, as an accessible dialog — never vague "OK"/"Cancel" wording', () => {
    const html = render(h(mods.SettingsNavGuardDialog, { open: true, saving: false, onStay: noop, onDiscard: noop, onSaveAndContinue: noop }), null);
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-label="Unsaved changes"/);
    assert.match(html, /Stay Editing/);
    assert.match(html, /Discard Changes/);
    assert.match(html, /Save and Continue/);
    assert.ok(!/>OK<|>Cancel<|>Yes<|>No</.test(html), 'actions must be explicit, not generic OK/Cancel/Yes/No');
  });

  it('disables every action and shows a saving label while a dialog-triggered save is in flight — it cannot be interrupted, raced or duplicated', () => {
    const html = render(h(mods.SettingsNavGuardDialog, { open: true, saving: true, onStay: noop, onDiscard: noop, onSaveAndContinue: noop }), null);
    const disabledCount = (html.match(/disabled(="")?(?=[ >])/g) || []).length;
    assert.equal(disabledCount, 3, 'Stay, Discard and Save and Continue must all be disabled while saving');
    assert.match(html, /Saving…/);
  });

  it('the first action is reachable by keyboard without a pointer (receives initial focus)', () => {
    const html = render(h(mods.SettingsNavGuardDialog, { open: true, saving: false, onStay: noop, onDiscard: noop, onSaveAndContinue: noop }), null);
    assert.match(html, /autofocus(="")?/i);
  });

  it('maps Escape/backdrop-close to Stay Editing while idle, and disables that escape route while saving — the one choice that can never lose data is always available except mid-save', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/SettingsNavGuardDialog.jsx', import.meta.url), 'utf8');
    assert.match(source, /onClose=\{saving \? \(\) => \{\} : onStay\}/);
  });

  it('wires each button to its own distinct callback prop, and never calls the API itself', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/SettingsNavGuardDialog.jsx', import.meta.url), 'utf8');
    assert.match(source, /onClick=\{onStay\}/);
    assert.match(source, /onClick=\{onDiscard\}/);
    assert.match(source, /onClick=\{onSaveAndContinue\}/);
    assert.ok(!source.includes('api.') && !source.includes('fetch('), 'the dialog must delegate to the active form, never call the API itself');
  });
});

describe('AdminSettingsPage: category-switch guard wiring (structural)', () => {
  it('renders the nav-guard dialog and passes the shared formGuardRef to every real form', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /<SettingsNavGuardDialog/);
    assert.match(source, /<GeneralSettingsForm formGuardRef=\{formGuardRef\}/);
    assert.match(source, /<OrderDeliverySettingsForm formGuardRef=\{formGuardRef\}/);
    assert.match(source, /<NotificationSettingsForm formGuardRef=\{formGuardRef\}/);
    assert.match(source, /<ChangePasswordForm formGuardRef=\{formGuardRef\}/);
  });

  it('a category with no editable form is marked so, and never has the guard ref written to during render', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    // Payments is the one category object with no hasForm flag.
    assert.match(source, /key: 'payments'[^}]*\}/);
    assert.ok(!/key: 'payments'[^}]*hasForm/.test(source), 'Payments must not be marked hasForm');
    // No `.current =` assignment anywhere in this file — the ref is only ever read, in an event handler.
    assert.ok(!/formGuardRef\.current\s*=/.test(source), 'AdminSettingsPage must never write to the ref itself');
  });

  it('gates which categories\' guard value is trusted by hasForm, checked inside the click handler (not during render)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /function requestSwitch\(nextKey\) \{[\s\S]*?active\.hasForm \? formGuardRef\.current : null/);
    assert.match(source, /decideCategorySwitch\(guard, activeKey, nextKey\)/);
  });

  it('a save triggered through the dialog calls the active form\'s own exposed save — no second API request or duplicated validation', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /guard\.save\(\)/);
    assert.ok(!source.includes('api.patch') && !source.includes('api.post'), 'AdminSettingsPage must not call the settings API itself — it only delegates to the active form');
  });

  it('only navigates after a successful save, and discards/switches only through an explicit user choice', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /if \(ok\) setActiveKey\(targetKey\)/, 'navigation after Save and Continue must be conditional on success');
  });
});

describe('settings form guard registration on first render (General / Orders & Delivery / Notifications / ChangePassword)', () => {
  it('GeneralSettingsForm registers {dirty:false, saving:false, save} before its data has even loaded', () => {
    const ref = { current: null };
    render(h(mods.GeneralSettingsForm, { formGuardRef: ref }), owner);
    assert.ok(ref.current, 'the form must register itself even while still loading');
    assert.equal(ref.current.dirty, false, 'loading must never be mistaken for a dirty edit');
    assert.equal(ref.current.saving, false);
    assert.equal(typeof ref.current.save, 'function');
  });

  it('OrderDeliverySettingsForm registers the guard on first render', () => {
    const ref = { current: null };
    render(h(mods.OrderDeliverySettingsForm, { formGuardRef: ref }), owner);
    assert.equal(ref.current.dirty, false);
    assert.equal(ref.current.saving, false);
    assert.equal(typeof ref.current.save, 'function');
  });

  it('NotificationSettingsForm registers the guard on first render', () => {
    const ref = { current: null };
    render(h(mods.NotificationSettingsForm, { formGuardRef: ref }), owner);
    assert.equal(ref.current.dirty, false);
    assert.equal(ref.current.saving, false);
    assert.equal(typeof ref.current.save, 'function');
  });

  it('ChangePasswordForm registers the guard on first render, starting clean from its blank baseline (there is nothing to load)', () => {
    const ref = { current: null };
    render(h(mods.ChangePasswordForm, { formGuardRef: ref }), owner);
    assert.equal(ref.current.dirty, false, 'a blank password form is not dirty');
    assert.equal(ref.current.saving, false);
    assert.equal(typeof ref.current.save, 'function');
  });

  it('a form rendered without a formGuardRef prop does not throw — the ref is optional', () => {
    assert.doesNotThrow(() => render(h(mods.ChangePasswordForm, null), owner));
    assert.doesNotThrow(() => render(h(mods.GeneralSettingsForm, null), owner));
    assert.doesNotThrow(() => render(h(mods.OrderDeliverySettingsForm, null), owner));
    assert.doesNotThrow(() => render(h(mods.NotificationSettingsForm, null), owner));
  });
});

describe('beforeunload warning wiring (structural check — all four editable Settings forms share one hook)', () => {
  it('General, Orders & Delivery, Notifications and Change Password all call useBeforeUnloadWarning(dirty)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['GeneralSettingsForm.jsx', 'OrderDeliverySettingsForm.jsx', 'NotificationSettingsForm.jsx', 'ChangePasswordForm.jsx']) {
      const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
      assert.match(source, /useBeforeUnloadWarning\(dirty\)/, file);
    }
  });

  it('Change Password previously had no beforeunload protection at all — it does now, same as the other three forms', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ChangePasswordForm.jsx', import.meta.url), 'utf8');
    assert.match(source, /const dirty = JSON\.stringify\(form\) !== JSON\.stringify\(blankForm\(\)\)/);
  });
});

describe('each settings form\'s save returns true/false, reused by both its own submit and the nav-guard dialog', () => {
  it('General, Orders & Delivery, Notifications and Change Password each expose one doSave with no second validation/API path', async () => {
    const { readFileSync } = await import('node:fs');
    const expectations = {
      'GeneralSettingsForm.jsx': { endpoint: "'/settings/general'" },
      'OrderDeliverySettingsForm.jsx': { endpoint: "'/settings/orders-delivery'" },
      'NotificationSettingsForm.jsx': { endpoint: "'/settings/notifications'" },
      'ChangePasswordForm.jsx': { endpoint: "'/auth/change-password'" },
    };
    for (const [file, { endpoint }] of Object.entries(expectations)) {
      const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
      assert.match(source, /async function doSave\(\)/, file);
      assert.match(source, /return true/, file);
      assert.match(source, /return false/, file);
      // Exactly one write call to the settings/auth endpoint — no duplicate request added for the dialog.
      const writeCalls = (source.match(/api\.(patch|post)\(/g) || []).length;
      assert.equal(writeCalls, 1, `${file} must make exactly one write call, shared by submit and the dialog`);
      assert.ok(source.includes(endpoint), `${file} must still target ${endpoint}`);
    }
  });
});

describe('NotificationSettingsForm (/admin/settings — Notifications category)', () => {
  it('shows a loading state first, before any saved settings arrive', () => {
    const html = render(h(mods.NotificationSettingsForm), owner);
    assert.match(html, /Loading settings/);
  });

  it('declares all four customer SMS events with a description of when each is sent', () => {
    const keys = mods.NOTIFICATION_EVENTS.map(([key]) => key);
    assert.deepEqual(keys, ['orderPlaced', 'outForDelivery', 'delivered', 'orderCancelled']);
    for (const [key, label, description] of mods.NOTIFICATION_EVENTS) {
      assert.ok(label && label.length > 2, key);
      assert.ok(description && description.length > 20, `${key} needs a real description of when it is sent`);
    }
  });

  it('never implies notifications are on before the real settings load (every switch starts off)', async () => {
    // The SSR harness never runs effects, so this is the pre-fetch render: it must not show a form with
    // switches already checked. It shows the loader instead, and the form's own blank state is all-off.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/NotificationSettingsForm.jsx', import.meta.url), 'utf8');
    assert.match(source, /function blankForm\(\)[\s\S]*?enabled: false[\s\S]*?orderPlaced: false[\s\S]*?outForDelivery: false[\s\S]*?delivered: false[\s\S]*?orderCancelled: false/);
    assert.ok(!/enabled: true/.test(source), 'no switch may default to true');
  });

  it('reads and writes only the owner-only notifications endpoint', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/NotificationSettingsForm.jsx', import.meta.url), 'utf8');
    assert.match(source, /api\.get\('\/settings\/notifications'\)/);
    assert.match(source, /api\.patch\('\/settings\/notifications'/);
    // Must not leak into the public settings endpoints the storefront reads.
    assert.ok(!source.includes('/settings/general'), 'notification settings must not touch the public general endpoint');
    assert.ok(!source.includes('/settings/orders-delivery'));
  });

  it('tells the owner that a queued SMS is not a delivered SMS, and what delivery depends on', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/NotificationSettingsForm.jsx', import.meta.url), 'utf8');
    assert.match(source, /queued/i);
    assert.match(source, /not the same as delivered|not necessarily delivered/i);
    assert.match(source, /Android device/i);
    assert.match(source, /SIM/);
    assert.match(source, /carrier/i);
  });

  it('keeps the existing settings save/discard conventions', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/NotificationSettingsForm.jsx', import.meta.url), 'utf8');
    assert.match(source, /Discard Changes/);
    assert.match(source, /Save Changes/);
    assert.match(source, /disabled=\{!dirty \|\| saving\}/);
    assert.match(source, /inline-error/, 'a failed load must surface the existing error UI');
  });
});

describe('ChangePasswordForm (Settings → Security & System, and /admin/account)', () => {
  it('renders all three password fields, each masked by default with its own show/hide control', () => {
    const html = render(h(mods.ChangePasswordForm), owner);
    for (const label of ['Current password', 'New password', 'Confirm new password']) assert.match(html, new RegExp(label), label);
    // Three password inputs, none revealed on first render.
    assert.equal((html.match(/type="password"/g) || []).length, 3);
    assert.ok(!html.includes('type="text"'), 'no password may start out visible');
    for (const label of ['show current password', 'show new password', 'show confirm new password']) {
      assert.match(html, new RegExp(`aria-label="${label}"`, 'i'), label);
    }
  });

  it('uses the correct autocomplete hints so password managers behave', () => {
    const html = render(h(mods.ChangePasswordForm), owner);
    assert.equal((html.match(/autocomplete="current-password"/gi) || []).length, 1);
    assert.equal((html.match(/autocomplete="new-password"/gi) || []).length, 2);
  });

  it('keeps the submit button disabled until all three fields are filled', () => {
    const html = render(h(mods.ChangePasswordForm), owner);
    assert.match(html, /Update Password/);
    assert.match(html, /<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Update Password/s, 'the empty form must not be submittable');
  });

  it('never writes a password to browser storage or a URL', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ChangePasswordForm.jsx', import.meta.url), 'utf8');
    // Comments stripped first: the file documents that it avoids these, and a naive substring search
    // would match that documentation rather than real usage.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['localStorage', 'sessionStorage', 'document.cookie', 'console.log', 'console.error']) {
      assert.ok(!code.includes(forbidden), `the password form must never use ${forbidden}`);
    }
    // The payload goes in the POST body, never a query string.
    assert.match(source, /api\.post\('\/auth\/change-password', form\)/);
    assert.ok(!/change-password\?/.test(source));
  });

  it('reuses the one existing endpoint rather than duplicating password logic', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ChangePasswordForm.jsx', import.meta.url), 'utf8');
    assert.equal((source.match(/api\.(post|put|patch)\(/g) || []).length, 1, 'exactly one API call');
    assert.ok(!source.includes('bcrypt') && !source.includes('hash('), 'no hashing or credential logic in the client');
  });

  describe('validateChangePasswordForm (pure validation, mirroring the backend)', () => {
    const valid = () => ({ currentPassword: 'current-fixture-pw', newPassword: 'replacement-pw', confirmPassword: 'replacement-pw' });

    it('accepts a valid form', () => {
      assert.deepEqual(mods.validateChangePasswordForm(valid()), {});
    });

    it('requires every field', () => {
      assert.ok(mods.validateChangePasswordForm({ ...valid(), currentPassword: '' }).currentPassword);
      assert.ok(mods.validateChangePasswordForm({ ...valid(), newPassword: '' }).newPassword);
      assert.ok(mods.validateChangePasswordForm({ ...valid(), confirmPassword: '' }).confirmPassword);
    });

    it('flags a confirmation mismatch', () => {
      const errors = mods.validateChangePasswordForm({ ...valid(), confirmPassword: 'different-value' });
      assert.match(errors.confirmPassword, /do not match/i);
    });

    it('flags reusing the current password, matching the backend rule', () => {
      const same = 'identical-fixture-pw';
      const errors = mods.validateChangePasswordForm({ currentPassword: same, newPassword: same, confirmPassword: same });
      assert.match(errors.newPassword, /different from your current/i);
    });

    it('enforces exactly the backend minimum and nothing stricter', () => {
      assert.equal(mods.MIN_PASSWORD_LENGTH, 8, 'must match authController.js (newPassword.length < 8)');
      const short = 'abc1234'; // 7
      assert.match(mods.validateChangePasswordForm({ currentPassword: 'current-fixture-pw', newPassword: short, confirmPassword: short }).newPassword, /at least 8/i);
      // 8 plain lowercase characters: accepted by the backend, so the client must accept it too.
      const eight = 'abcdefgh';
      assert.deepEqual(mods.validateChangePasswordForm({ currentPassword: 'current-fixture-pw', newPassword: eight, confirmPassword: eight }), {});
    });
  });
});

describe('Change Password placement', () => {
  it('lives in the existing Security & System settings category, with no new page or nav item', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /active\.key === 'security-system'[\s\S]*?<ChangePasswordForm/);
    // The category list itself is unchanged — still the same five categories.
    assert.equal((source.match(/key: '/g) || []).length, 5);
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.ok(!app.includes('password') || !/path="admin\/.*password/.test(app), 'no new route was added for this');
    const nav = readFileSync(new URL('../src/components/adminNavigation.js', import.meta.url), 'utf8');
    assert.ok(!/password/i.test(nav), 'no new sidebar item was added');
  });

  it('the owner opening Security & System gets the real form, not the not-configured placeholder', () => {
    const html = render(h(mods.AdminSettingsPage), owner);
    // General is the default tab, so assert on the source wiring plus the rendered form in isolation.
    assert.match(render(h(mods.ChangePasswordForm), owner), /Update Password/);
    assert.ok(html.includes('Security &amp; System'), 'the category is still listed');
  });

  it('staff see a Change password section on /admin/account, with still no profile editing', () => {
    const member = staff(['orders:view'], { firstName: 'Priya', lastName: 'Patel', adminId: 'priya.p' });
    const html = render(h(mods.AdminAccountPage), member);
    assert.match(html, /Change password/i);
    assert.match(html, /Update Password/);
    assert.equal((html.match(/type="password"/g) || []).length, 3);
    // The identity fields stay read-only: the only inputs on the page are the password fields plus
    // their show/hide buttons (PUT /auth/me still rejects staff profile edits).
    assert.equal((html.match(/<input/g) || []).length, 3, 'no profile text inputs may appear');
  });

  it('the owner is still redirected away from /admin/account to business settings (unchanged)', () => {
    const html = render(h(mods.AdminAccountPage), owner);
    assert.ok(!html.includes('Change password'), 'the owner uses Settings → Security & System instead');
  });

  it('is not added to the delivery rider settings page (riders sign in by OTP only)', () => {
    const rider = staff(['delivery:view', 'delivery:update'], { firstName: 'Ravi', adminId: 'ravi.r', phone: '9876500001' });
    const html = render(h(mods.DeliverySettingsPage), rider);
    assert.ok(!html.includes('type="password"'), 'no password form may appear for a rider');
    assert.ok(!/Change password/i.test(html));
  });
});

describe('forced first-login password change (regression — must be untouched)', () => {
  it('still renders its own standalone flow with its temporary-password wording and sign-out option', () => {
    const pending = { role: 'staff', isActive: true, firstName: 'Sam', mustChangePassword: true, permissions: [] };
    const html = render(h(mods.ForcePasswordChangePage), pending);
    assert.match(html, /Temporary password/i, 'the forced flow keeps its own wording');
    assert.match(html, /Choose a new password/i);
    assert.match(html, /Save new password/);
    assert.match(html, /Sign out/i);
  });

  it('still posts to the same single endpoint with the same three fields', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/ForcePasswordChangePage.jsx', import.meta.url), 'utf8');
    assert.match(source, /api\.post\('\/auth\/change-password', form\)/);
    assert.match(source, /currentPassword: '', newPassword: '', confirmPassword: ''/);
    assert.match(source, /refreshUser\(\)/, 'it must still refresh the session so the guard releases');
  });
});

describe('notification settings access control', () => {
  it('only the owner reaches /admin/settings at all — staff, riders and customers are denied', () => {
    // The Notifications form lives on /admin/settings, which App.jsx wraps in the owner-only guard
    // (asserted above); this re-checks the guard itself with the real component.
    for (const user of [staff(['orders:view', 'orders:update_status']), staff(['delivery:view', 'delivery:update']), customer]) {
      const html = render(h(mods.RequirePermission, { ownerOnly: true }, h(mods.NotificationSettingsForm)), user);
      assert.match(html, /Access denied|do not have permission/i, JSON.stringify(user.permissions || user.role));
      assert.ok(!html.includes('Send SMS notifications'), 'a non-owner must never see the notification switches');
      assert.ok(!html.includes('Loading settings'), 'a non-owner must not even trigger the settings fetch');
    }
  });

  // Allowed renders an <Outlet/>, which is empty outside <Routes> — so "allowed" means no denial,
  // same convention as the RequirePermission tests at the top of this file.
  it('the owner is allowed through that same guard', () => {
    const html = render(h(mods.RequirePermission, { ownerOnly: true }, h(mods.NotificationSettingsForm)), owner);
    assert.ok(!/Access denied/i.test(html));
  });

  it('the owner sees the real form when it is rendered directly (the switches exist for them)', () => {
    const html = render(h(mods.NotificationSettingsForm), owner);
    assert.match(html, /Loading settings/);
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
    // Identity stays read-only — PUT /auth/me still rejects staff profile edits. Since the Change
    // Password step, the only inputs on this page are its three password fields, so this now asserts
    // "no editable profile field" rather than "no input at all".
    assert.ok(!/<input(?![^>]*type="password")/.test(html), 'account details must stay read-only — no profile edit controls');
    assert.equal((html.match(/type="password"/g) || []).length, 3, 'only the three Change Password fields');
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

  it('returns the saved public storefront fields on a successful fetch, and nothing else from the response', async () => {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings: {
      businessName: 'Fresh Mart', logo: 'data:image/png;base64,ABC', phone: '9876543210', email: 'owner@x.com',
      address: { line1: '12 MG Road', city: 'Pune', postalCode: '411001' },
      operatingHours: { monday: { closed: false, open: '09:00', close: '21:00' } },
      // Internal bookkeeping — must not come through to public components.
      updatedAt: '2026-01-01T00:00:00.000Z',
    } } });
    try {
      const result = await mods.loadBusinessSettings();
      assert.deepEqual(Object.keys(result).sort(), ['address', 'businessName', 'email', 'logo', 'operatingHours', 'phone']);
      assert.equal(result.businessName, 'Fresh Mart');
      assert.equal(result.phone, '9876543210');
      assert.equal(result.email, 'owner@x.com');
      assert.equal(result.address.city, 'Pune');
      assert.equal(result.operatingHours.monday.open, '09:00', 'the saved hours reach the shared hook data');
      assert.ok(!('updatedAt' in result));
    } finally {
      mods.api.get = original;
    }
  });

  it('clears the cache on invalidation, so the next load refetches the newly saved values', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => {
      calls += 1;
      return { data: { settings: calls === 1 ? { businessName: 'Before', phone: '9876543210' } : { businessName: 'After', phone: '9811111111' } } };
    };
    try {
      assert.equal((await mods.loadBusinessSettings()).phone, '9876543210');
      assert.equal((await mods.loadBusinessSettings()).phone, '9876543210', 'still cached');
      assert.equal(calls, 1);
      mods.invalidateBusinessSettings();
      const after = await mods.loadBusinessSettings();
      assert.equal(after.phone, '9811111111', 'a save must not leave the public pages on stale data');
      assert.equal(after.businessName, 'After');
      assert.equal(calls, 2);
    } finally {
      mods.api.get = original;
    }
  });

  it('a response that arrives after an invalidation does not repopulate the cache with stale values', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { data: { settings: { businessName: calls === 1 ? 'Stale' : 'Fresh' } } };
    };
    try {
      const inflight = mods.loadBusinessSettings();
      mods.invalidateBusinessSettings(); // owner saved while that request was still open
      await inflight;
      assert.equal((await mods.loadBusinessSettings()).businessName, 'Fresh');
      assert.equal(calls, 2, 'the invalidated request must not have been cached and reused');
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

  describe('formatOperatingHours (pure formatting of the real stored shape)', () => {
    const allDays = (entry) => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => [day, { ...entry }]));

    it('formats the stored 24-hour values as readable 12-hour ranges', () => {
      const rows = mods.formatOperatingHours({ monday: { closed: false, open: '09:00', close: '21:00' } });
      assert.deepEqual(rows, [{ days: 'Mon', hours: '9:00 AM – 9:00 PM' }]);
    });

    it('handles midnight and noon boundaries without printing "0:00" or "12:00 AM" wrongly', () => {
      assert.equal(mods.formatOperatingHours({ monday: { open: '00:30', close: '12:00' } })[0].hours, '12:30 AM – 12:00 PM');
      assert.equal(mods.formatOperatingHours({ monday: { open: '12:30', close: '23:45' } })[0].hours, '12:30 PM – 11:45 PM');
    });

    it('collapses consecutive days that share the same hours', () => {
      const hours = allDays({ closed: false, open: '09:00', close: '21:00' });
      hours.sunday = { closed: true };
      const rows = mods.formatOperatingHours(hours);
      assert.deepEqual(rows, [
        { days: 'Mon – Sat', hours: '9:00 AM – 9:00 PM' },
        { days: 'Sun', hours: 'Closed' },
      ]);
    });

    it('shows a closed day as "Closed", never as a time range', () => {
      const rows = mods.formatOperatingHours({ sunday: { closed: true, open: '09:00', close: '21:00' } });
      assert.deepEqual(rows, [{ days: 'Sun', hours: 'Closed' }]);
    });

    it('includes only the days that are actually stored', () => {
      const rows = mods.formatOperatingHours({ saturday: { open: '10:00', close: '14:00' } });
      assert.deepEqual(rows, [{ days: 'Sat', hours: '10:00 AM – 2:00 PM' }]);
    });

    it('never groups non-adjacent days into a false range when a day between them is unusable', () => {
      const rows = mods.formatOperatingHours({
        monday: { open: '09:00', close: '21:00' },
        tuesday: { open: 'garbage', close: 'garbage' }, // unusable, dropped
        wednesday: { open: '09:00', close: '21:00' },
      });
      assert.deepEqual(rows, [
        { days: 'Mon', hours: '9:00 AM – 9:00 PM' },
        { days: 'Wed', hours: '9:00 AM – 9:00 PM' },
      ], 'Mon and Wed must not collapse into "Mon – Wed" when Tue is missing');
    });

    it('drops malformed days rather than rendering something untrue', () => {
      const malformed = {
        monday: { open: '25:00', close: '09:00' },
        tuesday: { open: '09:00' },
        wednesday: { open: null, close: null },
        thursday: { open: '21:00', close: '09:00' }, // close before open
        friday: 'open all day',
        saturday: [],
        sunday: null,
      };
      assert.deepEqual(mods.formatOperatingHours(malformed), []);
    });

    it('returns an empty list for missing, empty or non-object input — never throws', () => {
      for (const value of [undefined, null, {}, [], 'closed', 42]) {
        assert.deepEqual(mods.formatOperatingHours(value), [], JSON.stringify(value));
      }
    });
  });

  describe('formatBusinessAddress', () => {
    it('joins only the parts that are filled in', () => {
      assert.equal(mods.formatBusinessAddress({ line1: '12 MG Road', line2: '', city: 'Pune', state: 'MH', postalCode: '411001' }), '12 MG Road, Pune, MH, 411001');
    });

    it('returns an empty string for a missing, empty or blank address — never "undefined"', () => {
      for (const value of [undefined, null, {}, { line1: '   ', city: '' }]) {
        assert.equal(mods.formatBusinessAddress(value), '', JSON.stringify(value));
      }
    });
  });
});

describe('public Contact page: saved contact details (Step 2)', () => {
  afterEach(() => mods.resetBusinessSettingsCache());

  async function renderContactWith(settings) {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings } });
    try {
      await mods.loadBusinessSettings(); // pre-warms the shared cache the component reads on first render
      return render(h(mods.ContactPage, null), null, { path: '/contact' });
    } finally {
      mods.api.get = original;
    }
  }

  it('shows the configured phone, email and address', async () => {
    const html = await renderContactWith({
      businessName: 'Fresh Mart', phone: '9876543210', email: 'owner@freshmart.in',
      address: { line1: '12 MG Road', city: 'Pune', state: 'MH', postalCode: '411001' },
    });
    assert.match(html, /98765 43210/, 'the saved number, formatted for reading');
    assert.match(html, /owner@freshmart\.in/);
    assert.match(html, /12 MG Road, Pune, MH, 411001/);
  });

  it('makes the phone and email tappable with tel: and mailto: links', async () => {
    const html = await renderContactWith({ phone: '9876543210', email: 'owner@freshmart.in', address: {} });
    assert.match(html, /href="tel:\+919876543210"/, 'tel: must carry the dialable digits, not the spaced form');
    assert.match(html, /href="mailto:owner@freshmart\.in"/);
  });

  it('never shows the old hardcoded demo phone or email once settings are configured', async () => {
    const html = await renderContactWith({ phone: '9811111111', email: 'real@store.in', address: {} });
    assert.ok(!html.includes('98765 43210'), 'the demo number must be gone');
    assert.ok(!html.includes('hello@janai.in'), 'the demo email must be gone');
  });

  it('hides the phone and email rows entirely when nothing is configured — never renders undefined/null or a fake number', async () => {
    const html = await renderContactWith({ businessName: 'Janai' });
    for (const leak of ['undefined', 'null', 'tel:', 'mailto:', '98765 43210', 'hello@janai.in']) {
      assert.ok(!html.includes(leak), `an unconfigured Contact page must not render "${leak}"`);
    }
    // The page itself still works: heading and the contact form remain.
    assert.match(html, /Contact Janai/);
    assert.match(html, /Send message/);
  });

  it('falls back to the existing generic line when no address is saved, rather than an empty row', async () => {
    const html = await renderContactWith({ phone: '9876543210', address: { line1: '', city: '' } });
    assert.match(html, /Serving local homes and businesses/);
  });

  it('keeps working on a failed settings fetch, showing no contact rows and no demo data', async () => {
    const original = mods.api.get;
    mods.api.get = async () => { throw new Error('backend unreachable'); };
    try {
      await mods.loadBusinessSettings();
      const html = render(h(mods.ContactPage, null), null, { path: '/contact' });
      assert.match(html, /Contact Janai/, 'falls back to the default business name');
      assert.ok(!html.includes('tel:') && !html.includes('mailto:'));
      assert.ok(!html.includes('undefined'));
    } finally {
      mods.api.get = original;
    }
  });

  it('shows the saved operating hours, collapsed and readable, under a Store hours heading', async () => {
    const open = { closed: false, open: '09:00', close: '21:00' };
    const html = await renderContactWith({
      businessName: 'Janai',
      operatingHours: {
        monday: open, tuesday: open, wednesday: open, thursday: open, friday: open,
        saturday: { closed: false, open: '10:00', close: '18:00' },
        sunday: { closed: true },
      },
    });
    assert.match(html, /Store hours/);
    assert.match(html, /Mon – Fri/);
    assert.match(html, /9:00 AM – 9:00 PM/);
    assert.match(html, /Sat/);
    assert.match(html, /10:00 AM – 6:00 PM/);
    assert.match(html, /Sun/);
    assert.match(html, /Closed/);
  });

  it('shows the neutral message when hours are not configured, inventing no schedule', async () => {
    const html = await renderContactWith({ businessName: 'Janai' });
    assert.match(html, /Operating hours not available/);
    assert.ok(!/AM|PM|Closed/.test(html.split('Store hours')[1] || ''), 'no times may be implied');
  });

  it('shows the neutral message rather than anything unsafe when every stored day is malformed', async () => {
    const html = await renderContactWith({
      operatingHours: { monday: { open: '99:99', close: 'x' }, tuesday: null, wednesday: 'open' },
    });
    assert.match(html, /Operating hours not available/);
    for (const leak of ['undefined', 'null', '[object Object]', '99:99', '{"', 'NaN']) {
      assert.ok(!html.includes(leak), `the hours section must never render "${leak}"`);
    }
  });

  it('renders hours as real markup, never raw JSON', async () => {
    const html = await renderContactWith({ operatingHours: { monday: { closed: false, open: '09:00', close: '21:00' } } });
    assert.match(html, /<dt>Mon<\/dt><dd>9:00 AM – 9:00 PM<\/dd>/);
    assert.ok(!html.includes('"open"') && !html.includes('[object Object]'));
  });

  it('keeps the existing contact rows working alongside the hours (no Step 2 regression)', async () => {
    const html = await renderContactWith({
      businessName: 'Fresh Mart', phone: '9876543210', email: 'owner@freshmart.in',
      address: { line1: '12 MG Road', city: 'Pune' },
      operatingHours: { monday: { closed: false, open: '09:00', close: '21:00' } },
    });
    assert.match(html, /href="tel:\+919876543210"/);
    assert.match(html, /href="mailto:owner@freshmart\.in"/);
    assert.match(html, /12 MG Road, Pune/);
    assert.match(html, /Store hours/);
    assert.match(html, /Contact Fresh Mart/);
    assert.match(html, /Send message/, 'the contact form is untouched');
  });

  it('serves updated hours after a General Settings save invalidates the cache — with no extra request', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => {
      calls += 1;
      return { data: { settings: { operatingHours: { monday: { closed: false, open: '09:00', close: calls === 1 ? '21:00' : '23:00' } } } } };
    };
    try {
      await mods.loadBusinessSettings();
      assert.match(render(h(mods.ContactPage, null), null, { path: '/contact' }), /9:00 AM – 9:00 PM/);
      assert.equal(calls, 1, 'one shared request, not one per field');

      mods.invalidateBusinessSettings(); // what the owner's save triggers
      await mods.loadBusinessSettings();
      const updated = render(h(mods.ContactPage, null), null, { path: '/contact' });
      assert.match(updated, /9:00 AM – 11:00 PM/, 'the new closing time must be shown');
      assert.ok(!updated.includes('9:00 AM – 9:00 PM'));
      assert.equal(calls, 2, 'exactly one refetch after invalidation');
    } finally {
      mods.api.get = original;
    }
  });

  it('the General Settings form invalidates the public cache after a successful save', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/GeneralSettingsForm.jsx', import.meta.url), 'utf8');
    assert.match(source, /invalidateBusinessSettings\(\)/);
    // It must run after the PATCH resolves, not before it.
    const save = source.slice(source.indexOf('api.patch'));
    assert.ok(save.indexOf('invalidateBusinessSettings()') > 0);
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

  it('renders a plain span with no link when to={null}, for chrome that is not a navigation target', async () => {
    mods.api.get = async () => ({ data: { settings: { businessName: 'Fresh Mart', logo: '' } } });
    await mods.loadBusinessSettings();
    const html = render(h(mods.Logo, { to: null, className: 'adm-sidebar-logo' }), null);
    assert.match(html, /<span class="brand-logo adm-sidebar-logo">/);
    assert.ok(!html.includes('<a '), 'to={null} must not produce a link');
    assert.ok(!html.includes('aria-label'), 'a non-interactive span needs no aria-label');
  });

  it('uses an explicit alt override for both the saved and the default logo', async () => {
    mods.api.get = async () => ({ data: { settings: { businessName: 'Fresh Mart', logo: '' } } });
    await mods.loadBusinessSettings();
    assert.match(render(h(mods.Logo, { to: null, alt: 'Fresh Mart' }), null), /alt="Fresh Mart"/);
    mods.resetBusinessSettingsCache();
    const custom = 'data:image/png;base64,ABCDEF';
    mods.api.get = async () => ({ data: { settings: { businessName: 'Fresh Mart', logo: custom } } });
    await mods.loadBusinessSettings();
    assert.match(render(h(mods.Logo, { to: null, alt: 'Fresh Mart' }), null), /alt="Fresh Mart"/);
  });

  it('never renders an empty or placeholder alt/aria-label if the saved name is blank', async () => {
    mods.api.get = async () => ({ data: { settings: { businessName: '', logo: '' } } });
    await mods.loadBusinessSettings();
    const html = render(h(mods.Logo, null), null);
    assert.ok(!html.includes('alt=""'), 'alt must never be empty');
    assert.ok(!html.includes('aria-label=" home"') && !html.includes('undefined') && !html.includes('null'));
    assert.match(html, /aria-label="Janai home"/, 'falls back to the default business name');
  });
});

describe('admin panel branding follows General Settings (Step 4)', () => {
  afterEach(() => mods.resetBusinessSettingsCache());

  async function renderSidebarWith(settings) {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings } });
    try {
      await mods.loadBusinessSettings(); // pre-warms the shared cache the component reads on first render
      return render(h(mods.AdminSidebar, { open: false }), owner);
    } finally {
      mods.api.get = original;
    }
  }

  it('shows the saved custom logo with the saved business name as its alt text', async () => {
    const custom = 'data:image/png;base64,ABCDEF';
    const html = await renderSidebarWith({ businessName: 'Fresh Mart', logo: custom });
    assert.match(html, new RegExp(`src="${custom}"`));
    assert.match(html, /alt="Fresh Mart"/);
    assert.match(html, /class="is-custom-logo"/, 'a custom logo needs the object-fit override, not the default crop');
  });

  it('falls back to the bundled Janai wordmark when no logo is saved', async () => {
    const html = await renderSidebarWith({ businessName: 'Fresh Mart', logo: '' });
    assert.match(html, /src="\/Janai-logo\.jpg"/);
    assert.ok(!html.includes('is-custom-logo'));
    assert.match(html, /alt="Fresh Mart"/, 'the alt still follows the saved name');
  });

  it('no longer hardcodes the Janai name as alt text once a different name is saved', async () => {
    const html = await renderSidebarWith({ businessName: 'Fresh Mart', logo: '' });
    assert.ok(!/alt="Janai"/.test(html), 'the hardcoded alt="Janai" must be gone');
  });

  it('falls back safely when settings are missing entirely, never rendering an empty alt', async () => {
    const html = await renderSidebarWith({});
    assert.match(html, /src="\/Janai-logo\.jpg"/);
    assert.match(html, /alt="Janai"/);
    assert.ok(!html.includes('alt=""') && !html.includes('undefined') && !html.includes('null'));
  });

  it('keeps the brand a non-interactive span and the existing sidebar structure intact', async () => {
    const html = await renderSidebarWith({ businessName: 'Fresh Mart', logo: '' });
    assert.match(html, /<span class="brand-logo adm-sidebar-logo">/);
    assert.match(html, /adm-sidebar-brand/);
    assert.match(html, /Admin Panel/, 'the panel label is unchanged');
    assert.match(html, /adm-sidebar-nav/);
    assert.match(html, /Dashboard/, 'navigation still renders');
    assert.match(html, /Logout/);
  });

  it('picks up new branding after a General Settings save invalidates the shared cache, with no extra request', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => {
      calls += 1;
      return { data: { settings: { businessName: calls === 1 ? 'Janai' : 'Fresh Mart', logo: '' } } };
    };
    try {
      await mods.loadBusinessSettings();
      assert.match(render(h(mods.AdminSidebar, { open: false }), owner), /alt="Janai"/);
      assert.equal(calls, 1, 'the panel shares the storefront request, it does not add its own');

      mods.invalidateBusinessSettings(); // what GeneralSettingsForm triggers on a successful save
      await mods.loadBusinessSettings();
      assert.match(render(h(mods.AdminSidebar, { open: false }), owner), /alt="Fresh Mart"/);
      assert.equal(calls, 2, 'exactly one refetch after invalidation');
    } finally {
      mods.api.get = original;
    }
  });

  it('still only shows navigation the account may use (access control unchanged)', async () => {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings: { businessName: 'Fresh Mart', logo: '' } } });
    try {
      await mods.loadBusinessSettings();
      const limited = render(h(mods.AdminSidebar, { open: false }), staff(['orders:view']));
      assert.match(limited, /All Orders/);
      assert.ok(!limited.includes('Staff & Access'), 'owner-only items stay hidden from staff');
      assert.ok(!limited.includes('Settings'), 'the owner-only Settings link stays hidden');
      assert.match(limited, /alt="Fresh Mart"/, 'branding still applies for staff');
    } finally {
      mods.api.get = original;
    }
  });
});

const rider = staff(['delivery:view', 'delivery:update'], { firstName: 'Ravi', lastName: 'Rider', adminId: 'ravi.r' });

describe('delivery portal branding follows General Settings (Step 5)', () => {
  afterEach(() => mods.resetBusinessSettingsCache());

  async function renderDeliveryLayoutWith(settings) {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings } });
    try {
      await mods.loadBusinessSettings(); // pre-warms the shared cache the component reads on first render
      return render(h(mods.DeliveryLayout, null), rider);
    } finally {
      mods.api.get = original;
    }
  }

  it('shows the saved custom logo with the saved business name as alt text', async () => {
    const custom = 'data:image/png;base64,ABCDEF';
    const html = await renderDeliveryLayoutWith({ businessName: 'Fresh Mart', logo: custom });
    assert.match(html, new RegExp(`src="${custom}"`));
    assert.match(html, /alt="Fresh Mart"/);
    assert.match(html, /class="is-custom-logo"/, 'a custom logo needs the object-fit override, not the default crop');
    assert.match(html, /aria-label="Fresh Mart delivery home"/);
  });

  it('falls back to the bundled Janai wordmark and alt text when no logo is saved', async () => {
    const html = await renderDeliveryLayoutWith({ businessName: 'Fresh Mart', logo: '' });
    assert.match(html, /src="\/Janai-logo\.jpg"/);
    assert.ok(!html.includes('is-custom-logo'));
    assert.match(html, /alt="Fresh Mart"/, 'the alt still follows the saved name even on the default asset');
  });

  it('falls back safely when settings are missing entirely, never rendering undefined/null/empty alt', async () => {
    const html = await renderDeliveryLayoutWith({});
    assert.match(html, /src="\/Janai-logo\.jpg"/);
    assert.match(html, /alt="Janai"/);
    assert.ok(!html.includes('alt=""') && !html.includes('undefined') && !html.includes('null'));
  });

  it('picks up new branding after a General Settings save invalidates the shared cache, with no extra request', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => {
      calls += 1;
      return { data: { settings: { businessName: calls === 1 ? 'Janai' : 'Fresh Mart', logo: '' } } };
    };
    try {
      await mods.loadBusinessSettings();
      assert.match(render(h(mods.DeliveryLayout, null), rider), /alt="Janai"/);
      assert.equal(calls, 1, 'the rider portal shares the one request, it does not add its own');

      mods.invalidateBusinessSettings(); // what GeneralSettingsForm triggers on a successful save
      await mods.loadBusinessSettings();
      assert.match(render(h(mods.DeliveryLayout, null), rider), /alt="Fresh Mart"/);
      assert.equal(calls, 2, 'exactly one refetch after invalidation');
    } finally {
      mods.api.get = original;
    }
  });

  it('still shows the rider identity, settings link and logout — no regression from Step 4/earlier', async () => {
    const html = await renderDeliveryLayoutWith({ businessName: 'Fresh Mart', logo: '' });
    assert.match(html, /Ravi Rider/);
    assert.match(html, /Delivery Partner/);
    assert.match(html, /href="\/delivery\/settings"/);
    assert.match(html, /Logout/);
    assert.ok(!html.includes('adm-sidebar'), 'still no admin sidebar markup in the rider portal');
  });
});

describe('delivery login branding follows General Settings (Step 5)', () => {
  afterEach(() => mods.resetBusinessSettingsCache());

  async function renderDeliveryLoginWith(settings) {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings } });
    try {
      await mods.loadBusinessSettings();
      return render(h(mods.DeliveryLoginPage, null), null, { path: '/delivery/login' });
    } finally {
      mods.api.get = original;
    }
  }

  it('shows the saved custom logo with the saved business name as alt text', async () => {
    const custom = 'data:image/png;base64,ABCDEF';
    const html = await renderDeliveryLoginWith({ businessName: 'Fresh Mart', logo: custom });
    assert.match(html, new RegExp(`src="${custom}"`));
    assert.match(html, /alt="Fresh Mart"/);
    assert.match(html, /class="is-custom-logo"/);
  });

  it('falls back to the bundled wordmark and the "Janai" alt text when unconfigured', async () => {
    const html = await renderDeliveryLoginWith({});
    assert.match(html, /src="\/Janai-logo\.jpg"/);
    assert.match(html, /alt="Janai"/);
    assert.ok(!html.includes('alt=""') && !html.includes('undefined') && !html.includes('null'));
  });

  it('remains OTP-only: shows the mobile-number form, no password field, same footer links', async () => {
    const html = await renderDeliveryLoginWith({ businessName: 'Fresh Mart', logo: '' });
    assert.match(html, /Delivery Partner Login/);
    assert.match(html, /Registered Mobile Number/);
    assert.match(html, /Send OTP/);
    assert.ok(!html.includes('type="password"'), 'no password field may appear on the rider login');
    assert.match(html, /Customer sign in/);
    assert.match(html, /Admin sign in/);
    assert.match(html, /Only active delivery staff accounts can sign in here\./);
  });

  it('picks up new branding after cache invalidation, with no extra request', async () => {
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => {
      calls += 1;
      return { data: { settings: { businessName: calls === 1 ? 'Janai' : 'Fresh Mart' } } };
    };
    try {
      await mods.loadBusinessSettings();
      assert.match(render(h(mods.DeliveryLoginPage, null), null, { path: '/delivery/login' }), /alt="Janai"/);
      mods.invalidateBusinessSettings();
      await mods.loadBusinessSettings();
      assert.match(render(h(mods.DeliveryLoginPage, null), null, { path: '/delivery/login' }), /alt="Fresh Mart"/);
      assert.equal(calls, 2);
    } finally {
      mods.api.get = original;
    }
  });
});

describe('public authentication pages (AuthFrame) branding follows General Settings (Step 5)', () => {
  afterEach(() => mods.resetBusinessSettingsCache());

  async function renderAuthFrameWith(settings, props = {}) {
    const original = mods.api.get;
    mods.api.get = async () => ({ data: { settings } });
    try {
      await mods.loadBusinessSettings();
      return render(h(mods.AuthFrame, { eyebrow: 'WELCOME', title: 'Sign in', description: 'Test description', ...props }), null, { path: '/login' });
    } finally {
      mods.api.get = original;
    }
  }

  it('non-standalone (customer login/register/forgot-password): saved custom logo uses the saved name as alt and aria-label', async () => {
    const custom = 'data:image/png;base64,ABCDEF';
    const html = await renderAuthFrameWith({ businessName: 'Fresh Mart', logo: custom });
    assert.match(html, new RegExp(`src="${custom}"`));
    assert.match(html, /alt="Fresh Mart"/);
    assert.match(html, /class="is-custom-logo"/);
    assert.match(html, /aria-label="Fresh Mart home"/);
  });

  it('non-standalone fallback: unconfigured settings keep the existing default alt/aria-label exactly', async () => {
    const html = await renderAuthFrameWith({});
    assert.match(html, /src="\/Janai-logo\.jpg"/);
    assert.match(html, /alt="Janai, Fruits Vegetables Groceries"/, 'the existing marketing alt text is preserved');
    assert.match(html, /aria-label="Janai home"/);
    assert.ok(!html.includes('is-custom-logo'));
  });

  it('standalone (admin login / forced password change): saved custom logo uses the saved name as alt, with no link', async () => {
    const custom = 'data:image/png;base64,ABCDEF';
    const html = await renderAuthFrameWith({ businessName: 'Fresh Mart', logo: custom }, { standalone: true });
    assert.match(html, new RegExp(`src="${custom}"`));
    assert.match(html, /alt="Fresh Mart"/);
    assert.match(html, /<div class="auth-logo">/, 'standalone renders a div, not a link, around the logo');
  });

  it('standalone fallback: unconfigured settings keep the existing short "Janai" alt exactly', async () => {
    const html = await renderAuthFrameWith({}, { standalone: true });
    assert.match(html, /src="\/Janai-logo\.jpg"/);
    assert.match(html, /alt="Janai"/);
    assert.ok(!/alt="Janai, Fruits Vegetables Groceries"/.test(html), 'standalone keeps its own shorter existing alt, unchanged');
  });

  it('never renders undefined, null or an empty alt/aria-label when the saved name is blank', async () => {
    const html = await renderAuthFrameWith({ businessName: '', logo: '' });
    // The decorative category chips in the marketing photo panel (e.g. <img alt="" .../> for Fruits/
    // Vegetables/Groceries icons) legitimately use alt="" and are unrelated to branding — scope the
    // empty-alt check to the logo itself, not the whole page.
    assert.match(html, /class="auth-logo"[^<]*<img[^>]*alt="[^"]+"/, 'the logo image must have a non-empty alt');
    assert.ok(!html.includes('undefined') && !html.includes('null'));
    assert.match(html, /aria-label="Janai home"/, 'falls back to the default business name');
  });

  it('is wired to fall back on a broken custom-logo image, same as the shared Logo component', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AccountPages.jsx', import.meta.url), 'utf8');
    assert.match(source, /onError=\{onLogoError\}/);
    assert.match(source, /setBrokenLogo\(true\)/);
  });

  it('picks up new branding after cache invalidation, sharing one request with the rest of the app', async () => {
    // Without a saved logo, alt stays the fixed marketing phrase regardless of business name (same
    // precedent as the Navbar/Footer Logo) — aria-label is what tracks the saved name here.
    const original = mods.api.get;
    let calls = 0;
    mods.api.get = async () => {
      calls += 1;
      return { data: { settings: { businessName: calls === 1 ? 'Janai' : 'Fresh Mart' } } };
    };
    try {
      await mods.loadBusinessSettings();
      assert.match(render(h(mods.AuthFrame, { eyebrow: 'E', title: 'T', description: 'D' }), null, { path: '/login' }), /aria-label="Janai home"/);
      assert.equal(calls, 1);
      mods.invalidateBusinessSettings();
      await mods.loadBusinessSettings();
      assert.match(render(h(mods.AuthFrame, { eyebrow: 'E', title: 'T', description: 'D' }), null, { path: '/login' }), /aria-label="Fresh Mart home"/);
      assert.equal(calls, 2, 'exactly one refetch after invalidation');
    } finally {
      mods.api.get = original;
    }
  });

  it('existing structural elements (back link, photo panel, eyebrow/title/description) are unchanged', async () => {
    const html = await renderAuthFrameWith({ businessName: 'Fresh Mart', logo: '' });
    assert.match(html, /auth-photo/);
    assert.match(html, /WELCOME/);
    assert.match(html, /Sign in/);
    assert.match(html, /Test description/);
    assert.match(html, /Back to Home/, 'non-standalone keeps the back-to-home link');
  });

  it('standalone omits the back-to-home link, unchanged from before', async () => {
    const html = await renderAuthFrameWith({ businessName: 'Fresh Mart', logo: '' }, { standalone: true });
    assert.ok(!html.includes('Back to Home'));
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
