import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, Leaf, Mail, MapPin, Phone, Sprout, Truck } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api, { getApiError } from '../services/api'
import { useAuth, useToast } from '../context/AppContexts'
import { Field, PhoneInput } from '../components/Forms'
import { hasErrors, validateEmail, validateMobile, validateName, validateRequired } from '../utils/validation'

const authCategories = [['Fruits', '/fruit.jpg'], ['Vegetables', '/Vegatables.png'], ['Groceries', '/grocery.jpg']]

function AuthFrame({ eyebrow, title, description, children, footer, standalone = false }) {
  return <section className="auth-page"><aside className="auth-photo"><img src="/Vegatables.png" alt="" aria-hidden="true" /><div className="auth-photo-copy"><span className="eyebrow"><Leaf size={14} />FRESH · LOCAL · DELIVERED</span><h2>Fresh fruits, vegetables &amp; groceries — at your doorstep.</h2><div className="auth-chips">{authCategories.map(([label, image]) => <span key={label}><img src={image} alt="" />{label}</span>)}</div><ul><li><Truck size={16} />Delivery on the date you choose</li><li><CalendarDays size={16} />Pre-order for later in a few taps</li><li><Sprout size={16} />Bulk orders for businesses &amp; events</li></ul></div></aside><div className="auth-panel">{!standalone && <Link className="auth-back" to="/"><ArrowLeft size={16} />Back to Home</Link>}<div className="auth-panel-inner">{standalone ? <div className="auth-logo"><img src="/Janai-logo.jpg" alt="Janai" /></div> : <Link className="auth-logo" to="/" aria-label="Janai home"><img src="/Janai-logo.jpg" alt="Janai, Fruits Vegetables Groceries" /></Link>}<span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="auth-description">{description}</p>{children}{footer && <div className="auth-footer">{footer}</div>}</div></div></section>
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
    {mode === 'otp' ? otpStep ? <form className="auth-form" onSubmit={verifyOtp}><p className="otp-instruction">Enter the 6-digit code sent to <strong>+91 {mobile}</strong>.</p><div className="otp-input-row" role="group" aria-label="6-digit one-time password">{otp.map((digit, index) => <input key={index} ref={(element) => { otpRefs.current[index] = element }} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} aria-label={`OTP digit ${index + 1}`} maxLength={1} value={digit} onChange={(event) => editOtp(index, event.target.value)} onKeyDown={(event) => otpKeyDown(index, event)} onPaste={(event) => { event.preventDefault(); editOtp(index, event.clipboardData.getData('text')) }} />)}</div>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy || otp.join('').length !== 6}>{busy ? 'Verifying…' : 'Verify OTP'}<ArrowRight size={16} /></button><div className="otp-actions"><button type="button" className="text-link" disabled={busy || cooldown > 0} onClick={() => sendOtp(true)}>{cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}</button><button type="button" className="text-link" disabled={busy} onClick={changeMobile}>Change mobile number</button></div></form> : <form className="auth-form" onSubmit={(event) => { event.preventDefault(); sendOtp(false) }}><Field label="Mobile Number" required><PhoneInput value={mobile} onChange={(value) => { setMobile(value); setError('') }} required /></Field>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy || mobile.length !== 10}>{busy ? 'Sending OTP…' : 'Send OTP'}<ArrowRight size={16} /></button><button className="auth-switch" type="button" onClick={() => { setMode('password'); setError('') }}>Use email and password</button><p className="auth-secure"><Sprout size={14} />Only existing Janai accounts can sign in with OTP.</p></form> : <form className="auth-form" onSubmit={passwordLogin}><label className="field"><span>Email address</span><input required type="email" autoComplete="email" value={passwordForm.email} onChange={(event) => setPasswordForm({ ...passwordForm, email: event.target.value })} placeholder="you@example.com" /></label><label className="field"><span>Password</span><input required type="password" autoComplete="current-password" value={passwordForm.password} onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })} /></label><div className="auth-form-aside"><span /><Link to="/forgot-password">Forgot password?</Link></div>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></button><button className="auth-switch" type="button" onClick={() => { setMode('otp'); setError('') }}>Sign in with mobile OTP</button></form>}
  </AuthFrame>
}

