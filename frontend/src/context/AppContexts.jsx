import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import api, { TOKEN_KEY } from '../services/api'
import { createCan, hasPanelAccess, isOwnerAccount } from '../utils/permissions'
import { classifyAuthError } from '../utils/sessionErrors'

const AuthContext = createContext(null)
const CartContext = createContext(null)
const ToastContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setAuthLoading(false)
      return
    }
    api.get('/auth/me').then(({ data }) => setUser(data.user)).catch(() => {
      localStorage.removeItem(TOKEN_KEY)
      setUser(null)
    }).finally(() => setAuthLoading(false))
  }, [])

  // Session handling for every API call: an expired or revoked session returns to sign-in, and a pending
  // forced password change re-reads the account so the change screen appears.
  useEffect(() => {
    const id = api.interceptors.response.use((response) => response, (error) => {
      const action = classifyAuthError(error, Boolean(localStorage.getItem(TOKEN_KEY)))
      if (action === 'sign-out') {
        localStorage.removeItem(TOKEN_KEY)
        setUser(null)
      }
      if (action === 'refresh-user') api.get('/auth/me').then(({ data }) => setUser(data.user)).catch(() => {})
      return Promise.reject(error)
    })
    return () => api.interceptors.response.eject(id)
  }, [])

  // Re-reads the account so permission or status changes made by the owner show up.
  async function refreshUser() {
    const { data } = await api.get('/auth/me')
    setUser(data.user)
    return data.user
  }

  // UI-only convenience: the backend enforces every permission regardless of what this returns.
  const can = useMemo(() => createCan(user), [user])
  const isOwner = isOwnerAccount(user)
  const panelAccess = hasPanelAccess(user)

  function saveSession(data) {
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    return data.user
  }

  async function login(credentials) {
    const { data } = await api.post('/auth/login', credentials)
    return saveSession(data)
  }

  async function adminLogin(credentials) {
    const { data } = await api.post('/auth/admin-login', credentials)
    return saveSession(data)
  }

  async function loginWithOtp(credentials) {
    const { data } = await api.post('/auth/verify-login-otp', credentials)
    return saveSession(data)
  }

  // Delivery staff sign-in: same session mechanism as every other login (saveSession -> the one shared
  // janai_token + user state), just a different verify endpoint. No second token or session system.
  async function loginWithDeliveryOtp(credentials) {
    const { data } = await api.post('/auth/verify-delivery-otp', credentials)
    return saveSession(data)
  }

  async function register(values) {
    const { data } = await api.post('/auth/register', values)
    return saveSession(data)
  }

  async function updateProfile(values) {
    const { data } = await api.put('/auth/me', values)
    setUser(data.user)
    return data.user
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, setUser, authLoading, login, adminLogin, loginWithOtp, loginWithDeliveryOtp, register, updateProfile, logout, refreshUser, can, isOwner, hasPanelAccess: panelAccess }}>{children}</AuthContext.Provider>
}

export function CartProvider({ children }) {
  const { user, authLoading } = useAuth()
  const [cart, setCart] = useState({ items: [] })
  const [cartLoading, setCartLoading] = useState(false)

  async function refreshCart() {
    const { data } = await api.get('/cart')
    setCart(data.cart)
    return data.cart
  }

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setCart({ items: [] })
      return
    }
    setCartLoading(true)
    refreshCart().catch(() => setCart({ items: [] })).finally(() => setCartLoading(false))
  }, [user?._id, authLoading])

  async function addItem(productId, quantity = 1) {
    const { data } = await api.post('/cart', { productId, quantity })
    setCart(data.cart)
  }
  async function setQuantity(productId, quantity) {
    const { data } = await api.put(`/cart/${productId}`, { quantity })
    setCart(data.cart)
  }
  async function removeItem(productId) {
    const { data } = await api.delete(`/cart/${productId}`)
    setCart(data.cart)
  }
  async function clearCart() {
    const { data } = await api.delete('/cart')
    setCart(data.cart)
  }

  const items = cart.items || []
  const count = items.reduce((sum, item) => sum + item.quantity, 0)
  const total = items.reduce((sum, item) => sum + (item.product?.price || 0) * item.quantity, 0)
  return <CartContext.Provider value={{ cart, items, count, total, cartLoading, addItem, setQuantity, removeItem, clearCart, refreshCart }}>{children}</CartContext.Provider>
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  function showToast(message, type = 'success') {
    setToast({ message, type })
    window.setTimeout(() => setToast(null), 3200)
  }
  return <ToastContext.Provider value={showToast}>{children}{toast && <div className={`toast toast-${toast.type}`} role="status">{toast.message}</div>}</ToastContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
export const useCart = () => useContext(CartContext)
export const useToast = () => useContext(ToastContext)
