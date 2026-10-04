import jwt from 'jsonwebtoken';

export function createToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

export function sendAuth(res, user, status = 200) {
  return res.status(status).json({ token: createToken(user.id), user: user.toSafeJSON() });
}
