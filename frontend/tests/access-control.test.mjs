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
    UniversalPricingSettingsForm: (await server.ssrLoadModule('/src/components/UniversalPricingSettingsForm.jsx')).default,
    ProductFormModal: (await server.ssrLoadModule('/src/components/ProductFormModal.jsx')).default,
    matchUniversalPricingRule: (await server.ssrLoadModule('/src/components/ProductFormModal.jsx')).matchUniversalPricingRule,
    calculateUniversalSuggestion: (await server.ssrLoadModule('/src/components/ProductFormModal.jsx')).calculateUniversalSuggestion,
    formatUniversalRange: (await server.ssrLoadModule('/src/components/ProductFormModal.jsx')).formatUniversalRange,
    isUniversalSuggestionApplied: (await server.ssrLoadModule('/src/components/ProductFormModal.jsx')).isUniversalSuggestionApplied,
    vendorRowMode: (await server.ssrLoadModule('/src/components/ProductFormModal.jsx')).vendorRowMode,
    buildVendorOptions: (await server.ssrLoadModule('/src/components/ProductFormModal.jsx')).buildVendorOptions,
    resolveCentralVendor: (await server.ssrLoadModule('/src/components/ProductFormModal.jsx')).resolveCentralVendor,
    validateUniversalPricingSettingsForm: (await server.ssrLoadModule('/src/components/UniversalPricingSettingsForm.jsx')).validateUniversalPricingSettingsForm,
    addPricingRule: (await server.ssrLoadModule('/src/components/UniversalPricingSettingsForm.jsx')).addPricingRule,
    removePricingRule: (await server.ssrLoadModule('/src/components/UniversalPricingSettingsForm.jsx')).removePricingRule,
    updatePricingRuleField: (await server.ssrLoadModule('/src/components/UniversalPricingSettingsForm.jsx')).updatePricingRuleField,
    NOTIFICATION_EVENTS: (await server.ssrLoadModule('/src/components/NotificationSettingsForm.jsx')).NOTIFICATION_EVENTS,
    loadOrderSettings: (await server.ssrLoadModule('/src/hooks/useOrderSettings.js')).loadOrderSettings,
    resetOrderSettingsCache: (await server.ssrLoadModule('/src/hooks/useOrderSettings.js')).__resetOrderSettingsCacheForTests,
    ORDER_SETTINGS_DEFAULTS: (await server.ssrLoadModule('/src/hooks/useOrderSettings.js')).DEFAULTS,
    AdminVendorsPage: (await server.ssrLoadModule('/src/pages/AdminVendorsPage.jsx')).default,
    filterVendors: (await server.ssrLoadModule('/src/pages/AdminVendorsPage.jsx')).filterVendors,
    VendorFormModal: (await server.ssrLoadModule('/src/components/VendorFormModal.jsx')).default,
    adminNavigation: (await server.ssrLoadModule('/src/components/adminNavigation.js')).adminNavigation,
    AdminVendorDetailPage: (await server.ssrLoadModule('/src/pages/AdminVendorDetailPage.jsx')).default,
    filterProductsByCategory: (await server.ssrLoadModule('/src/pages/AdminVendorDetailPage.jsx')).filterProductsByCategory,
    formatQuantityByUnit: (await server.ssrLoadModule('/src/pages/AdminVendorDetailPage.jsx')).formatQuantityByUnit,
    recordPurchaseAvailability: (await server.ssrLoadModule('/src/pages/AdminVendorDetailPage.jsx')).recordPurchaseAvailability,
    filterPurchases: (await server.ssrLoadModule('/src/pages/AdminVendorDetailPage.jsx')).filterPurchases,
    VendorAnalytics: (await server.ssrLoadModule('/src/components/VendorAnalytics.jsx')).default,
    sortVendorRows: (await server.ssrLoadModule('/src/components/VendorAnalytics.jsx')).sortVendorRows,
    isInvalidDateRange: (await server.ssrLoadModule('/src/pages/AdminVendorDetailPage.jsx')).isInvalidDateRange,
    VendorPurchaseHistoryModal: (await server.ssrLoadModule('/src/components/VendorHistoryModals.jsx')).VendorPurchaseHistoryModal,
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
    for (const label of ['General', 'Orders & Delivery', 'Payments', 'Notifications', 'Security & System', 'Pricing']) assert.match(html, new RegExp(label.replace(/&/g, '&amp;')), label);
  });

  it('defaults to the General category, which loads real data (shows a loading state first, never a "not configured yet" placeholder)', () => {
    const html = render(h(mods.AdminSettingsPage), owner);
    assert.match(html, /Loading settings/);
    assert.ok(!html.includes('not configured yet'));
  });

  it('General, Orders & Delivery, Notifications, Security & System and Pricing each render a real form; only Payments still falls back to the no-persistence-yet placeholder', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /active\.key === 'general'\) content = <GeneralSettingsForm/);
    assert.match(source, /active\.key === 'orders-delivery'\) content = <OrderDeliverySettingsForm/);
    assert.match(source, /active\.key === 'notifications'\) content = <NotificationSettingsForm/);
    assert.match(source, /active\.key === 'security-system'[\s\S]*?<ChangePasswordForm/);
    assert.match(source, /active\.key === 'pricing'\) content = <UniversalPricingSettingsForm/);
    assert.match(source, /<EmptyState/);
  });

  it('Pricing is a sixth category inside this same page — no new page, route or nav item was added', async () => {
    const { readFileSync } = await import('node:fs');
    const settingsSource = readFileSync(new URL('../src/pages/AdminSettingsPage.jsx', import.meta.url), 'utf8');
    assert.match(settingsSource, /key: 'pricing'.*hasForm: true/);
    assert.equal((settingsSource.match(/key: '[a-z-]+'/g) || []).length, 6, 'exactly six categories now exist');
    const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.ok(!appSource.includes('UniversalPricingSettingsForm') && !appSource.includes('pricing-rules'), 'Pricing must not get its own route — only /admin/settings renders it');
    const navSource = readFileSync(new URL('../src/components/adminNavigation.js', import.meta.url), 'utf8');
    assert.ok(!/pricing/i.test(navSource), 'no new sidebar item was added for this');
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

  it('UniversalPricingSettingsForm registers the guard on first render, starting clean with no rules', () => {
    const ref = { current: null };
    render(h(mods.UniversalPricingSettingsForm, { formGuardRef: ref }), owner);
    assert.equal(ref.current.dirty, false);
    assert.equal(ref.current.saving, false);
    assert.equal(typeof ref.current.save, 'function');
  });

  it('a form rendered without a formGuardRef prop does not throw — the ref is optional', () => {
    assert.doesNotThrow(() => render(h(mods.ChangePasswordForm, null), owner));
    assert.doesNotThrow(() => render(h(mods.GeneralSettingsForm, null), owner));
    assert.doesNotThrow(() => render(h(mods.OrderDeliverySettingsForm, null), owner));
    assert.doesNotThrow(() => render(h(mods.NotificationSettingsForm, null), owner));
    assert.doesNotThrow(() => render(h(mods.UniversalPricingSettingsForm, null), owner));
  });
});

