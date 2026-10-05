import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, Leaf, Mail, MapPin, Phone, Sprout, Truck } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'

function AuthFrame({ eyebrow, title, description, children, footer, standalone = false }) {
  return <section className="auth-page"><aside className="auth-photo"><img src="/Hero-image.png" alt="Fresh produce from Janai" /></aside><div className="auth-panel">{!standalone && <Link className="auth-back" to="/"><ArrowLeft size={16} />Back to Janai</Link>}<div className="auth-panel-inner">{standalone ? <div className="auth-logo"><img src="/Janai-logo.jpg" alt="Janai" /></div> : <Link className="auth-logo" to="/" aria-label="Janai home"><img src="/Janai-logo.jpg" alt="Janai, Fruits Vegetables Groceries" /></Link>}<span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="auth-description">{description}</p>{children}{footer && <div className="auth-footer">{footer}</div>}</div></div></section>
}

export function LoginPage() {
  const { login, loginWithOtp } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState('otp')
  const [mobile, setMobile] = useState('')
  const [otp, setOtp] = useState(Array(6).fill(''))
  const [otpStep, setOtpStep] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [passwordForm, setPasswordForm] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const otpRefs = useRef([])

  useEffect(() => {
    if (!cooldown) return undefined
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function sendOtp(resend = false) {
    setError('')
    if (!/^[6-9]\d{9}$/.test(mobile)) { setError('Enter a valid 10-digit Indian mobile number.'); return }
    setBusy(true)
    try {
      const endpoint = resend ? '/auth/resend-login-otp' : '/auth/send-login-otp'
      const { data } = await api.post(endpoint, { mobile })
      setOtpStep(true)
      setOtp(Array(6).fill(''))
      setCooldown(30)
      if (!resend) window.setTimeout(() => otpRefs.current[0]?.focus(), 0)
      toast(data.message || (resend ? 'A new OTP has been sent.' : 'OTP sent successfully.'))
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }

  async function verifyOtp(event) {
    event.preventDefault()
    const code = otp.join('')
    if (code.length !== 6) { setError('Enter the complete 6-digit OTP.'); return }
    setBusy(true)
    setError('')
    try {
      const user = await loginWithOtp({ mobile, otp: code })
      toast(`Welcome to Janai, ${user.firstName}.`)
      navigate(location.state?.from || '/', { replace: true })
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }

  function editOtp(index, value) {
    const digits = value.replace(/\D/g, '')
    if (digits.length > 1) {
      const pasted = digits.slice(0, 6).split('')
      setOtp((current) => current.map((digit, position) => pasted[position] ?? digit))
      otpRefs.current[Math.min(pasted.length, 5)]?.focus()
      return
    }
    setOtp((current) => current.map((digit, position) => position === index ? digits : digit))
    if (digits && index < 5) otpRefs.current[index + 1]?.focus()
  }

  function otpKeyDown(index, event) {
    if (event.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < 5) otpRefs.current[index + 1]?.focus()
  }

  function changeMobile() {
    setOtpStep(false)
    setOtp(Array(6).fill(''))
    setCooldown(0)
    setError('')
  }

  async function passwordLogin(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user = await login(passwordForm)
      toast(`Welcome back, ${user.firstName}.`)
      navigate(location.state?.from || '/', { replace: true })
    } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }

  return <AuthFrame eyebrow="FRESHNESS AT YOUR DOORSTEP" title={otpStep ? 'Verify OTP' : 'Welcome Back!'} description={otpStep ? `OTP sent to +91 ${mobile}` : 'Sign in to keep your fresh picks, orders and plans together.'} footer={<>New to Janai? <Link to="/register">Create your account <ArrowRight size={14} /></Link></>}>
    {mode === 'otp' ? otpStep ? <form className="auth-form" onSubmit={verifyOtp}><p className="otp-instruction">Enter the 6-digit code sent to <strong>+91 {mobile}</strong>.</p><div className="otp-input-row" role="group" aria-label="6-digit one-time password">{otp.map((digit, index) => <input key={index} ref={(element) => { otpRefs.current[index] = element }} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} aria-label={`OTP digit ${index + 1}`} maxLength={1} value={digit} onChange={(event) => editOtp(index, event.target.value)} onKeyDown={(event) => otpKeyDown(index, event)} onPaste={(event) => { event.preventDefault(); editOtp(index, event.clipboardData.getData('text')) }} />)}</div>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy || otp.join('').length !== 6}>{busy ? 'Verifying…' : 'Verify OTP'}<ArrowRight size={16} /></button><div className="otp-actions"><button type="button" className="text-link" disabled={busy || cooldown > 0} onClick={() => sendOtp(true)}>{cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}</button><button type="button" className="text-link" disabled={busy} onClick={changeMobile}>Change mobile number</button></div></form> : <form className="auth-form" onSubmit={(event) => { event.preventDefault(); sendOtp(false) }}><label className="field"><span>Mobile Number</span><div className="phone-input"><span>+91</span><input type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} required value={mobile} onChange={(event) => setMobile(event.target.value.replace(/\D/g, '').replace(/^91/, '').slice(0, 10))} placeholder="10 digit mobile number" /></div></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy || mobile.length !== 10}>{busy ? 'Sending OTP…' : 'Send OTP'}<ArrowRight size={16} /></button><button className="auth-switch" type="button" onClick={() => { setMode('password'); setError('') }}>Use email and password</button><p className="auth-secure"><Sprout size={14} />Only existing Janai accounts can sign in with OTP.</p></form> : <form className="auth-form" onSubmit={passwordLogin}><label className="field"><span>Email address</span><input required type="email" autoComplete="email" value={passwordForm.email} onChange={(event) => setPasswordForm({ ...passwordForm, email: event.target.value })} placeholder="you@example.com" /></label><label className="field"><span>Password</span><input required type="password" autoComplete="current-password" value={passwordForm.password} onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })} /></label><div className="auth-form-aside"><span /><Link to="/forgot-password">Forgot password?</Link></div>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></button><button className="auth-switch" type="button" onClick={() => { setMode('otp'); setError('') }}>Sign in with mobile OTP</button></form>}
  </AuthFrame>
}

