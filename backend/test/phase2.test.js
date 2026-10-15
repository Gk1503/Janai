import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ORDER_TYPE_PERMISSIONS, PERMISSION_LIST, REQUIRES, ROLE_PRESETS,
  canViewSupplierCosts, hasPermission, orderTypeCondition, permissionsOf, sanitizePermissions, viewableOrderTypes,
} from '../config/permissions.js';
import { requireAnyPermission, requireOwner, requirePanelAccess, requirePermission } from '../middleware/auth.js';
import { maskBulkOrder, maskEmail, maskOrder, maskPhone, maskUser, shouldMaskContact } from '../utils/privacy.js';

const owner = { role: 'admin', isActive: true };
const customer = { role: 'customer' };
const staff = (...permissions) => ({ role: 'staff', isActive: true, permissions });

function run(guard, user) {
  const out = { next: false, status: null };
  const res = { status(code) { out.status = code; return this; }, json() { return this; } };
  guard({ user }, res, () => { out.next = true; });
  return out;
}

describe('permission catalog', () => {
  it('has no duplicate permissions and every dependency refers to a real permission', () => {
    assert.equal(new Set(PERMISSION_LIST).size, PERMISSION_LIST.length);
    for (const [permission, required] of Object.entries(REQUIRES)) {
      assert.ok(PERMISSION_LIST.includes(permission));
      for (const entry of required) assert.ok(PERMISSION_LIST.includes(entry));
    }
  });

  it('does not define a way to hold Staff & Access', () => {
    assert.ok(!PERMISSION_LIST.some((permission) => /staff|access|role/i.test(permission)));
  });

  it('every preset contains only known permissions and satisfies its own dependencies', () => {
    for (const [key, preset] of Object.entries(ROLE_PRESETS)) {
      assert.deepEqual(sanitizePermissions(preset.permissions), preset.permissions, key);
      assert.equal(permissionsOf(staff(...preset.permissions)).size, preset.permissions.length, `${key} has an action without its view permission`);
    }
    assert.deepEqual(Object.keys(ROLE_PRESETS), ['order_manager', 'preorder_manager', 'bulk_order_manager', 'inventory_manager', 'customer_support', 'delivery_staff', 'custom']);
  });

  it('contact reveal is in the Order, Pre-Order and Customer Support presets only', () => {
    const withContact = Object.entries(ROLE_PRESETS).filter(([, preset]) => preset.permissions.includes('customers:view_contact')).map(([key]) => key).sort();
    assert.deepEqual(withContact, ['customer_support', 'order_manager', 'preorder_manager']);
  });
});

describe('effective permissions', () => {
  it('owner holds everything; customers and anonymous nothing', () => {
    assert.equal(permissionsOf(owner).size, PERMISSION_LIST.length);
    assert.equal(permissionsOf(customer).size, 0);
    assert.equal(permissionsOf(null).size, 0);
  });

  it('a customer carrying a permissions array still gets nothing', () => {
    assert.equal(hasPermission({ role: 'customer', permissions: ['orders:view'] }, 'orders:view'), false);
  });

  it('staff get only stored permissions; unknown strings are dropped; actions need their view permission', () => {
    assert.equal(hasPermission(staff('orders:view'), 'orders:view'), true);
    assert.equal(hasPermission(staff('orders:view'), 'orders:cancel'), false);
    assert.equal(hasPermission(staff('orders:cancel'), 'orders:cancel'), false);
    assert.equal(hasPermission(staff('admin', '*', 'owner'), 'orders:view'), false);
  });

  it('deactivated accounts hold nothing', () => {
    assert.equal(permissionsOf({ role: 'admin', isActive: false }).size, 0);
    assert.equal(permissionsOf({ role: 'staff', isActive: false, permissions: ['orders:view'] }).size, 0);
  });

  it('order types are governed by their own permissions', () => {
    assert.deepEqual(viewableOrderTypes(staff('orders:view')), ['normal']);
    assert.deepEqual(viewableOrderTypes(staff('preorders:view')), ['preorder']);
    assert.deepEqual(viewableOrderTypes(staff('bulk:view')), ['bulk']);
    assert.deepEqual(viewableOrderTypes(owner), ['normal', 'preorder', 'bulk']);
    assert.equal(ORDER_TYPE_PERMISSIONS.normal.cancel, 'orders:cancel');
    assert.equal(ORDER_TYPE_PERMISSIONS.preorder.cancel, 'preorders:update');
  });

  it('legacy orders without orderType are treated as normal', () => {
    assert.deepEqual(orderTypeCondition(['normal']).$in, ['normal', null]);
    assert.deepEqual(orderTypeCondition(['preorder']).$in, ['preorder']);
  });

  it('supplier costs are visible to the owner and products:view/manage only', () => {
    assert.equal(canViewSupplierCosts(owner), true);
    assert.equal(canViewSupplierCosts(staff('products:view')), true);
    assert.equal(canViewSupplierCosts(staff('inventory:update')), false);
    assert.equal(canViewSupplierCosts(staff('orders:view')), false);
    assert.equal(canViewSupplierCosts(customer), false);
    assert.equal(canViewSupplierCosts(undefined), false);
  });
});