describe('beforeunload warning wiring (structural check — all five editable Settings forms share one hook)', () => {
  it('General, Orders & Delivery, Notifications, Change Password and Pricing all call useBeforeUnloadWarning(dirty)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['GeneralSettingsForm.jsx', 'OrderDeliverySettingsForm.jsx', 'NotificationSettingsForm.jsx', 'ChangePasswordForm.jsx', 'UniversalPricingSettingsForm.jsx']) {
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
  it('General, Orders & Delivery, Notifications, Change Password and Pricing each expose one doSave with no second validation/API path', async () => {
    const { readFileSync } = await import('node:fs');
    const expectations = {
      'GeneralSettingsForm.jsx': { endpoint: "'/settings/general'" },
      'OrderDeliverySettingsForm.jsx': { endpoint: "'/settings/orders-delivery'" },
      'NotificationSettingsForm.jsx': { endpoint: "'/settings/notifications'" },
      'ChangePasswordForm.jsx': { endpoint: "'/auth/change-password'" },
      'UniversalPricingSettingsForm.jsx': { endpoint: "'/settings/pricing-rules'" },
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
    // The category list itself didn't gain a category for Change Password specifically — it still
    // lives inside Security & System. (The Pricing category added afterwards is unrelated to this and
    // is covered by its own tests; six is the current total.)
    assert.equal((source.match(/key: '/g) || []).length, 6);
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

describe('UniversalPricingSettingsForm (/admin/settings — Pricing category)', () => {
  it('shows a loading state first, before any saved rules arrive', () => {
    const html = render(h(mods.UniversalPricingSettingsForm), owner);
    assert.match(html, /Loading settings/);
  });

  it('is owner-only, same as the other owner-only Settings categories: it reads/writes only /settings/pricing-rules', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/UniversalPricingSettingsForm.jsx', import.meta.url), 'utf8');
    assert.match(source, /api\.get\('\/settings\/pricing-rules'\)/);
    assert.match(source, /api\.patch\('\/settings\/pricing-rules'/);
    assert.ok(!source.includes('/settings/general') && !source.includes('/settings/orders-delivery') && !source.includes('/settings/notifications'));
  });

  describe('addPricingRule / removePricingRule / updatePricingRuleField (pure add/edit/delete, exported because the SSR test harness cannot simulate clicks)', () => {
    it('adds one blank rule with a fresh id', () => {
      const next = mods.addPricingRule([]);
      assert.equal(next.length, 1);
      assert.deepEqual(next[0], { id: next[0].id, minPurchasePrice: '', maxPurchasePrice: '', openEnded: false, fixedProfit: '', profitPercent: '' });
    });

    it('appends without disturbing existing rules', () => {
      const existing = [{ id: 'a', minPurchasePrice: '0', maxPurchasePrice: '100', openEnded: false, fixedProfit: '5', profitPercent: '10' }];
      const next = mods.addPricingRule(existing);
      assert.equal(next.length, 2);
      assert.deepEqual(next[0], existing[0]);
    });

    it('removes exactly the rule with the given id', () => {
      const rules = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      assert.deepEqual(mods.removePricingRule(rules, 'b').map((rule) => rule.id), ['a', 'c']);
    });

    it('removing an id that is not present leaves the list unchanged', () => {
      const rules = [{ id: 'a' }, { id: 'b' }];
      assert.deepEqual(mods.removePricingRule(rules, 'nope'), rules);
    });

    it('updates only the targeted rule and field, leaving everything else untouched', () => {
      const rules = [
        { id: 'a', minPurchasePrice: '0', maxPurchasePrice: '100', openEnded: false, fixedProfit: '5', profitPercent: '10' },
        { id: 'b', minPurchasePrice: '100', maxPurchasePrice: '', openEnded: true, fixedProfit: '20', profitPercent: '0' },
      ];
      const next = mods.updatePricingRuleField(rules, 'a', 'minPurchasePrice', '50');
      assert.equal(next[0].minPurchasePrice, '50');
      assert.deepEqual(next[1], rules[1], 'the untouched rule must be left exactly as-is');
    });
  });

  describe('validateUniversalPricingSettingsForm (pure validation, mirroring the backend\'s structural checks)', () => {
    const rule = (overrides = {}) => ({ id: 'r1', minPurchasePrice: '0', maxPurchasePrice: '100', openEnded: false, fixedProfit: '0', profitPercent: '10', ...overrides });

    it('accepts a single valid bounded rule with no errors', () => {
      assert.deepEqual(mods.validateUniversalPricingSettingsForm({ rules: [rule()] }), {});
    });

    it('accepts a valid open-ended rule', () => {
      assert.deepEqual(mods.validateUniversalPricingSettingsForm({ rules: [rule({ openEnded: true, maxPurchasePrice: '' })] }), {});
    });

    it('accepts an empty rule list (nothing configured)', () => {
      assert.deepEqual(mods.validateUniversalPricingSettingsForm({ rules: [] }), {});
    });

    it('rejects a missing or negative minimum purchase price', () => {
      assert.ok(mods.validateUniversalPricingSettingsForm({ rules: [rule({ minPurchasePrice: '' })] })['min-r1']);
      assert.ok(mods.validateUniversalPricingSettingsForm({ rules: [rule({ minPurchasePrice: '-5' })] })['min-r1']);
    });

    it('rejects an invalid minimum/maximum relationship (max must be greater than min)', () => {
      assert.ok(mods.validateUniversalPricingSettingsForm({ rules: [rule({ minPurchasePrice: '100', maxPurchasePrice: '100' })] })['max-r1'], 'equal');
      assert.ok(mods.validateUniversalPricingSettingsForm({ rules: [rule({ minPurchasePrice: '200', maxPurchasePrice: '100' })] })['max-r1'], 'min > max');
    });

    it('rejects negative fixed or percentage profit', () => {
      assert.ok(mods.validateUniversalPricingSettingsForm({ rules: [rule({ fixedProfit: '-1' })] })['profit-r1']);
      assert.ok(mods.validateUniversalPricingSettingsForm({ rules: [rule({ profitPercent: '-1' })] })['profit-r1']);
    });

    it('rejects both profit values being zero', () => {
      assert.ok(mods.validateUniversalPricingSettingsForm({ rules: [rule({ fixedProfit: '0', profitPercent: '0' })] })['profit-r1']);
    });

    it('allows adjacent ranges and does not flag shared boundaries as overlapping', () => {
      const result = mods.validateUniversalPricingSettingsForm({
        rules: [
          rule({ id: 'r1', minPurchasePrice: '0', maxPurchasePrice: '100' }),
          rule({ id: 'r2', minPurchasePrice: '100', maxPurchasePrice: '500' }),
          rule({ id: 'r3', minPurchasePrice: '500', maxPurchasePrice: '', openEnded: true }),
        ],
      });
      assert.deepEqual(result, {});
    });

    it('rejects overlapping ranges', () => {
      const result = mods.validateUniversalPricingSettingsForm({
        rules: [
          rule({ id: 'r1', minPurchasePrice: '0', maxPurchasePrice: '150' }),
          rule({ id: 'r2', minPurchasePrice: '100', maxPurchasePrice: '500' }),
        ],
      });
      assert.match(result.rules, /overlap/i);
    });

    it('rejects more than one open-ended range', () => {
      const result = mods.validateUniversalPricingSettingsForm({
        rules: [
          rule({ id: 'r1', minPurchasePrice: '0', maxPurchasePrice: '', openEnded: true }),
          rule({ id: 'r2', minPurchasePrice: '500', maxPurchasePrice: '', openEnded: true }),
        ],
      });
      assert.match(result.rules, /one pricing rule may be open-ended/i);
    });

    it('rejects an open-ended range that is not the final range', () => {
      const result = mods.validateUniversalPricingSettingsForm({
        rules: [
          rule({ id: 'r1', minPurchasePrice: '0', maxPurchasePrice: '', openEnded: true }),
          rule({ id: 'r2', minPurchasePrice: '500', maxPurchasePrice: '1000' }),
        ],
      });
      assert.ok(result.rules);
    });

    it('a malformed individual row is flagged on that row, without also running the cross-rule overlap check against it', () => {
      const result = mods.validateUniversalPricingSettingsForm({
        rules: [rule({ id: 'r1', minPurchasePrice: '-1' }), rule({ id: 'r2', minPurchasePrice: '100', maxPurchasePrice: '500' })],
      });
      assert.ok(result['min-r1']);
      assert.equal(result.rules, undefined, 'the cross-rule check must not run while a row is individually invalid');
    });
  });

  describe('responsive structure (reuses existing, already-mobile-safe classes — no new CSS needed)', () => {
    it('reuses the existing vendor-list card pattern and the existing 2-column form grid, both already responsive', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/UniversalPricingSettingsForm.jsx', import.meta.url), 'utf8');
      assert.match(source, /className="adm-vendor-list"/);
      assert.match(source, /className="adm-vendor-card"/);
      assert.match(source, /className="adm-form-grid"/);

      const css = readFileSync(new URL('../src/Janai.css', import.meta.url), 'utf8');
      assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?\.adm-form-grid,[\s\S]*?grid-template-columns: 1fr;/, 'the shared form grid already collapses to one column on mobile');
      assert.match(css, /\.adm-vendor-card-head \{ display: flex;[\s\S]*?flex-wrap: wrap;/, 'the card header already wraps instead of overflowing horizontally');
    });

    it('the open-ended checkbox spans the full row width via the existing field-wide rule, so it reads clearly rather than being squeezed into one grid column', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/UniversalPricingSettingsForm.jsx', import.meta.url), 'utf8');
      assert.match(source, /className="adm-hours-day field-wide"/);
      const css = readFileSync(new URL('../src/Janai.css', import.meta.url), 'utf8');
      assert.match(css, /\.adm-form-grid \.field-wide \{ grid-column: 1 \/ -1; \}/);
    });
  });
});

describe('ProductFormModal: Universal Pricing integration (Stage 3)', () => {
  describe('matchUniversalPricingRule (pure rule matching — minimum inclusive, maximum exclusive)', () => {
    const rules = [
      { minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: 5, profitPercent: 10 },
      { minPurchasePrice: 100, maxPurchasePrice: 500, fixedProfit: 10, profitPercent: 12 },
      { minPurchasePrice: 500, maxPurchasePrice: null, fixedProfit: 20, profitPercent: 15 },
    ];

    it('matches a purchase price inside a bounded range', () => {
      assert.equal(mods.matchUniversalPricingRule(rules, 50), rules[0]);
      assert.equal(mods.matchUniversalPricingRule(rules, 250), rules[1]);
    });

    it('matches the open-ended final range for anything at or above its minimum', () => {
      assert.equal(mods.matchUniversalPricingRule(rules, 500), rules[2]);
      assert.equal(mods.matchUniversalPricingRule(rules, 50000), rules[2]);
    });

    it('the minimum boundary is inclusive, the maximum boundary is exclusive', () => {
      assert.equal(mods.matchUniversalPricingRule(rules, 100), rules[1], 'exactly 100 belongs to the [100,500) range, not [0,100)');
      assert.equal(mods.matchUniversalPricingRule(rules, 99.99), rules[0]);
    });

    it('returns null when a purchase price falls in a gap between ranges', () => {
      const withGap = [
        { minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: 5, profitPercent: 0 },
        { minPurchasePrice: 150, maxPurchasePrice: 500, fixedProfit: 10, profitPercent: 0 },
      ];
      assert.equal(mods.matchUniversalPricingRule(withGap, 120), null);
    });

    it('returns null for an empty rule configuration', () => {
      assert.equal(mods.matchUniversalPricingRule([], 50), null);
    });

    it('returns null for an invalid purchase price, without throwing', () => {
      assert.equal(mods.matchUniversalPricingRule(rules, -5), null);
      assert.equal(mods.matchUniversalPricingRule(rules, NaN), null);
      assert.equal(mods.matchUniversalPricingRule(null, 50), null);
    });
  });

  describe('calculateUniversalSuggestion (same formula as the existing individual calculator)', () => {
    it('computes percentage-only profit', () => {
      const result = mods.calculateUniversalSuggestion({ fixedProfit: 0, profitPercent: 20 }, 100);
      assert.deepEqual(result, { fixedProfit: 0, profitPercent: 20, percentProfit: 20, totalProfit: 20, suggestedPrice: 120 });
    });

    it('computes fixed-only profit', () => {
      const result = mods.calculateUniversalSuggestion({ fixedProfit: 15, profitPercent: 0 }, 100);
      assert.deepEqual(result, { fixedProfit: 15, profitPercent: 0, percentProfit: 0, totalProfit: 15, suggestedPrice: 115 });
    });

    it('computes combined fixed + percentage profit — matches the spec\'s worked formula exactly', () => {
      // Suggested = purchase + fixed + (purchase * percent / 100)
      const result = mods.calculateUniversalSuggestion({ fixedProfit: 10, profitPercent: 12 }, 100);
      assert.equal(result.percentProfit, 12);
      assert.equal(result.totalProfit, 22);
      assert.equal(result.suggestedPrice, 122);
    });

    it('returns null when there is no matching rule, distinct from a legitimate ₹0 suggestion', () => {
      assert.equal(mods.calculateUniversalSuggestion(null, 100), null);
    });
  });

  describe('formatUniversalRange', () => {
    it('formats a bounded range and the open-ended final range', () => {
      assert.equal(mods.formatUniversalRange({ minPurchasePrice: 0, maxPurchasePrice: 100 }), '₹0–₹100');
      assert.equal(mods.formatUniversalRange({ minPurchasePrice: 500, maxPurchasePrice: null }), '₹500 onwards');
    });
  });

  describe('isUniversalSuggestionApplied (applied/Undo accuracy, pure)', () => {
    const suggestion = { fixedProfit: 10, profitPercent: 12, percentProfit: 12, totalProfit: 22, suggestedPrice: 122 };

    it('is false when nothing has been applied yet', () => {
      assert.equal(mods.isUniversalSuggestionApplied('122.00', suggestion, null), false);
    });

    it('is true right after applying: form.price matches the snapshot and the suggestion has not moved', () => {
      const snapshot = { previousPrice: '', appliedValue: '122.00' };
      assert.equal(mods.isUniversalSuggestionApplied('122.00', suggestion, snapshot), true);
    });

    it('goes false the moment the Selling Price is manually edited away from the applied value', () => {
      const snapshot = { previousPrice: '', appliedValue: '122.00' };
      assert.equal(mods.isUniversalSuggestionApplied('150.00', suggestion, snapshot), false);
    });

    it('goes false when the purchase price moves the suggestion, even though form.price was never touched', () => {
      const snapshot = { previousPrice: '', appliedValue: '122.00' };
      const movedSuggestion = { ...suggestion, suggestedPrice: 140 };
      assert.equal(mods.isUniversalSuggestionApplied('122.00', movedSuggestion, snapshot), false);
    });

    it('is false once there is no matching rule at all (no suggestion to compare against)', () => {
      const snapshot = { previousPrice: '', appliedValue: '122.00' };
      assert.equal(mods.isUniversalSuggestionApplied('122.00', null, snapshot), false);
    });
  });

  describe('rendering and structural wiring (initial render only — this SSR harness cannot simulate typing or clicks)', () => {
    it('renders the Add Product modal on first render, before categories or pricing rules have loaded', () => {
      const html = render(h(mods.ProductFormModal, { product: null, onClose() {}, onSaved() {} }), owner);
      assert.match(html, /Add New Product/);
      assert.match(html, /Universal Pricing/);
      assert.match(html, /Loading universal pricing rules/);
    });

    it('fetches pricing rules via the existing API client, from the same effect pattern as the existing /categories fetch', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.match(source, /api\.get\('\/settings\/pricing-rules'\)/);
      // Exactly one fetch of this endpoint — no per-keystroke refetching.
      assert.equal((source.match(/'\/settings\/pricing-rules'/g) || []).length, 1);
    });

    it('a 403 is handled separately from a genuine load error, and the section is not rendered at all when forbidden', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.match(source, /requestError\.response\?\.status === 403/);
      assert.match(source, /setUniversalRulesForbidden\(true\)/);
      assert.match(source, /\{!universalRulesForbidden && <div className="adm-soft-section adm-universal-pricing">/, 'the whole section is omitted, not just its data, when forbidden');
    });

    it('never introduces a product-repricing or bulk-update API call', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.ok(!/api\.(patch|put|post)\([^)]*reprice/i.test(source));
      assert.ok(!source.includes('/products/reprice') && !source.includes('/products/bulk'));
      // The only product-write calls remain exactly the two pre-existing ones (one backtick-templated
      // PUT for an edit, one single-quoted POST for a create).
      const productWrites = (source.match(/api\.(put|post)\((?:'|`)\/products/g) || []);
      assert.equal(productWrites.length, 2, 'only the existing single-product create/update calls may write to /products');
    });

    it('the universal suggestion has its own distinct "Use This" action, never reusing the individual calculator\'s handler', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.match(source, /function applyUniversalSuggestion\(\)/);
      assert.match(source, /onClick=\{applyUniversalSuggestion\}/);
      // The pre-existing individual "Use This" (an inline arrow function) must still be exactly as before.
      assert.match(source, /onClick=\{\(\) => setField\('price', suggested\.toFixed\(2\)\)\}/);
    });

    it('neither suggestion is applied automatically — both only ever write to price inside an onClick, never in a render-time or effect-time assignment', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.ok(!/useEffect\([^)]*setField\('price'/s.test(source), 'no effect may ever assign the selling price automatically');
    });

    it('the pre-existing individual calculator state, formula and GST block are byte-for-byte unchanged', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.match(source, /const \[purchasePrice, setPurchasePrice\] = useState\(''\)/);
      assert.match(source, /const \[fixedAmount, setFixedAmount\] = useState\(''\)/);
      assert.match(source, /const \[profitPercent, setProfitPercent\] = useState\(''\)/);
      assert.match(source, /const suggested = purchase \+ \(Number\(fixedAmount\) \|\| 0\) \+ \(purchase \* \(Number\(profitPercent\) \|\| 0\)\) \/ 100/);
      assert.match(source, /const finalPriceInclGst = selling \* \(1 \+ \(Number\(gstRate\) \|\| 0\) \/ 100\)/);
    });

    it('editing an existing product never auto-applies a suggestion: purchasePrice still starts blank regardless of the product being edited', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      // useState('') with no dependency on `product` — unchanged from before Stage 3, which is exactly
      // why opening Edit Product can never show (let alone apply) a suggestion until the owner types.
      const purchasePriceLine = source.match(/const \[purchasePrice, setPurchasePrice\] = useState\([^)]*\)/)[0];
      assert.ok(!purchasePriceLine.includes('product'));
    });

    it('still submits via the existing single create/update calls, with price taken from form.price — never from a universal/individual suggestion directly', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.match(source, /price: Number\(form\.price\)/);
      assert.match(source, /await api\.put\(`\/products\/\$\{product\._id\}`, payload\)/);
      assert.match(source, /await api\.post\('\/products', payload\)/);
    });

    it('applying snapshots the exact prior form.price (including an empty string) before overwriting it', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.match(source, /function applyUniversalSuggestion\(\) \{\s*if \(!universalSuggestion\) return\s*const appliedValue = universalSuggestion\.suggestedPrice\.toFixed\(2\)\s*setAppliedSnapshot\(\{ previousPrice: form\.price, appliedValue \}\)\s*setField\('price', appliedValue\)/);
    });

    it('Undo restores the exact pre-apply value (whatever it was, including empty) and clears the snapshot so "Use This" can apply again', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.match(source, /function undoUniversalSuggestion\(\) \{\s*if \(!appliedSnapshot\) return\s*setField\('price', appliedSnapshot\.previousPrice\)\s*setAppliedSnapshot\(null\)/);
    });

    it('the applied/Undo UI is derived from isUniversalSuggestionApplied, never from a separately-tracked "applied" boolean', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      assert.match(source, /const isUniversalApplied = isUniversalSuggestionApplied\(form\.price, universalSuggestion, appliedSnapshot\)/);
      assert.match(source, /\{isUniversalApplied \? \(/);
      assert.match(source, /onClick=\{undoUniversalSuggestion\}>Undo<\/button>/);
    });

    it('does not touch the individual calculator\'s own "Use This" / suggested-price box', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
      // The individual calculator's box is still the plain, single, unconditional adm-suggested-box with
      // its original inline handler — no isUniversalApplied-style branching was added around it.
      assert.match(source, /<div><span>Suggested selling price<\/span><strong>\{purchase > 0 \? `₹\$\{suggested\.toFixed\(2\)\}` : '—'\}<\/strong><\/div>\s*<button type="button" className="button button-outline" disabled=\{purchase <= 0\} onClick=\{\(\) => setField\('price', suggested\.toFixed\(2\)\)\}>Use This<\/button>/);
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

describe('adminNavigation: Vendors added under BUSINESS (Vendor Management Stage 2)', () => {
  it('adds exactly one Vendors item to BUSINESS, preserving Reports, Staff & Access and Settings in place', () => {
    const business = mods.adminNavigation.find((group) => group.label === 'BUSINESS');
    assert.ok(business, 'BUSINESS group must still exist');
    assert.deepEqual(business.items.map((item) => item.label), ['Reports', 'Staff & Access', 'Vendors', 'Settings']);
  });

  it('Vendors uses the same access rule as the existing per-product vendor data (products:manage or inventory:update) — not owner-only', () => {
    const business = mods.adminNavigation.find((group) => group.label === 'BUSINESS');
    const vendors = business.items.find((item) => item.label === 'Vendors');
    assert.ok(vendors);
    assert.equal(vendors.path, '/admin/vendors');
    assert.deepEqual(vendors.access, { any: ['products:manage', 'inventory:update'] });
  });

  it('Reports, Staff & Access and Settings keep their existing owner-only access, unchanged', () => {
    const business = mods.adminNavigation.find((group) => group.label === 'BUSINESS');
    for (const label of ['Reports', 'Staff & Access', 'Settings']) {
      const item = business.items.find((entry) => entry.label === label);
      assert.deepEqual(item.access, { owner: true }, label);
    }
  });
});

describe('Vendors routing (App.jsx structural checks)', () => {
  it('admin/vendors sits behind its own RequirePermission any=[products:manage, inventory:update] block, not the owner-only one', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const line = source.split('\n').find((entry) => entry.includes('path="admin/vendors"'));
    assert.ok(line, 'admin/vendors route must exist');

    const ownerOnlyBlock = source.slice(source.indexOf('RequirePermission ownerOnly'), source.indexOf('admin/delivery"'));
    assert.ok(!ownerOnlyBlock.includes('admin/vendors'), 'must not be owner-only, unlike Reports/Staff/Settings');

    const idx = source.indexOf('path="admin/vendors"');
    const precedingBlock = source.slice(Math.max(0, idx - 300), idx);
    assert.match(precedingBlock, /RequirePermission any=\{\['products:manage', 'inventory:update'\]\}/);
  });

  it('AdminVendorsPage is imported exactly once and used on exactly one route', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    // 3, not 2: the import line itself names "AdminVendorsPage" twice (the binding, and inside the
    // './pages/AdminVendorsPage' path string) — the one JSX usage on the route line is the 3rd.
    assert.equal((source.match(/AdminVendorsPage/g) || []).length, 3, 'one import line (binding + path) + one JSX usage');
  });
});

describe('filterVendors (pure search/status filtering for AdminVendorsPage)', () => {
  const vendors = [
    { _id: '1', name: 'Rajesh Vegetable Supplier', contactPerson: 'Rajesh Kumar', phone: '9876543210', status: 'Active' },
    { _id: '2', name: 'Singh Traders', contactPerson: 'Amarjeet Singh', phone: '9123456789', status: 'Inactive' },
    { _id: '3', name: 'Fresh Dairy Co', contactPerson: '', phone: '', status: 'Active' },
  ];

  it('returns every vendor when there is no search term and status is All', () => {
    assert.equal(mods.filterVendors(vendors, { search: '', status: 'All' }).length, 3);
  });

  it('matches by vendor name, case-insensitively', () => {
    assert.deepEqual(mods.filterVendors(vendors, { search: 'singh' }).map((v) => v._id), ['2']);
  });

  it('matches by contact person', () => {
    assert.deepEqual(mods.filterVendors(vendors, { search: 'kumar' }).map((v) => v._id), ['1']);
  });

  it('matches by phone', () => {
    assert.deepEqual(mods.filterVendors(vendors, { search: '91234' }).map((v) => v._id), ['2']);
  });

  it('never throws on a vendor with no contactPerson/phone at all, and still matches it by name', () => {
    assert.doesNotThrow(() => mods.filterVendors(vendors, { search: 'fresh' }));
    assert.deepEqual(mods.filterVendors(vendors, { search: 'fresh' }).map((v) => v._id), ['3']);
  });

  it('filters by status independently of search', () => {
    assert.deepEqual(mods.filterVendors(vendors, { status: 'Inactive' }).map((v) => v._id), ['2']);
    assert.deepEqual(mods.filterVendors(vendors, { status: 'Active' }).map((v) => v._id), ['1', '3']);
  });

  it('combines search and status — both must match', () => {
    assert.deepEqual(mods.filterVendors(vendors, { search: 'singh', status: 'Active' }).map((v) => v._id), []);
    assert.deepEqual(mods.filterVendors(vendors, { search: 'singh', status: 'Inactive' }).map((v) => v._id), ['2']);
  });

  it('trims and is otherwise whitespace-tolerant on the search term', () => {
    assert.deepEqual(mods.filterVendors(vendors, { search: '  SINGH  ' }).map((v) => v._id), ['2']);
  });
});

describe('AdminVendorsPage (Vendor Management Stage 2)', () => {
  it('renders the page shell on first render, before vendors have loaded', () => {
    const html = render(h(mods.AdminVendorsPage), owner);
    assert.match(html, /Vendors/);
    assert.match(html, /Add Vendor/);
    assert.match(html, /Loading vendors/);
    assert.match(html, /Search by name, contact person or phone/);
  });

  it('fetches from the existing GET \/vendors endpoint — no new endpoint invented', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /api\.get\('\/vendors'\)/);
  });

  it('deactivates via the existing PATCH /vendors/:id/deactivate endpoint, behind a confirmation dialog', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /api\.patch\(`\/vendors\/\$\{deactivateTarget\._id\}\/deactivate`\)/);
    assert.match(source, /Deactivate Vendor\?/);
  });

  it('Edit opens VendorFormModal, which itself reuses the existing create/update endpoints rather than inventing new ones', async () => {
    const { readFileSync } = await import('node:fs');
    const pageSource = readFileSync(new URL('../src/pages/AdminVendorsPage.jsx', import.meta.url), 'utf8');
    assert.match(pageSource, /<VendorFormModal/);
    const formSource = readFileSync(new URL('../src/components/VendorFormModal.jsx', import.meta.url), 'utf8');
    assert.match(formSource, /await api\.post\('\/vendors', payload\)/);
    assert.match(formSource, /await api\.put\(`\/vendors\/\$\{vendor\._id\}`, payload\)/);
  });

  it('shows distinct empty states for "no vendors at all" vs "no results for the current search/filters"', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /No vendors yet/);
    assert.match(source, /No vendors found/);
  });

  it('a vendor with 0 linked products is still shown, labelled "0 Products"', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /\{vendor\.productCount\} \{vendor\.productCount === 1 \? 'Product' : 'Products'\}/);
  });
});

