// Tests the frontend's permission logic (pure JS, no React) from the backend test runner, and guards against
// the two permission catalogs drifting apart.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSION_LIST, REQUIRES, ROLE_PRESETS } from '../config/permissions.js';
import { adminNavigation } from '../../frontend/src/components/adminNavigation.js';
import * as ui from '../../frontend/src/utils/permissions.js';
import { generateTemporaryPassword } from '../../frontend/src/utils/tempPassword.js';
import { validateTemporaryPassword } from '../utils/staffValidation.js';

const owner = { role: 'admin', isActive: true };
const customer = { role: 'customer' };
const staff = (...permissions) => ({ role: 'staff', isActive: true, permissions });
const paths = (navigation) => navigation.flatMap((group) => group.items.map((item) => item.path));
const visible = (user) => paths(ui.filterNavigation(adminNavigation, ui.createCan(user), ui.isOwnerAccount(user)));

describe('frontend/backend catalogs stay in sync', () => {
  it('permission names are identical', () => {
    assert.deepEqual([...ui.PERMISSION_LIST].sort(), [...PERMISSION_LIST].sort());
  });

  it('prerequisites are identical', () => {
    assert.deepEqual(ui.REQUIRES, REQUIRES);
  });

  it('presets and their permissions are identical', () => {
    assert.deepEqual(Object.keys(ui.ROLE_PRESETS), Object.keys(ROLE_PRESETS));
    for (const [key, preset] of Object.entries(ROLE_PRESETS)) {
      assert.equal(ui.ROLE_PRESETS[key].label, preset.label);
      assert.deepEqual([...ui.ROLE_PRESETS[key].permissions].sort(), [...preset.permissions].sort());
    }
  });

  it('the permission form offers every permission exactly once', () => {
    const offered = ui.PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.permission));
    assert.deepEqual([...offered].sort(), [...PERMISSION_LIST].sort());
  });
});

describe('can()', () => {
  it('owner holds everything; customers, anonymous and inactive accounts nothing', () => {
    const can = ui.createCan(owner);
    assert.ok(PERMISSION_LIST.every((permission) => can(permission)));
    for (const user of [customer, null, undefined, { role: 'staff', isActive: false, permissions: ['orders:view'] }, { role: 'admin', isActive: false }]) {
      assert.equal(ui.createCan(user)('orders:view'), false);
    }
  });

  it('staff hold only stored, known permissions whose prerequisites are present', () => {
    const can = ui.createCan(staff('orders:view', 'orders:cancel', 'bogus', 'admin'));
    assert.equal(can('orders:view'), true);
    assert.equal(can('orders:cancel'), true);
    assert.equal(can('orders:update_status'), false);
    assert.equal(can('bogus'), false);
    assert.equal(ui.createCan(staff('orders:cancel'))('orders:cancel'), false); // no orders:view
    assert.equal(ui.createCan({ role: 'staff', permissions: 'orders:view' })('orders:view'), false); // malformed
  });

  it('reflects a refreshed user object', () => {
    assert.equal(ui.createCan(staff('orders:view'))('bulk:view'), false);
    assert.equal(ui.createCan(staff('orders:view', 'bulk:view'))('bulk:view'), true);
  });

  it('panel access is for owner and staff only', () => {
    assert.equal(ui.hasPanelAccess(owner), true);
    assert.equal(ui.hasPanelAccess(staff()), true);
    assert.equal(ui.hasPanelAccess(customer), false);
    assert.equal(ui.hasPanelAccess(null), false);
    assert.equal(ui.hasPanelAccess({ role: 'staff', isActive: false }), false);
  });
});