export function RegisterPage() {
  const { register } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key, value) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: '' })) }
  async function submit(event) {
    event.preventDefault()
    const nextErrors = {
      firstName: validateName(form.firstName, 'first name'),
      lastName: validateName(form.lastName, 'last name'),
      email: validateEmail(form.email),
      phone: validateMobile(form.phone),
      password: form.password.length < 8 ? 'Use at least 8 characters for your password.' : '',
      confirmPassword: form.password !== form.confirmPassword ? 'Passwords do not match.' : '',
    }
    setErrors(nextErrors)
    if (hasErrors(nextErrors)) { setError(''); return }
    setBusy(true)
    setError('')
    try { const user = await register(form); toast(`Welcome to Janai, ${user.firstName}.`); navigate('/', { replace: true }) } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }
  return <AuthFrame eyebrow="A FRESH START" title="Create your account" description="A few details and your next grocery run gets easier." footer={<>Already have an account? <Link to="/login">Sign in<ArrowRight size={14} /></Link></>}><form className="auth-form" onSubmit={submit} noValidate><div className="form-grid"><Field label="First name" required error={errors.firstName}><input autoComplete="given-name" value={form.firstName} onChange={(event) => set('firstName', event.target.value)} /></Field><Field label="Last name" required error={errors.lastName}><input autoComplete="family-name" value={form.lastName} onChange={(event) => set('lastName', event.target.value)} /></Field><Field label="Email" required wide error={errors.email}><input type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(event) => set('email', event.target.value.trim())} placeholder="you@example.com" /></Field><Field label="Mobile Number" required wide error={errors.phone} hint="Used for OTP sign-in."><PhoneInput value={form.phone} onChange={(value) => set('phone', value)} invalid={Boolean(errors.phone)} /></Field><Field label="Password" required error={errors.password} hint="At least 8 characters."><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => set('password', event.target.value)} /></Field><Field label="Confirm password" required error={errors.confirmPassword}><input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => set('confirmPassword', event.target.value)} /></Field></div>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}<ArrowRight size={16} /></button><p className="auth-secure"><Check size={14} />Passwords are securely hashed.</p></form></AuthFrame>
}

export function ForgotPasswordPage() {
  return <AuthFrame eyebrow="ACCOUNT HELP" title="Let’s get you back in" description="Password reset email is not enabled yet. Contact Janai support for help."><div className="contact-card"><Mail size={18} /><div><strong>Janai support</strong><a href="mailto:hello@janai.in">hello@janai.in</a></div></div><Link className="button button-primary button-full" to="/contact">Contact support<ArrowRight size={16} /></Link></AuthFrame>
}

export function AboutPage() {
  return <div className="page-container info-page"><span className="eyebrow">GOOD FOOD, CLOSER TO HOME</span><h1>Freshness is a community effort.</h1><p>Janai brings fresh fruits, vegetables and everyday groceries from local growers and makers to the homes and businesses that need them.</p><div className="info-grid"><article><Leaf /><h2>Fresh products</h2><p>Thoughtfully selected produce, cared for from harvest to handoff.</p></article><article><Truck /><h2>Fast delivery</h2><p>Reliable delivery for everyday grocery runs.</p></article><article><CalendarDays /><h2>Plan ahead</h2><p>Schedule pre-orders around the date you need.</p></article></div><Link className="button button-primary" to="/shop">Explore the shop<ArrowRight size={16} /></Link></div>
}

const contactSubjects = ['General question', 'Order support', 'Delivery issue', 'Pre-orders', 'Bulk orders', 'Product quality', 'Feedback & suggestions']

export function ContactPage() {
  const toast = useToast()
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: 'General question', message: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key, value) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: '' })) }
  async function submit(event) {
    event.preventDefault(); setError('')
    const nextErrors = { name: validateName(form.name), email: validateEmail(form.email), phone: validateMobile(form.phone, { required: false }), message: validateRequired(form.message, 'Tell us how we can help.') || (form.message.trim().length < 10 ? 'Please add a few more details (at least 10 characters).' : '') }
    setErrors(nextErrors)
    if (hasErrors(nextErrors)) return
    setBusy(true)
    try { const { data } = await api.post('/contact', form); toast(data.message || 'Message sent.'); setForm({ name: '', email: '', phone: '', subject: 'General question', message: '' }) } catch (requestError) { setError(getApiError(requestError)) } finally { setBusy(false) }
  }
  return <section className="page-container contact-page"><div className="page-title-row"><div><span className="eyebrow">WE’RE HERE TO HELP</span><h1>Contact Janai</h1></div></div><div className="contact-layout"><form className="contact-form" onSubmit={submit} noValidate><div className="form-grid"><Field label="Name" required error={errors.name}><input autoComplete="name" value={form.name} onChange={(event) => set('name', event.target.value)} /></Field><Field label="Email" required error={errors.email}><input type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(event) => set('email', event.target.value.trim())} placeholder="you@example.com" /></Field><Field label="Mobile Number" optional error={errors.phone}><PhoneInput value={form.phone} onChange={(value) => set('phone', value)} invalid={Boolean(errors.phone)} /></Field><Field label="Subject" required><select value={form.subject} onChange={(event) => set('subject', event.target.value)}>{contactSubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select></Field><Field label="Message" required wide error={errors.message}><textarea rows="4" maxLength="2000" value={form.message} onChange={(event) => set('message', event.target.value)} placeholder="How can we help?" /></Field></div>{error && <div className="form-error">{error}</div>}<button className="button button-primary" disabled={busy}>{busy ? 'Sending…' : 'Send message'}<ArrowRight size={16} /></button></form><aside className="contact-aside"><h2>Need a hand?</h2><p><Phone size={16} /> +91 98765 43210</p><p><Mail size={16} /> hello@janai.in</p><p><MapPin size={16} /> Serving local homes and businesses</p></aside></div></section>
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