describe('VendorFormModal (Vendor Management Stage 2)', () => {
  it('shows "Add New Vendor" with every field, and no status toggle, when creating', () => {
    const html = render(h(mods.VendorFormModal, { vendor: null, onClose() {}, onSaved() {} }), owner);
    assert.match(html, /Add New Vendor/);
    assert.ok(!html.includes('Vendor Status'), 'status toggle must not appear while creating — new vendors default to Active on the backend');
    assert.match(html, /Vendor name/);
    assert.match(html, /Contact person/);
    assert.match(html, />Phone</);
    assert.match(html, />Email</);
    assert.match(html, />Address</);
    assert.match(html, />Notes</);
  });

  it('shows "Edit Vendor" with the status toggle when editing an existing vendor', () => {
    const html = render(h(mods.VendorFormModal, { vendor: { _id: 'v1', name: 'Rajesh', status: 'Inactive' }, onClose() {}, onSaved() {} }), owner);
    assert.match(html, /Edit Vendor/);
    assert.match(html, /Vendor Status/);
  });

  it('uses POST /vendors to create and PUT /vendors/:id to update — the existing Stage 1 endpoints, nothing new', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /await api\.post\('\/vendors', payload\)/);
    assert.match(source, /await api\.put\(`\/vendors\/\$\{vendor\._id\}`, payload\)/);
  });

  it('requires a vendor name before submitting, the same convention as the existing product/category forms', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /Vendor name is required\./);
  });

  it('guards against a duplicate submission while a save is already in flight', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /if \(busy\) return/);
    assert.match(source, /disabled=\{busy\}/);
  });

  it('only sends status on an update, never on create — a new vendor always defaults to Active on the backend', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /\.\.\.\(isEdit \? \{ status: form\.active \? 'Active' : 'Inactive' \} : \{\}\)/);
  });
});

