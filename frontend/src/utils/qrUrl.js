// URL publica de una mesa (lo que va dentro del QR): el origen del sitio + /m/<qrToken>.
// En Vercel window.location.origin es la URL real, sin cambiar codigo.
export const qrUrlFor = (qrToken, origin = window.location.origin) =>
  `${origin}/m/${encodeURIComponent(qrToken)}`
