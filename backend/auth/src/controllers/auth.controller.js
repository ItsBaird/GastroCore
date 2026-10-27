import { login } from '../services/auth.service.js';

// El refresh token viaja solo en cookie httpOnly: el JavaScript del frontend nunca lo ve.
// Path acotado a /api/auth para que solo se envie a refresh y logout.
export const REFRESH_COOKIE = 'refreshToken';

export function refreshCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api/auth',
    expires: expiresAt,
  };
}

export async function loginController(req, res) {
  const { accessToken, refreshToken, refreshExpiresAt, user } = await login(req.valid.body);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(refreshExpiresAt));
  res.set('Cache-Control', 'no-store');
  res.json({ accessToken, user });
}