describe('Vendors access via RequirePermission (same real guard App.jsx wraps admin/vendors in)', () => {
  // Same convention as the existing RequirePermission tests at the top of this file: outside a real
  // <Routes> tree, the allowed branch's <Outlet/> renders nothing, so "allowed" is observed as "no
  // Access denied" rather than by asserting the wrapped page's own content appears.
  function guarded(user) {
    return render(h(mods.RequirePermission, { any: ['products:manage', 'inventory:update'] }, h(mods.AdminVendorsPage)), user);
  }

  it('the owner and staff holding products:manage or inventory:update are not denied', () => {
    for (const user of [owner, staff(['products:view', 'products:manage']), staff(['inventory:update'])]) {
      const html = guarded(user);
      assert.ok(!/Access denied/i.test(html), JSON.stringify(user.permissions || user.role));
    }
  });

  it('other staff, delivery-only staff and customers are denied, with the real AccessDenied screen', () => {
    for (const user of [staff(['orders:view']), staff(['delivery:view', 'delivery:update']), customer]) {
      const html = guarded(user);
      assert.match(html, /Access denied/i, JSON.stringify(user.permissions || user.role));
    }
  });
});

describe('vendorRowMode (pure — which identity UI a Vendor & Procurement row shows, Vendor Management Stage 3)', () => {
  it('a row never saved on this product (no embedded _id yet) is "new"', () => {
    assert.equal(mods.vendorRowMode({ _id: null, vendorRef: null }), 'new');
    assert.equal(mods.vendorRowMode({ _id: null, vendorRef: 'v1' }), 'new', 'a brand-new row is never "linked", even if something set vendorRef before it was ever saved');
  });

  it('a persisted row with a vendorRef is "linked"', () => {
    assert.equal(mods.vendorRowMode({ _id: 'embedded1', vendorRef: 'v1' }), 'linked');
  });

  it('a persisted row with no vendorRef is "legacy" — a pre-Stage-3 (or never-linked) assignment', () => {
    assert.equal(mods.vendorRowMode({ _id: 'embedded1', vendorRef: null }), 'legacy');
    assert.equal(mods.vendorRowMode({ _id: 'embedded1' }), 'legacy');
  });
});

