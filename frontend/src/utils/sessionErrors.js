// Credential endpoints legitimately answer 401 for a wrong password; those must not look like an expired session.
const CREDENTIAL_ENDPOINTS = ['/auth/login', '/auth/admin-login', '/auth/verify-login-otp', '/auth/send-login-otp', '/auth/resend-login-otp', '/auth/register', '/auth/change-password']

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
