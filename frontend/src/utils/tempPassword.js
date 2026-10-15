const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const DIGITS = '23456789'

// Client-side only: the server never generates, returns or stores a plain-text password.
export function generateTemporaryPassword(length = 14) {
  const pool = LETTERS + DIGITS
  const pick = (chars) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length]
  const characters = [pick(LETTERS), pick(DIGITS)]
  while (characters.length < length) characters.push(pick(pool))
  // Fisher–Yates so the guaranteed letter and digit are not always first.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1)
    ;[characters[index], characters[swap]] = [characters[swap], characters[index]]
  }
  return characters.join('')
}