describe('buildVendorOptions (pure — central vendor selector options, Vendor Management Stage 3)', () => {
  const vendors = [
    { _id: 'v1', name: 'Rajesh Vegetable Supplier', contactPerson: 'Rajesh Kumar', phone: '9876543210', status: 'Active' },
    { _id: 'v2', name: 'Singh Traders', contactPerson: 'Amarjeet Singh', phone: '9123456789', status: 'Inactive' },
    { _id: 'v3', name: 'Fresh Dairy Co', contactPerson: '', phone: '', status: 'Active' },
  ];

  it('offers only Active vendors by default — an Inactive vendor is never selectable for a new assignment', () => {
    const options = mods.buildVendorOptions(vendors, '', null);
    assert.deepEqual(options.map((v) => v._id), ['v1', 'v3']);
  });

  it('filters the Active list by name, contact person or phone, case-insensitively', () => {
    assert.deepEqual(mods.buildVendorOptions(vendors, 'rajesh', null).map((v) => v._id), ['v1']);
    assert.deepEqual(mods.buildVendorOptions(vendors, 'KUMAR', null).map((v) => v._id), ['v1']);
    assert.deepEqual(mods.buildVendorOptions(vendors, '98765', null).map((v) => v._id), ['v1']);
  });

  it('always includes the row\'s own currently-linked vendor, even if it is Inactive — an existing assignment is never silently dropped', () => {
    const options = mods.buildVendorOptions(vendors, '', 'v2');
    assert.ok(options.some((v) => v._id === 'v2'), 'the already-linked Inactive vendor must still appear');
    // Still only that one Inactive vendor — no OTHER inactive vendor is offered.
    assert.equal(options.filter((v) => v.status === 'Inactive').length, 1);
  });

  it('keeps the currently-linked vendor visible even when the search text would otherwise hide it', () => {
    const options = mods.buildVendorOptions(vendors, 'dairy', 'v2');
    assert.ok(options.some((v) => v._id === 'v2'), 'linked vendor must survive an unrelated search term');
    assert.ok(options.some((v) => v._id === 'v3'), '"dairy" still matches Fresh Dairy Co');
  });

  it('never duplicates the currently-linked vendor if it already matches the search/active filter on its own', () => {
    const options = mods.buildVendorOptions(vendors, 'rajesh', 'v1');
    assert.equal(options.filter((v) => v._id === 'v1').length, 1);
  });

  it('handles an empty vendor list without throwing', () => {
    assert.deepEqual(mods.buildVendorOptions([], 'anything', null), []);
    assert.deepEqual(mods.buildVendorOptions(undefined, '', null), []);
  });
});

describe('resolveCentralVendor (pure, Vendor Management Stage 3)', () => {
  const vendors = [{ _id: 'v1', name: 'Rajesh Vegetable Supplier', status: 'Active' }];

  it('finds a vendor by id', () => {
    assert.equal(mods.resolveCentralVendor(vendors, 'v1').name, 'Rajesh Vegetable Supplier');
  });

  it('returns null for no vendorRef, or a vendorRef that matches nothing', () => {
    assert.equal(mods.resolveCentralVendor(vendors, null), null);
    assert.equal(mods.resolveCentralVendor(vendors, 'does-not-exist'), null);
    assert.equal(mods.resolveCentralVendor([], 'v1'), null);
  });
});

describe('ProductFormModal: central Vendor selection (Vendor Management Stage 3)', () => {
  it('renders the Add Product modal on first render, before central vendors have loaded, with a blank "new" row', () => {
    const html = render(h(mods.ProductFormModal, { product: null, onClose() {}, onSaved() {} }), owner);
    assert.match(html, /Vendor &amp; Procurement/);
    assert.match(html, /Search vendors by name, contact or phone/);
    assert.match(html, /Loading vendors…|Select a vendor…/);
    assert.match(html, /Add New Vendor/);
  });

  it('fetches the existing GET /vendors endpoint, from the same once-on-mount effect pattern as /categories and /settings/pricing-rules', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /api\.get\('\/vendors'\)/);
    // Exactly one fetch of this endpoint — no per-keystroke refetching.
    assert.equal((source.match(/'\/vendors'/g) || []).length, 1);
  });

  it('never calls the vendor-creation endpoint directly — only the reused VendorFormModal does', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.ok(!/api\.(post|put|patch)\([^)]*\/vendors/.test(source), 'ProductFormModal itself must never write to /vendors — it only reads the list and renders VendorFormModal for writes');
  });

  it('a 403 from the central vendor fetch is handled separately from a genuine load error, exactly like the Universal Pricing section\'s existing 403 handling', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    const vendorsEffect = source.slice(source.indexOf("api.get('/vendors')"), source.indexOf("api.get('/vendors')") + 500);
    assert.match(vendorsEffect, /requestError\.response\?\.status === 403/);
    assert.match(vendorsEffect, /setCentralVendorsForbidden\(true\)/);
  });

  it('when the selector is unavailable (forbidden or errored), a row falls back to the pre-Stage-3 plain-text name field rather than breaking the form', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /const selectorAvailable = !centralVendorsForbidden && !centralVendorsError/);
    assert.match(source, /mode !== 'legacy' && selectorAvailable \? \(/);
  });

  it('a legacy row (persisted, no vendorRef) renders the original plain-text "Vendor \/ supplier name" field, completely unchanged', () => {
    const html = render(h(mods.ProductFormModal, {
      product: { _id: 'p1', name: 'Potato', category: 'Vegetables', description: 'x', price: 10, unit: 'kg', vendors: [{ _id: 'embedded1', name: 'Old Vendor Co', purchasePrice: 5 }] },
      onClose() {}, onSaved() {},
    }), owner);
    assert.match(html, /Vendor \/ supplier name/);
    assert.match(html, /Old Vendor Co/);
  });

  it('a linked row (persisted, with vendorRef) shows the selector and, before the fetch resolves, a "Loading linked vendor…" placeholder rather than nothing', () => {
    const html = render(h(mods.ProductFormModal, {
      product: { _id: 'p1', name: 'Potato', category: 'Vegetables', description: 'x', price: 10, unit: 'kg', vendors: [{ _id: 'embedded1', name: 'Rajesh Vegetable Supplier', purchasePrice: 5, vendorRef: 'v1' }] },
      onClose() {}, onSaved() {},
    }), owner);
    assert.match(html, /Loading linked vendor…/);
    assert.ok(!html.includes('Old Vendor Co'));
  });

  it('selecting a central vendor sets vendorRef and snapshots its current name onto the row, the same snapshot convention VendorPurchase/VendorPriceHistory already use', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /function selectCentralVendor\(id, vendorId\) \{/);
    assert.match(source, /vendorRef: vendorId \|\| null, name: central \? central\.name : vendor\.name/);
  });

  it('"Add New Vendor" reuses the existing VendorFormModal component — no vendor-creation logic is duplicated here', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /import VendorFormModal from '\.\/VendorFormModal'/);
    assert.match(source, /<VendorFormModal vendor=\{null\} onClose=\{\(\) => setQuickAddVendorTarget\(null\)\} onSaved=\{handleCentralVendorCreated\} \/>/);
  });

  it('creating a vendor inline automatically selects it on the row that opened "Add New Vendor" (handleCentralVendorCreated), without creating it a second time', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /setVendors\(\(current\) => current\.map\(\(vendor\) => \(vendor\.id === targetId \? \{ \.\.\.vendor, vendorRef: createdVendor\._id, name: createdVendor\.name \} : vendor\)\)\)/);
    const start = source.indexOf('function handleCentralVendorCreated');
    const fn = source.slice(start, start + 900);
    assert.ok(!fn.includes('api.post'), 'auto-selecting the created vendor must never itself call the create API again');
  });

  it('removing a vendor row is still purely local state — it never calls any vendor API, so it can never delete the central Vendor record or any history', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('function removeVendor');
    const fn = source.slice(start, start + 500);
    assert.match(fn, /setVendors\(\(current\) => current\.filter\(\(vendor\) => vendor\.id !== id\)\)/);
    assert.ok(!fn.includes('api.'));
  });

  it('submitting preserves the embedded vendor _id, includes vendorRef only when set, and keeps every other existing field (purchasePrice, moq, leadTime, preferred, lastPurchasePrice, lastPurchaseDate, notes)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /\.\.\.\(vendor\._id \? \{ _id: vendor\._id \} : \{\}\)/, 'the embedded _id is preserved exactly as before');
    assert.match(source, /\.\.\.\(vendor\.vendorRef \? \{ vendorRef: vendor\.vendorRef \} : \{\}\)/, 'vendorRef is only sent when the row actually has one');
    for (const field of ['purchasePrice: Number\\(vendor\\.purchasePrice\\) \\|\\| 0', 'moq: vendor\\.moq', 'leadTime: vendor\\.leadTime', 'preferred: vendor\\.preferred', "lastPurchasePrice: vendor\\.lastPurchasePrice === '' \\? null : Number\\(vendor\\.lastPurchasePrice\\)", "lastPurchaseDate: vendor\\.lastPurchaseDate \\|\\| null", 'notes: vendor\\.notes']) {
      assert.match(source, new RegExp(field), field);
    }
  });

  it('Price History and Purchase History still key off the embedded vendor _id, exactly as before — never the central vendorRef', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /setHistoryTarget\(\{ vendorId: vendor\._id, vendorName: vendor\.name, mode: 'price' \}\)/);
    assert.match(source, /setHistoryTarget\(\{ vendorId: vendor\._id, vendorName: vendor\.name, mode: 'purchase' \}\)/);
  });

  it('still submits via the existing single create/update calls — no new product-write or vendor-link endpoint was introduced', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    const productWrites = (source.match(/api\.(put|post)\((?:'|`)\/products/g) || []);
    assert.equal(productWrites.length, 2, 'only the existing single-product create/update calls may write to /products');
  });

  it('nothing about vendor selection happens inside an effect — only inside explicit onClick/onChange handlers, so nothing is auto-applied on mount or on a later re-render', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.ok(!/useEffect\([^)]*setVendors[^)]*vendorRef/s.test(source), 'no effect may assign vendorRef automatically');
  });

  it('the individual calculator, GST block and Universal Pricing section are still present, byte-for-byte unchanged by this stage', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/ProductFormModal.jsx', import.meta.url), 'utf8');
    assert.match(source, /const \[purchasePrice, setPurchasePrice\] = useState\(''\)/);
    assert.match(source, /const suggested = purchase \+ \(Number\(fixedAmount\) \|\| 0\) \+ \(purchase \* \(Number\(profitPercent\) \|\| 0\)\) \/ 100/);
    assert.match(source, /const finalPriceInclGst = selling \* \(1 \+ \(Number\(gstRate\) \|\| 0\) \/ 100\)/);
    assert.match(source, /const isUniversalApplied = isUniversalSuggestionApplied\(form\.price, universalSuggestion, appliedSnapshot\)/);
  });
});

