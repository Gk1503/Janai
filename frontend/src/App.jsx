import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AdminComingSoon from './components/AdminComingSoon'
import AdminLayout from './components/AdminLayout'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import RequirePermission from './components/RequirePermission'
import ScrollToTop from './components/ScrollToTop'
import { AuthProvider, CartProvider, ToastProvider } from './context/AppContexts'
import AdminHomePage from './pages/AdminHomePage'
import AdminStaffPage from './pages/AdminStaffPage'
import AdminCategoriesPage from './pages/AdminCategoriesPage'
import AdminCustomerDetailPage from './pages/AdminCustomerDetailPage'
import AdminCustomersPage from './pages/AdminCustomersPage'
import AdminProductsPage from './pages/AdminProductsPage'
import { AdminBulkOrdersPage, AdminOrdersPage, AdminPreOrdersPage } from './pages/AdminOrderPages'
import { AboutPage, AdminLoginPage, ContactPage, ForgotPasswordPage, LoginPage, RegisterPage } from './pages/AccountPages'
import BulkOrdersPage from './pages/BulkOrdersPage'
import NotFoundPage from './pages/NotFoundPage'
import { CartPage, CheckoutPage, OrderDetailPage, OrdersPage, PreOrdersPage, ProfilePage } from './pages/OrderPages'
import { HomePage, ProductPage, ShopPage } from './pages/StorePages'
import './Janai.css'

export default function App() {
  return <ToastProvider><AuthProvider><CartProvider><BrowserRouter><ScrollToTop /><Routes>
    <Route element={<Layout />}>
      <Route index element={<HomePage />} />
      <Route path="shop" element={<ShopPage />} />
      <Route path="product/:id" element={<ProductPage />} />
      <Route path="products/:id" element={<ProductPage />} />
      <Route path="cart" element={<CartPage />} />
      <Route path="pre-orders" element={<PreOrdersPage />} />
      <Route path="bulk-orders" element={<BulkOrdersPage />} />
      <Route path="about" element={<AboutPage />} />
      <Route path="contact" element={<ContactPage />} />
      <Route path="login" element={<LoginPage />} />
      <Route path="register" element={<RegisterPage />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="404" element={<NotFoundPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
    <Route path="admin/login" element={<AdminLoginPage />} />
    <Route element={<ProtectedRoute admin />}>
      <Route element={<AdminLayout />}>
        {/* Every group below is permission-gated: a page that is not allowed never mounts, so it fetches nothing.
            The same permissions are enforced again by the backend on every API call. */}
        <Route path="admin" element={<AdminHomePage />} />
        <Route element={<RequirePermission any={['products:view', 'inventory:update']} />}>
          <Route path="admin/products" element={<AdminProductsPage />} />
        </Route>
        <Route element={<RequirePermission any={['orders:view']} />}>
          {/* :view is the status tab (pending, processing, ...); the list stays mounted while switching tabs */}
          <Route path="admin/orders/:view?" element={<AdminOrdersPage />} />
        </Route>
        <Route element={<RequirePermission any={['preorders:view']} />}>
          <Route path="admin/pre-orders" element={<AdminPreOrdersPage key="pre-all" view="all" />} />
          <Route path="admin/pre-orders/scheduled" element={<AdminPreOrdersPage key="pre-scheduled" view="scheduled" />} />
        </Route>
        <Route element={<RequirePermission any={['bulk:view']} />}>
          <Route path="admin/bulk-orders" element={<AdminBulkOrdersPage key="bulk-all" view="all" />} />
          <Route path="admin/bulk-orders/requests" element={<AdminBulkOrdersPage key="bulk-requests" view="requests" />} />
        </Route>
        <Route element={<RequirePermission any={['categories:manage']} />}>
          <Route path="admin/categories" element={<AdminCategoriesPage />} />
        </Route>
        <Route element={<RequirePermission any={['customers:view']} />}>
          <Route path="admin/customers" element={<AdminCustomersPage />} />
          <Route path="admin/customers/:id" element={<AdminCustomerDetailPage />} />
        </Route>
        <Route element={<RequirePermission ownerOnly />}>
          <Route path="admin/staff" element={<AdminStaffPage />} />
        </Route>
        <Route element={<RequirePermission any={['delivery:view']} />}>
          <Route path="admin/delivery" element={<AdminComingSoon />} />
        </Route>
        {/* Everything else under /admin is a placeholder and owner-only. */}
        <Route element={<RequirePermission ownerOnly />}>
          <Route path="admin/*" element={<AdminComingSoon />} />
        </Route>
      </Route>
    </Route>
  </Routes></BrowserRouter></CartProvider></AuthProvider></ToastProvider>
}
