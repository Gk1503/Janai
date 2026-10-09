import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AdminComingSoon from './components/AdminComingSoon'
import AdminLayout from './components/AdminLayout'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import ScrollToTop from './components/ScrollToTop'
import { AuthProvider, CartProvider, ToastProvider } from './context/AppContexts'
import AdminPage from './pages/AdminPage'
import AdminCategoriesPage from './pages/AdminCategoriesPage'
import AdminProductsPage from './pages/AdminProductsPage'
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
        <Route path="admin" element={<AdminPage />} />
        <Route path="admin/products" element={<AdminProductsPage />} />
        <Route path="admin/categories" element={<AdminCategoriesPage />} />
        <Route path="admin/*" element={<AdminComingSoon />} />
      </Route>
    </Route>
  </Routes></BrowserRouter></CartProvider></AuthProvider></ToastProvider>
}