describe('filterProductsByCategory (pure, AdminVendorDetailPage, Vendor Management Stage 4)', () => {
  const products = [
    { productId: 'p1', productName: 'Potato', category: 'Vegetables' },
    { productId: 'p2', productName: 'Milk', category: 'Dairy' },
  ];

  it('returns every product when category is "All" or unset', () => {
    assert.deepEqual(mods.filterProductsByCategory(products, 'All'), products);
    assert.deepEqual(mods.filterProductsByCategory(products, ''), products);
    assert.deepEqual(mods.filterProductsByCategory(products, undefined), products);
  });

  it('filters to only the matching category otherwise', () => {
    assert.deepEqual(mods.filterProductsByCategory(products, 'Dairy'), [products[1]]);
  });

  it('returns an empty list for a category nothing matches, without throwing', () => {
    assert.deepEqual(mods.filterProductsByCategory(products, 'Bakery'), []);
  });
});

describe('formatQuantityByUnit (pure, AdminVendorDetailPage, Vendor Management Stage 4)', () => {
  it('renders each unit bucket, never combining different units into one number', () => {
    assert.equal(mods.formatQuantityByUnit([{ unit: 'kg', quantity: 10 }, { unit: 'L', quantity: 5 }]), '10 kg, 5 L');
  });

  it('shows a placeholder for no data, rather than "0" (which would wrongly imply a known zero)', () => {
    assert.equal(mods.formatQuantityByUnit([]), '—');
    assert.equal(mods.formatQuantityByUnit(undefined), '—');
    assert.equal(mods.formatQuantityByUnit(null), '—');
  });
});

describe('AdminVendorsPage: View Details navigates to the new detail route (Vendor Management Stage 4)', () => {
  it('each vendor row has a View Details action that navigates to /admin/vendors/:id', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorsPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /navigate\(`\/admin\/vendors\/\$\{vendor\._id\}`\)/);
    assert.match(source, />View Details</);
  });
});

describe('Vendor detail routing (App.jsx structural checks, Vendor Management Stage 4)', () => {
  it('admin/vendors/:vendorId sits inside the exact same RequirePermission block as admin/vendors, not a new or owner-only one', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const start = source.indexOf("RequirePermission any={['products:manage', 'inventory:update']}");
    const block = source.slice(start, source.indexOf('</Route>', start));
    assert.match(block, /path="admin\/vendors"/);
    assert.match(block, /path="admin\/vendors\/:vendorId"/);
  });

  it('AdminVendorDetailPage is imported and used on exactly that one route', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.match(source, /import AdminVendorDetailPage from '\.\/pages\/AdminVendorDetailPage'/);
    assert.match(source, /<AdminVendorDetailPage \/>/);
  });
});

describe('AdminVendorDetailPage (Vendor Management Stage 4)', () => {
  it('renders the page shell on first render, before any of its four fetches have resolved', () => {
    const html = render(h(mods.AdminVendorDetailPage), owner, { path: '/admin/vendors/v1' });
    assert.match(html, /Loading vendor/);
  });

  it('fetches vendor info, products, purchases and price history from the existing vendor-profile endpoints — none newly invented beyond Stage 4\'s own additions', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /api\.get\(`\/vendors\/\$\{vendorId\}`\)/);
    assert.match(source, /api\.get\(`\/vendors\/\$\{vendorId\}\/products`\)/);
    assert.match(source, /api\.get\(`\/vendors\/\$\{vendorId\}\/purchases`, \{ params \}\)/);
    assert.match(source, /api\.get\(`\/vendors\/\$\{vendorId\}\/price-history`\)/);
  });

  it('the only write this page makes directly is the existing, reused purchase-receive call (Stage 7) — vendor/product CRUD is still left entirely to VendorFormModal/VendorPurchaseHistoryModal', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    const writeCalls = source.match(/api\.(post|put|patch|delete)\([^)]*\)/g) || [];
    assert.equal(writeCalls.length, 1, `expected exactly one direct write call, found: ${JSON.stringify(writeCalls)}`);
    assert.match(writeCalls[0], /\/products\/\$\{receiveTarget\.productId\}\/vendors\/\$\{receiveTarget\.vendorId\}\/purchases\/\$\{receiveTarget\._id\}\/receive/);
  });

  it('Edit Vendor reuses the existing VendorFormModal, passing the already-loaded vendor so no duplicate request or logic is needed', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /import VendorFormModal from '\.\.\/components\/VendorFormModal'/);
    assert.match(source, /<VendorFormModal vendor=\{vendor\} onClose=\{\(\) => setEditing\(false\)\} onSaved=\{setVendor\} \/>/);
  });

  it('purchase history refetches when the product or date filters change, not just once on mount', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /useEffect\(\(\) => \{ loadPurchases\(\) \}, \[vendorId, purchaseProductFilter, purchaseFrom, purchaseTo\]\)/);
  });

  it('the category filter is applied client-side via the pure filterProductsByCategory, not a refetch', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /const filteredProducts = filterProductsByCategory\(products, categoryFilter\)/);
    // The products fetch itself only ever depends on vendorId — changing the category filter must not
    // trigger a second /products request.
    const loadProductsEffect = source.slice(source.indexOf('useEffect(() => { loadProducts() }'), source.indexOf('useEffect(() => { loadProducts() }') + 60);
    assert.match(loadProductsEffect, /\[vendorId\]/);
  });

  it('shows clear empty states for products, purchases and price history independently, inventing no data', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /No linked products yet/);
    assert.match(source, /No purchases recorded yet/);
    assert.match(source, /No price changes yet/);
  });

  it('explicitly discloses that totals only include canonically-linked (vendorRef) records, not legacy unlinked ones', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /canonical record/i);
    assert.match(source, /unlinked/i);
  });

  it('Stage 4.1: the summary card is labelled "Received Goods Value", not just "Received", and never implies the vendor has been paid', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /Received Goods Value/);
    assert.ok(!/Received \(purchases\)/.test(source), 'the old ambiguous label must be gone');
    assert.ok(!/\bpaid\b/i.test(source), 'nothing on this page may claim the vendor was paid — there is no payment-tracking system');
    assert.ok(!/\bcleared\b/i.test(source));
  });

  it('Stage 4.1: a visible note clarifies these are goods values, not vendor payments, and that payment tracking does not exist', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /value of goods received or ordered, not payments made to vendors/i);
    assert.match(source, /payment tracking is not currently available/i);
  });

  it('"Ordered, not yet received" is unchanged', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /Ordered, not yet received/);
  });
});

describe('recordPurchaseAvailability (pure, AdminVendorDetailPage, Vendor Management Stage 6)', () => {
  it('disallows with no reason when the vendor has not loaded yet', () => {
    assert.deepEqual(mods.recordPurchaseAvailability(null, []), { allowed: false, reason: '' });
  });

  it('disallows an Inactive vendor, with a clear reason — a conservative frontend-only guard (no backend rule exists either way)', () => {
    const result = mods.recordPurchaseAvailability({ status: 'Inactive' }, [{ productId: 'p1' }]);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /inactive/i);
  });

  it('disallows an Active vendor with no linked products, with a clear reason', () => {
    const result = mods.recordPurchaseAvailability({ status: 'Active' }, []);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /no products/i);
  });

  it('allows an Active vendor with at least one linked product', () => {
    assert.deepEqual(mods.recordPurchaseAvailability({ status: 'Active' }, [{ productId: 'p1' }]), { allowed: true, reason: '' });
  });
});