export function RegisterPage() {
  const { register } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (form.password.length < 8) { setError('Use at least 8 characters for your password.'); return }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return }
    setBusy(true)
    setError('')
    try { const user = await register(form); toast(`Welcome to Janai, ${user.firstName}.`); navigate('/', { replace: true }) } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }
  return <AuthFrame eyebrow="A FRESH START" title="Create your account" description="A few details and your next grocery run gets easier." footer={<>Already have an account? <Link to="/login">Sign in<ArrowRight size={14} /></Link></>}><form className="auth-form" onSubmit={submit}><div className="form-grid"><label className="field"><span>First name</span><input required autoComplete="given-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label><label className="field"><span>Last name</span><input required autoComplete="family-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label><label className="field field-wide"><span>Email</span><input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label className="field field-wide"><span>Phone</span><input required type="tel" autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label className="field"><span>Password</span><input required minLength="8" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><label className="field"><span>Confirm password</span><input required minLength="8" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label></div>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}<ArrowRight size={16} /></button><p className="auth-secure"><Check size={14} />Passwords are securely hashed.</p></form></AuthFrame>
}

export function ForgotPasswordPage() {
  return <AuthFrame eyebrow="ACCOUNT HELP" title="Let’s get you back in" description="Password reset email is not enabled yet. Contact Janai support for help."><div className="contact-card"><Mail size={18} /><div><strong>Janai support</strong><a href="mailto:hello@janai.in">hello@janai.in</a></div></div><Link className="button button-primary button-full" to="/contact">Contact support<ArrowRight size={16} /></Link></AuthFrame>
}

export function AboutPage() {
  return <div className="page-container info-page"><span className="eyebrow">GOOD FOOD, CLOSER TO HOME</span><h1>Freshness is a community effort.</h1><p>Janai brings fresh fruits, vegetables and everyday groceries from local growers and makers to the homes and businesses that need them.</p><div className="info-grid"><article><Leaf /><h2>Fresh products</h2><p>Thoughtfully selected produce, cared for from harvest to handoff.</p></article><article><Truck /><h2>Fast delivery</h2><p>Reliable delivery for everyday grocery runs.</p></article><article><CalendarDays /><h2>Plan ahead</h2><p>Schedule pre-orders around the date you need.</p></article></div><Link className="button button-primary" to="/shop">Explore the shop<ArrowRight size={16} /></Link></div>
}

export function ContactPage() {
  const toast = useToast()
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: 'General question', message: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { const { data } = await api.post('/contact', form); toast(data.message || 'Message sent.'); setForm({ name: '', email: '', phone: '', subject: 'General question', message: '' }) } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }
  return <section className="page-container contact-page"><div className="page-title-row"><div><span className="eyebrow">WE’RE HERE TO HELP</span><h1>Contact Janai</h1></div></div><div className="contact-layout"><form className="contact-form" onSubmit={submit}><div className="form-grid"><label className="field"><span>Name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="field"><span>Email</span><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label className="field"><span>Phone</span><input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label className="field"><span>Subject</span><select value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })}><option>General question</option><option>Order support</option><option>Pre-orders</option><option>Bulk orders</option></select></label><label className="field field-wide"><span>Message</span><textarea required rows="5" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></label></div>{error && <div className="form-error">{error}</div>}<button className="button button-primary" disabled={busy}>{busy ? 'Sending…' : 'Send message'}<ArrowRight size={16} /></button></form><aside className="contact-aside"><h2>Need a hand?</h2><p><Phone size={16} /> +91 98765 43210</p><p><Mail size={16} /> hello@janai.in</p><p><MapPin size={16} /> Serving local homes and businesses</p></aside></div></section>
}

export function AdminLoginPage() {
  const { adminLogin, user } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ adminId: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user?.role === 'admin') navigate('/admin', { replace: true })
  }, [user, navigate])

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await adminLogin(form)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(getApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return <AuthFrame standalone eyebrow="JANAI OPERATIONS" title="Admin Login" description="Sign in with your admin ID and password."><form className="auth-form" onSubmit={submit}><label className="field"><span>Admin ID</span><input required autoComplete="username" value={form.adminId} onChange={(event) => setForm({ ...form, adminId: event.target.value })} /></label><label className="field"><span>Password</span><input required type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>{error && <div className="inline-error">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={15} /></button></form></AuthFrame>
}
