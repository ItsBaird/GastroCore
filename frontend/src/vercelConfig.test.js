// frontend/vercel.json (despliegue en Vercel): reenvios a Render, fallback de la SPA y cabeceras. Vercel no tiene
// nginx: este archivo hace de puerta de entrada. Las rutas de Vercel usan la sintaxis de path-to-regexp; las que son
// una expresion regular entre parentesis se prueban aqui con RegExp de JavaScript (misma semantica).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf8'))
const SERVICES = ['auth', 'staff', 'catalog', 'orders']
const regex = (source) => new RegExp(`^${source}$`)
const headersFor = (source) => config.headers.find((h) => h.source === source)?.headers ?? []
const header = (source, key) => headersFor(source).find((h) => h.key === key)?.value

describe('reenvios a Render', () => {
  it.each(SERVICES)('/api/%s/* va al servicio de Render con la misma ruta', (service) => {
    const rule = config.rewrites.find((r) => r.source === `/api/${service}/:path*`)
    expect(rule.destination).toBe(`https://gastrocore-${service}.onrender.com/api/${service}/:path*`)
  })

  it('todos los destinos son https (la cookie de sesion es Secure)', () => {
    for (const r of config.rewrites.filter((r) => r.source.startsWith('/api/'))) {
      expect(r.destination.startsWith('https://')).toBe(true)
    }
  })

  it('el fallback de la SPA es la ultima regla y manda a index.html', () => {
    expect(config.rewrites.at(-1).destination).toBe('/index.html')
  })

  it.each(['/', '/login', '/admin/ventas', '/mesero/mesas', '/m/abc123', '/cocina'])(
    'la ruta de la SPA %s cae en index.html',
    (url) => {
      expect(regex(config.rewrites.at(-1).source).test(url)).toBe(true)
    },
  )

  it.each(['/api/otro/x', '/api/auth/login', '/assets/index-abc.js'])(
    '%s NO cae en index.html (una API desconocida es 404, no la app)',
    (url) => {
      expect(regex(config.rewrites.at(-1).source).test(url)).toBe(false)
    },
  )
})

describe('cabeceras de seguridad (GC-160, GC-161)', () => {
  const PAGES = '/((?!api/).*)'

  it('se aplican a la app y no a /api (las respuestas de la API ya traen las de helmet)', () => {
    expect(regex(PAGES).test('/login')).toBe(true)
    expect(regex(PAGES).test('/api/auth/login')).toBe(false)
  })

  it('HSTS de 2 años, nosniff, sin marcos, referrer acotado y permisos del navegador apagados', () => {
    expect(header(PAGES, 'Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains')
    expect(header(PAGES, 'X-Content-Type-Options')).toBe('nosniff')
    expect(header(PAGES, 'X-Frame-Options')).toBe('DENY')
    expect(header(PAGES, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(header(PAGES, 'Permissions-Policy')).toContain('camera=()')
  })

  describe('Content-Security-Policy', () => {
    const csp = Object.fromEntries(
      header(PAGES, 'Content-Security-Policy')
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .map(([name, ...values]) => [name, values]),
    )

    it('solo scripts y estilos propios: nada en linea ni de terceros', () => {
      expect(csp['script-src']).toEqual(["'self'"])
      expect(csp['style-src']).toEqual(["'self'"])
      expect(csp['default-src']).toEqual(["'self'"])
      expect(csp['object-src']).toEqual(["'none'"])
    })

    it('imagenes propias, el QR (data:) y la vista previa de la foto del producto (blob:)', () => {
      expect(csp['img-src']).toEqual(["'self'", 'data:', 'blob:'])
    })

    it('el socket directo a Orders en Render (Vercel no reenvia websockets)', () => {
      expect(csp['connect-src']).toEqual([
        "'self'",
        'wss://gastrocore-orders.onrender.com',
        'https://gastrocore-orders.onrender.com',
      ])
    })

    it('no se puede incrustar en marcos ni cambiar la base o el destino de formularios', () => {
      expect(csp['frame-ancestors']).toEqual(["'none'"])
      expect(csp['base-uri']).toEqual(["'self'"])
      expect(csp['form-action']).toEqual(["'self'"])
      expect(csp).toHaveProperty('upgrade-insecure-requests')
    })
  })

  it('la vista publica del QR (/m/*) no la indexan los buscadores', () => {
    expect(header('/m/:path*', 'X-Robots-Tag')).toBe('noindex, nofollow')
  })
})

describe('cache', () => {
  it('los archivos con hash de assets/ se guardan un año (inmutables)', () => {
    expect(header('/assets/:path*', 'Cache-Control')).toBe('public, max-age=31536000, immutable')
  })

  it('index.html y las rutas de la app se revalidan siempre (un despliegue nuevo se ve de inmediato)', () => {
    const rule = '/((?!api/|assets/).*)'
    expect(header(rule, 'Cache-Control')).toBe('no-cache')
    expect(regex(rule).test('/index.html')).toBe(true)
    expect(regex(rule).test('/assets/x.js')).toBe(false)
  })

  it('no toca la cache de /api (la decide cada servicio: fotos 7 dias, Excel no-store)', () => {
    for (const h of config.headers) {
      if (h.headers.some((x) => x.key === 'Cache-Control')) {
        expect(h.source.startsWith('/api')).toBe(false)
        if (h.source.startsWith('/(')) expect(regex(h.source).test('/api/catalog/photos/x.jpg')).toBe(false)
      }
    }
  })
})