describe('AdminVendorDetailPage: Record Purchase (Vendor Management Stage 6)', () => {
  it('the Record Purchase button is gated by inventory:update, the existing purchase-creation permission', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /\{can\('inventory:update'\) && \(/);
    assert.match(source, />Record Purchase</);
  });

  it('the button is disabled (with an explanatory title) whenever recordPurchaseAvailability says no', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /disabled=\{!recordAvailability\.allowed\}/);
    assert.match(source, /title=\{recordAvailability\.reason \|\| undefined\}/);
  });

  it('passes the matching EMBEDDED vendor subdocument id to the reused purchase form — never the central vendor\'s own _id', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /vendorId=\{recordPurchaseStep\.vendorId\}/);
    // The central vendor's own _id must never be used as that prop.
    assert.ok(!/VendorPurchaseHistoryModal[\s\S]{0,400}vendorId=\{vendor\._id\}/.test(source));
  });

  it('opens straight into the form for a single linked row, or a picker first when there is more than one', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /function openRecordPurchase\(\) \{\s*if \(products\.length === 1\) setRecordPurchaseStep\(products\[0\]\)\s*else setRecordPurchaseStep\('pick'\)/);
  });

  it('the picker only offers rows this vendor is actually linked to (products state, already resolved server-side by vendorRef)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /\{products\.map\(\(row\) => <option key=\{row\.vendorId\} value=\{row\.vendorId\}>/);
  });

  it('reuses the existing VendorPurchaseHistoryModal and its existing endpoint/validation — no competing purchase-creation implementation', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /import \{ VendorPurchaseHistoryModal \} from '\.\.\/components\/VendorHistoryModals'/);
    assert.match(source, /<VendorPurchaseHistoryModal/);
    assert.match(source, /autoOpenForm/);
    assert.ok(!/api\.post\(`?\/products/.test(source), 'this page must never itself post a purchase — only the reused modal does');
  });

  it('closing the purchase flow refreshes only purchase history/summary — the products list and vendor profile are left intact', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('function closeRecordPurchase');
    const fn = source.slice(start, start + 200);
    assert.match(fn, /loadPurchases\(\)/);
    assert.ok(!fn.includes('loadProducts('));
    assert.ok(!fn.includes('loadVendor('));
  });
});

describe('VendorPurchaseHistoryModal: autoOpenForm and live total (Vendor Management Stage 6, backward-compatible)', () => {
  it('without autoOpenForm (every existing caller, e.g. ProductFormModal), showForm still defaults to false — unchanged from before Stage 6', async () => {
    // This component's own data-fetching effect never resolves under this SSR harness (the same
    // limitation documented throughout this project), so a render always stays on "Loading purchase
    // history" regardless of showForm — the real proof has to be the source itself.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorHistoryModals.jsx', import.meta.url), 'utf8');
    assert.match(source, /export function VendorPurchaseHistoryModal\(\{ productId, vendorId, vendorName, unit, autoOpenForm = false, onClose \}\)/, 'autoOpenForm must default to false so every existing caller is unaffected');
    assert.match(source, /const \[showForm, setShowForm\] = useState\(autoOpenForm\)/, 'showForm must be wired directly to the prop, not a separate flag that could drift from it');
  });

  it('renders without throwing for both autoOpenForm values', () => {
    assert.doesNotThrow(() => render(h(mods.VendorPurchaseHistoryModal, { productId: 'p1', vendorId: 'e1', vendorName: 'Rajesh', unit: 'kg', onClose() {} }), owner));
    assert.doesNotThrow(() => render(h(mods.VendorPurchaseHistoryModal, { productId: 'p1', vendorId: 'e1', vendorName: 'Rajesh', unit: 'kg', autoOpenForm: true, onClose() {} }), owner));
  });

  it('shows the vendor\'s name clearly in the modal title, so the user knows which supplier the purchase belongs to', () => {
    const html = render(h(mods.VendorPurchaseHistoryModal, { productId: 'p1', vendorId: 'e1', vendorName: 'Rajesh Vegetable Supplier', unit: 'kg', autoOpenForm: true, onClose() {} }), owner);
    assert.match(html, /Purchase History — Rajesh Vegetable Supplier/);
  });

  it('the total amount is computed live as quantity × rate, the same formula used everywhere else in this codebase', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorHistoryModals.jsx', import.meta.url), 'utf8');
    assert.match(source, /\(Number\(form\.quantity\) \|\| 0\) \* \(Number\(form\.rate\) \|\| 0\)/);
  });

  it('existing validation, submission endpoint and receive behavior are completely unchanged', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorHistoryModals.jsx', import.meta.url), 'utf8');
    assert.match(source, /await api\.post\(`\/products\/\$\{productId\}\/vendors\/\$\{vendorId\}\/purchases`, \{ \.\.\.form, quantity, rate \}\)/);
    assert.match(source, /await api\.patch\(`\/products\/\$\{productId\}\/vendors\/\$\{vendorId\}\/purchases\/\$\{purchase\._id\}\/receive`\)/);
    assert.match(source, /if \(!Number\.isFinite\(quantity\) \|\| quantity <= 0\) return setFormError/);
    assert.match(source, /if \(!Number\.isFinite\(rate\) \|\| rate < 0\) return setFormError/);
  });
});

describe('filterPurchases (pure, AdminVendorDetailPage, Vendor Management Stage 7)', () => {
  const purchases = [
    { _id: 'pu1', productName: 'Potato', invoiceNumber: 'INV-100', status: 'Ordered' },
    { _id: 'pu2', productName: 'Onion', invoiceNumber: 'INV-200', status: 'Received' },
    { _id: 'pu3', productName: 'Tomato', invoiceNumber: '', status: 'Received' },
  ];

  it('returns everything with no search term and status All', () => {
    assert.deepEqual(mods.filterPurchases(purchases, { search: '', status: 'All' }), purchases);
  });

  it('matches by product name, case-insensitively', () => {
    assert.deepEqual(mods.filterPurchases(purchases, { search: 'onion' }).map((p) => p._id), ['pu2']);
  });

  it('matches by invoice number', () => {
    assert.deepEqual(mods.filterPurchases(purchases, { search: 'inv-100' }).map((p) => p._id), ['pu1']);
  });

  it('never throws on a purchase with a missing/empty invoice number', () => {
    assert.doesNotThrow(() => mods.filterPurchases(purchases, { search: 'tomato' }));
    assert.deepEqual(mods.filterPurchases(purchases, { search: 'tomato' }).map((p) => p._id), ['pu3']);
  });

  it('filters by status independently of search', () => {
    assert.deepEqual(mods.filterPurchases(purchases, { status: 'Ordered' }).map((p) => p._id), ['pu1']);
    assert.deepEqual(mods.filterPurchases(purchases, { status: 'Received' }).map((p) => p._id), ['pu2', 'pu3']);
  });

  it('combines search and status — both must match', () => {
    assert.deepEqual(mods.filterPurchases(purchases, { search: 'onion', status: 'Ordered' }), []);
    assert.deepEqual(mods.filterPurchases(purchases, { search: 'onion', status: 'Received' }).map((p) => p._id), ['pu2']);
  });

  it('handles an empty/undefined list without throwing', () => {
    assert.deepEqual(mods.filterPurchases([], { search: 'x' }), []);
    assert.deepEqual(mods.filterPurchases(undefined, { search: 'x' }), []);
  });
});

describe('isInvalidDateRange (pure, AdminVendorDetailPage, Vendor Management Stage 7)', () => {
  it('is true only when both dates are set and From is after To', () => {
    assert.equal(mods.isInvalidDateRange('2026-02-01', '2026-01-01'), true);
    assert.equal(mods.isInvalidDateRange('2026-01-01', '2026-02-01'), false);
    assert.equal(mods.isInvalidDateRange('2026-01-01', '2026-01-01'), false);
  });

  it('is false whenever either date is missing', () => {
    assert.equal(mods.isInvalidDateRange('', '2026-01-01'), false);
    assert.equal(mods.isInvalidDateRange('2026-01-01', ''), false);
    assert.equal(mods.isInvalidDateRange('', ''), false);
  });
});

describe('AdminVendorDetailPage: Purchase History improvements (Vendor Management Stage 7)', () => {
  it('search and status filters are wired to the pure filterPurchases, applied client-side over the already-fetched list', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /const filteredPurchases = filterPurchases\(purchases, \{ search: purchaseSearch, status: purchaseStatusFilter \}\)/);
    assert.match(source, /placeholder="Search by product name or invoice number…"/);
    assert.match(source, /value=\{purchaseStatusFilter\}/);
  });

  it('a date range where From is after To shows a clear explanation instead of a silently empty list', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /const invalidDateRange = isInvalidDateRange\(purchaseFrom, purchaseTo\)/);
    assert.match(source, /\{invalidDateRange && <p className="adm-muted">/);
  });

  it('Clear filters resets search, status, product and both dates together', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /function resetPurchaseFilters\(\) \{\s*setPurchaseProductFilter\(''\)\s*setPurchaseFrom\(''\)\s*setPurchaseTo\(''\)\s*setPurchaseSearch\(''\)\s*setPurchaseStatusFilter\('All'\)/);
    assert.match(source, /\{purchaseFiltersActive && <button type="button" className="filter-reset" onClick=\{resetPurchaseFilters\}>Clear filters<\/button>\}/);
  });

  it('distinguishes "no purchases at all" from "no purchases match the current filters"', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /No purchases recorded yet/);
    assert.match(source, /No purchases match/);
  });

  it('clicking View Details opens a modal showing every stored field — vendor, product, date, quantity/unit, rate, total, invoice, notes, status, received quantity and received date — inventing nothing', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /onClick=\{\(\) => setPurchaseDetailTarget\(purchase\)\}>View Details</);
    const start = source.indexOf('{purchaseDetailTarget && <Modal title="Purchase Details"');
    const modalSource = source.slice(start, start + 1400);
    for (const field of ['vendor\\?\\.name', 'purchaseDetailTarget\\.productName', 'purchaseDetailTarget\\.purchaseDate', 'purchaseDetailTarget\\.quantity', 'purchaseDetailTarget\\.rate', 'purchaseDetailTarget\\.totalAmount', 'purchaseDetailTarget\\.invoiceNumber', 'purchaseDetailTarget\\.notes', 'purchaseDetailTarget\\.status', 'purchaseDetailTarget\\.receivedQuantity', 'purchaseDetailTarget\\.receivedAt']) {
      assert.match(modalSource, new RegExp(field), field);
    }
  });

  it('Mark Received is only offered for an Ordered purchase, and only to a user with inventory:update — an already-Received purchase can never be re-received', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /\{purchase\.status === 'Ordered' && can\('inventory:update'\) && <button type="button" className="text-link" onClick=\{\(\) => setReceiveTarget\(purchase\)\}>Mark Received<\/button>\}/);
  });

  it('the receive confirmation dialog shows product, quantity, unit and total amount before calling the existing receive endpoint', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('{receiveTarget && <Modal title="Mark Purchase as Received?"');
    const modalSource = source.slice(start, start + 900);
    assert.match(modalSource, /receiveTarget\.productName/);
    assert.match(modalSource, /receiveTarget\.quantity/);
    assert.match(modalSource, /receiveTarget\.totalAmount/);
  });

  it('confirming receive calls the existing, unmodified receive endpoint and then refreshes purchases (which also refreshes the summary cards, from the same response)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    assert.match(source, /await api\.patch\(`\/products\/\$\{receiveTarget\.productId\}\/vendors\/\$\{receiveTarget\.vendorId\}\/purchases\/\$\{receiveTarget\._id\}\/receive`\)/);
    const start = source.indexOf('async function confirmReceive');
    const fn = source.slice(start, start + 600);
    assert.match(fn, /await loadPurchases\(\)/, 'must refresh purchases (and therefore the summary cards) after a successful receipt');
    assert.match(fn, /toast\('Purchase received/);
  });

  it('this is the same full-receipt endpoint and semantics VendorPurchaseHistoryModal already uses — no duplicate receiving logic, no partial receiving introduced', async () => {
    const { readFileSync } = await import('node:fs');
    const pageSource = readFileSync(new URL('../src/pages/AdminVendorDetailPage.jsx', import.meta.url), 'utf8');
    const modalSource = readFileSync(new URL('../src/components/VendorHistoryModals.jsx', import.meta.url), 'utf8');
    const pageEndpoint = pageSource.match(/\/products\/\$\{receiveTarget\.productId\}\/vendors\/\$\{receiveTarget\.vendorId\}\/purchases\/\$\{receiveTarget\._id\}\/receive/)[0];
    assert.ok(modalSource.includes('/purchases/${purchase._id}/receive'), 'the shared modal\'s own markReceived must still target the same receive sub-route shape');
    assert.ok(pageEndpoint.endsWith('/receive'));
  });
});

describe('sortVendorRows (pure, VendorAnalytics, Vendor Management Stage 8)', () => {
  const rows = [
    { vendorId: 'v1', purchaseCount: 2, orderedAmount: 100, receivedAmount: 50 },
    { vendorId: 'v2', purchaseCount: 5, orderedAmount: 400, receivedAmount: 10 },
    { vendorId: 'v3', purchaseCount: 1, orderedAmount: 200, receivedAmount: 300 },
  ];

  it('sorts by orderedAmount descending by default', () => {
    assert.deepEqual(mods.sortVendorRows(rows, 'orderedAmount').map((r) => r.vendorId), ['v2', 'v3', 'v1']);
  });

  it('sorts by receivedAmount or purchaseCount when asked', () => {
    assert.deepEqual(mods.sortVendorRows(rows, 'receivedAmount').map((r) => r.vendorId), ['v3', 'v1', 'v2']);
    assert.deepEqual(mods.sortVendorRows(rows, 'purchaseCount').map((r) => r.vendorId), ['v2', 'v1', 'v3']);
  });

  it('supports ascending order', () => {
    assert.deepEqual(mods.sortVendorRows(rows, 'orderedAmount', 'asc').map((r) => r.vendorId), ['v1', 'v3', 'v2']);
  });

  it('falls back to orderedAmount for an unrecognized sort key, rather than throwing', () => {
    assert.deepEqual(mods.sortVendorRows(rows, 'notARealField').map((r) => r.vendorId), ['v2', 'v3', 'v1']);
  });

  it('handles an empty/undefined list without throwing', () => {
    assert.deepEqual(mods.sortVendorRows([], 'orderedAmount'), []);
    assert.deepEqual(mods.sortVendorRows(undefined, 'orderedAmount'), []);
  });
});

describe('VendorAnalytics (Vendor Management Stage 8)', () => {
  it('renders the page shell on first render, before the analytics fetch resolves', () => {
    const html = render(h(mods.VendorAnalytics, { vendors: [] }), owner);
    assert.match(html, /Vendor Analytics/);
    assert.match(html, /Loading vendor analytics/);
    assert.match(html, /Export to Excel/);
  });

  it('fetches from the new, permission-gated /vendors/analytics endpoint, with filters forwarded as query params', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorAnalytics.jsx', import.meta.url), 'utf8');
    assert.match(source, /api\.get\('\/vendors\/analytics', \{ params: buildParams\(\) \}\)/);
    assert.match(source, /function buildParams\(\) \{/);
  });

  it('Export to Excel calls the existing /vendors/analytics/export endpoint as a blob, with the same filters, and never duplicates a second purchase API', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorAnalytics.jsx', import.meta.url), 'utf8');
    assert.match(source, /api\.get\('\/vendors\/analytics\/export', \{ params: buildParams\(\), responseType: 'blob' \}\)/);
    assert.ok(!/api\.(post|put|patch|delete)\(/.test(source), 'this component only ever reads analytics data — it never writes anything');
  });

  it('Clear filters resets vendor, product, status and both dates together', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorAnalytics.jsx', import.meta.url), 'utf8');
    assert.match(source, /const blankFilters = \{ vendorId: '', productId: '', status: 'All', from: '', to: '' \}/);
    assert.match(source, /function resetFilters\(\) \{ setFilters\(blankFilters\) \}/);
    assert.match(source, /\{filtersActive && <button type="button" className="filter-reset" onClick=\{resetFilters\}>Clear filters<\/button>\}/);
  });

  it('shows a dedicated empty state when there is no purchase data at all, distinct from the loading and error states', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorAnalytics.jsx', import.meta.url), 'utf8');
    assert.match(source, /No purchase data yet/);
    assert.match(source, /inline-error/);
    assert.match(source, /Loading vendor analytics/);
  });

  it('the summary cards keep Ordered Value and Received Goods Value separate, and never call it money paid to vendors', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorAnalytics.jsx', import.meta.url), 'utf8');
    assert.match(source, /<small>Ordered Value<\/small>/);
    assert.match(source, /<small>Received Goods Value<\/small>/);
    assert.ok(!/\bpaid\b/i.test(source));
    assert.ok(!/\bpayment\b/i.test(source) || /not track vendor payments/i.test(source), 'the only mention of "payment" may be the explicit disclosure that none is tracked');
  });

  it('price comparison explicitly discloses it only compares a vendor against its own previous rate in a compatible unit, and shows a dedicated empty state', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorAnalytics.jsx', import.meta.url), 'utf8');
    assert.match(source, /that same vendor's own prior purchase in the same unit/);
    assert.match(source, /No comparable products/);
  });

  it('explicitly discloses that legacy, unlinked vendor rows are excluded from every table', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorAnalytics.jsx', import.meta.url), 'utf8');
    assert.match(source, /Legacy embedded vendor rows with no canonical link are excluded/);
  });

  it('the monthly trend chart is responsive (scales via viewBox, not a fixed pixel size)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/components/VendorAnalytics.jsx', import.meta.url), 'utf8');
    assert.match(source, /viewBox=\{`0 0 \$\{Math\.max\(1, data\.monthly\.length\) \* 70\} 160`\}/);
    assert.match(source, /width: '100%'/);
  });
});

describe('AdminVendorsPage: Analytics view toggle (Vendor Management Stage 8)', () => {
  it('switches between the existing vendor list and the new VendorAnalytics component within the same page — no new route or navigation item', async () => {
    const { readFileSync } = await import('node:fs');
    const pageSource = readFileSync(new URL('../src/pages/AdminVendorsPage.jsx', import.meta.url), 'utf8');
    assert.match(pageSource, /import VendorAnalytics from '\.\.\/components\/VendorAnalytics'/);
    assert.match(pageSource, /onClick=\{\(\) => setView\('list'\)\}>Vendors<\/button>/);
    assert.match(pageSource, /onClick=\{\(\) => setView\('analytics'\)\}>Analytics<\/button>/);
    assert.match(pageSource, /<VendorAnalytics vendors=\{vendors\} \/>/);
    const navSource = readFileSync(new URL('../src/components/adminNavigation.js', import.meta.url), 'utf8');
    assert.ok(!/analytics/i.test(navSource), 'no new sidebar item was added for this');
    const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.ok(!/admin\/vendors\/analytics/i.test(appSource), 'no new route was added for this — it is a view toggle on the existing /admin/vendors route');
  });

  it('the existing vendor list (search, status filter, Add/Edit/Deactivate) is completely unchanged by the new toggle', async () => {
    const html = render(h(mods.AdminVendorsPage), owner);
    assert.match(html, /Vendors/);
    assert.match(html, /Add Vendor/);
    assert.match(html, /Loading vendors/);
  });
});
