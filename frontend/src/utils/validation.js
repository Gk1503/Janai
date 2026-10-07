// Shared form rules. Messages are written for customers, not developers.

export const TIME_SLOTS = ['8:00 AM - 10:00 AM', '10:00 AM - 12:00 PM', '12:00 PM - 2:00 PM', '2:00 PM - 4:00 PM', '4:00 PM - 6:00 PM', '6:00 PM - 8:00 PM']

export const digitsOnly = (value, max) => String(value || '').replace(/\D/g, '').slice(0, max)
// Strips a pasted +91 / leading 0 so "+91 98765 43210" becomes "9876543210".
export const mobileDigits = (value) => {
  const digits = String(value || '').replace(/\D/g, '')
  return (digits.length > 10 ? digits.replace(/^(91|0)/, '') : digits).slice(0, 10)
}

export const localDate = (offset = 0) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function validateName(value, label = 'name') {
  const name = String(value || '').trim()
  if (!name) return `Enter your ${label}.`
  if (name.length < 2) return `${label[0].toUpperCase()}${label.slice(1)} is too short.`
  if (!/[A-Za-zऀ-ॿ]/.test(name) || /\d/.test(name)) return `Enter a valid ${label} without numbers.`
  return ''
}
export function validateMobile(value, { required = true } = {}) {
  if (!value) return required ? 'Enter your 10-digit mobile number.' : ''
  if (!/^\d{10}$/.test(value)) return 'Mobile number must be exactly 10 digits.'
  if (!/^[6-9]/.test(value)) return 'Enter a valid Indian mobile number starting with 6, 7, 8 or 9.'
  return ''
}
export function validateEmail(value, { required = true } = {}) {
  const email = String(value || '').trim()
  if (!email) return required ? 'Enter your email address.' : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Enter a valid email address, like name@example.com.'
  return ''
}
export function validatePincode(value) {
  if (!value) return 'Enter your 6-digit pincode.'
  if (!/^[1-9]\d{5}$/.test(value)) return 'Pincode must be 6 digits and cannot start with 0.'
  return ''
}
export function validateRequired(value, message) { return String(value || '').trim() ? '' : message }
export function validateQuantity(value, { min = 1, max } = {}) {
  const quantity = Number(value)
  if (value === '' || value === null || value === undefined) return 'Enter a quantity.'
  if (!Number.isInteger(quantity) || quantity < min) return `Quantity must be a whole number of at least ${min}.`
  if (max && quantity > max) return `Maximum quantity is ${max}.`
  return ''
}
export function validateFutureDate(value, { minOffset = 1 } = {}) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00`).getTime())) return 'Choose a valid date.'
  if (value < localDate(minOffset)) return minOffset > 0 ? 'Choose a date from tomorrow onwards.' : 'Choose today or a later date.'
  return ''
}

export const blankAddress = { recipient: '', phone: '', house: '', street: '', landmark: '', postalCode: '' }

export function validateAddress(address) {
  const errors = {
    recipient: validateName(address.recipient, 'full name'),
    phone: validateMobile(address.phone),
    house: validateRequired(address.house, 'Enter your house, flat or building.'),
    street: validateRequired(address.street, 'Enter your street, area or locality.'),
    postalCode: validatePincode(address.postalCode),
  }
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message))
}

// Works for both the new structured address and older saved addresses (street/city/state only).
export function formatAddress(address = {}) {
  return [address.house, address.street, address.landmark && `Near ${address.landmark}`, address.city, address.state, address.postalCode].filter((part) => String(part || '').trim()).join(', ')
}

export const hasErrors = (errors) => Object.values(errors).some(Boolean)