describe('sidebar filtering', () => {
  it('the owner sees every item, including Staff & Access', () => {
    assert.deepEqual(visible(owner), paths(adminNavigation));
    assert.ok(visible(owner).includes('/admin/staff'));
  });

  it('Staff & Access is owner-only, and sits above Settings', () => {
    for (const user of [staff(...PERMISSION_LIST), customer]) assert.ok(!visible(user).includes('/admin/staff'));
    const business = adminNavigation.find((group) => group.items.some((item) => item.path === '/admin/staff'));
    const labels = business.items.map((item) => item.label);
    assert.ok(labels.indexOf('Staff & Access') < labels.indexOf('Settings'));
  });

  it('staff see only what their permissions allow and empty groups disappear', () => {
    assert.deepEqual(visible(staff('orders:view', 'orders:update_status')), ['/admin/orders']);
    assert.deepEqual(visible(staff('preorders:view')), ['/admin/pre-orders']);
    assert.deepEqual(visible(staff('products:view', 'inventory:update')), ['/admin/products']);
    assert.deepEqual(visible(staff('inventory:update')), ['/admin/products']);
    assert.deepEqual(visible(staff('categories:manage')), ['/admin/categories']);
    assert.deepEqual(visible(staff('delivery:view')), ['/admin/delivery']);
    assert.deepEqual(visible(staff()), []);
    assert.deepEqual(visible(staff('not:real')), []);
    const groups = ui.filterNavigation(adminNavigation, ui.createCan(staff('customers:view')), false);
    assert.deepEqual(groups.map((group) => group.label), ['CUSTOMERS']);
  });

  it('every navigation item declares access, and items without one are owner-only', () => {
    for (const group of adminNavigation) for (const item of group.items) assert.ok(item.access, `${item.path} has no access rule`);
    assert.equal(ui.canAccessItem({ path: '/x' }, () => true, false), false);
  });

  it('the landing page is the first permitted section, or none', () => {
    assert.equal(ui.firstPermittedPath(adminNavigation, ui.createCan(owner), true), '/admin');
    assert.equal(ui.firstPermittedPath(adminNavigation, ui.createCan(staff('bulk:view')), false), '/admin/bulk-orders');
    assert.equal(ui.firstPermittedPath(adminNavigation, ui.createCan(staff('customers:view', 'orders:view')), false), '/admin/orders');
    assert.equal(ui.firstPermittedPath(adminNavigation, ui.createCan(staff()), false), null);
  });
});

describe('action helpers', () => {
  it('order actions follow the order type', () => {
    const can = ui.createCan(staff('orders:view', 'orders:update_status', 'preorders:view', 'preorders:update'));
    assert.deepEqual(ui.orderActions(can, { orderType: 'normal' }), { canUpdate: true, canCancel: false });
    assert.deepEqual(ui.orderActions(can, {}), { canUpdate: true, canCancel: false }); // legacy orders default to normal
    assert.deepEqual(ui.orderActions(can, { orderType: 'preorder' }), { canUpdate: true, canCancel: true });
    assert.deepEqual(ui.orderActions(can, { orderType: 'bulk' }), { canUpdate: false, canCancel: false });
    assert.deepEqual(ui.orderActions(can, { orderType: 'weird' }), { canUpdate: false, canCancel: false });
  });

  it('permission ticks keep selections valid', () => {
    assert.deepEqual([...ui.withPrerequisites(['orders:cancel'])].sort(), ['orders:cancel', 'orders:view']);
    assert.deepEqual(ui.withoutDependents(['orders:view', 'orders:cancel', 'bulk:view'], 'orders:view').sort(), ['bulk:view']);
  });

  it('preset labelling falls back to Custom when the ticks differ', () => {
    assert.equal(ui.presetKeyFor('order_manager', [...ROLE_PRESETS.order_manager.permissions]), 'order_manager');
    assert.equal(ui.presetKeyFor('order_manager', ['orders:view']), 'custom');
    assert.equal(ui.presetKeyFor('', []), 'custom');
  });

  it('generated temporary passwords satisfy the backend policy', () => {
    for (let index = 0; index < 50; index += 1) {
      const password = generateTemporaryPassword();
      assert.equal(validateTemporaryPassword(password, 'someone').error, undefined, password);
    }
  });
});