describe('guards', () => {
  it('requirePermission: owner passes, staff with it passes, others get 403', () => {
    const guard = requirePermission('orders:view');
    assert.equal(run(guard, owner).next, true);
    assert.equal(run(guard, staff('orders:view')).next, true);
    for (const user of [staff('bulk:view'), staff(), customer, undefined]) assert.equal(run(guard, user).status, 403);
  });

  it('requireAnyPermission passes with any one of the permissions', () => {
    const guard = requireAnyPermission('products:manage', 'inventory:update');
    assert.equal(run(guard, staff('inventory:update')).next, true);
    assert.equal(run(guard, staff('products:view', 'products:manage')).next, true);
    assert.equal(run(guard, staff('orders:view')).status, 403);
  });

  it('requireOwner rejects staff even with every permission; requirePanelAccess rejects customers', () => {
    assert.equal(run(requireOwner, owner).next, true);
    assert.equal(run(requireOwner, staff(...PERMISSION_LIST)).status, 403);
    assert.equal(run(requirePanelAccess, staff()).next, true);
    assert.equal(run(requirePanelAccess, customer).status, 403);
  });
});

describe('contact masking', () => {
  it('masks emails and phones without revealing the full value', () => {
    assert.equal(maskEmail('cust.omer@gmail.com'), 'c***@gmail.com');
    assert.match(maskPhone('+91 98765 01234'), /^\*+34$/);
    assert.ok(!maskPhone('9876501234').includes('98765'));
  });

  it('only staff without customers:view_contact are masked', () => {
    assert.equal(shouldMaskContact(owner), false);
    assert.equal(shouldMaskContact(customer), false);
    assert.equal(shouldMaskContact(staff('orders:view')), true);
    assert.equal(shouldMaskContact(staff('orders:view', 'customers:view_contact')), false);
  });

  it('masks orders, bulk requests and users for masked viewers and leaves others intact', () => {
    const order = { user: { firstName: 'A', email: 'a@b.com', phone: '9876501234' }, deliveryAddress: { recipient: 'A', phone: '9876501234', street: 's' } };
    const masked = maskOrder(order, staff('orders:view'));
    assert.ok(!JSON.stringify(masked).includes('9876501234') && !JSON.stringify(masked).includes('a@b.com'));
    assert.equal(masked.deliveryAddress.street, 's');
    assert.deepEqual(maskOrder(order, owner), order);
    assert.equal(order.user.email, 'a@b.com'); // input is not mutated
    const bulk = { name: 'Cafe', email: 'c@d.com', phone: '9811122233' };
    assert.ok(!JSON.stringify(maskBulkOrder(bulk, staff('bulk:view'))).includes('c@d.com'));
    assert.equal(maskBulkOrder(bulk, staff('bulk:view', 'customers:view_contact')).email, 'c@d.com');
    assert.ok(!JSON.stringify(maskUser({ email: 'a@b.com', phone: '9876501234', addresses: [{ phone: '9876501234' }] }, staff('customers:view'))).includes('9876501234'));
  });
});

describe('supplier cost wiring', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('cart population never includes vendors', () => {
    const cart = read('../controllers/cartController.js');
    assert.ok(!cart.includes("populate('items.product')"));
    assert.equal((cart.match(/select: '-vendors'/g) || []).length, 4);
  });

  it('public product reads exclude vendors unless the viewer may see supplier costs', () => {
    const products = read('../controllers/productController.js');
    assert.match(products, /withSupplierVisibility\(Product\.find\(filter\), req\.user\)/);
    assert.match(products, /withSupplierVisibility\(Product\.findById\(req\.params\.id\), req\.user\)/);
    assert.match(products, /select\('-vendors'\)/);
  });
});
