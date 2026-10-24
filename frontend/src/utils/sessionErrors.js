// Credential endpoints legitimately answer 401 for a wrong password (or, for OTP, a wrong/expired code);
// those must not look like an expired session. Without the delivery-otp entries here, typing a wrong
// delivery OTP while some other account's session happens to still be valid in this browser (shared
// janai_token) would incorrectly sign that unrelated session out.
const CREDENTIAL_ENDPOINTS = [
  '/auth/login', '/auth/admin-login', '/auth/register', '/auth/change-password',
  '/auth/verify-login-otp', '/auth/send-login-otp', '/auth/resend-login-otp',
  '/auth/verify-delivery-otp', '/auth/send-delivery-otp', '/auth/resend-delivery-otp',
]

// Decides how the app reacts to a failed API call:
//   'sign-out'     the stored session is no longer valid (expired, or the account was deactivated)
//   'refresh-user' the account must change its temporary password; re-read it so the change screen appears
//   null           nothing special; the calling page shows its own error
export function classifyAuthError(error, hasToken) {
  const status = error?.response?.status
  const url = String(error?.config?.url || '')
  if (status === 401 && hasToken && !CREDENTIAL_ENDPOINTS.some((path) => url.includes(path))) return 'sign-out'
  if (status === 403 && error?.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') return 'refresh-user'
  return null
}
