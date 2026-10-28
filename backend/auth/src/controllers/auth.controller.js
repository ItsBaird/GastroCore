import { login, logout, refresh } from '../services/auth.service.js';

// El refresh token viaja solo en cookie httpOnly: el JavaScript del frontend nunca lo ve.
// Path acotado a /api/auth para que solo se envie a refresh y logout.
export const REFRESH_COOKIE = 'refreshToken';

const COOKIE_BASE = { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth' };

const refreshCookieOptions = (expiresAt) => ({ ...COOKIE_BASE, expires: expiresAt });
const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE, COOKIE_BASE);

function sendSession(res, { accessToken, refreshToken, refreshExpiresAt, user }) {
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(refreshExpiresAt));
  res.set('Cache-Control', 'no-store');
  res.json({ accessToken, user });
}

export async function loginController(req, res) {
  sendSession(res, await login(req.valid.body));
}

export async function refreshController(req, res) {
  try {
    sendSession(res, await refresh(req.cookies?.[REFRESH_COOKIE]));
  } catch (err) {
    // Una sesion invalida no deja cookie colgada en el navegador
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logoutController(req, res) {
  await logout(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  res.status(204).end();
}
