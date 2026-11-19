import '@fontsource-variable/inter'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider.jsx'
import { ToastProvider } from './components/Toast.jsx'
import './styles/tokens.css'
import './styles/base.css'
import { PUBLIC_QR_SERVICES, SESSION_APP_SERVICES, wakeServices } from './utils/wakeServices.js'

// GC-QR-0001. Dos aplicaciones en paquetes separados (import dinamico, sin dependencias nuevas):
//   - /m/<qrToken>: vista publica del cliente, SIN AuthProvider (no pide /api/auth/refresh ni manda la cookie)
//     y sin descargar las pantallas de admin, mesero y cocina.
//   - todo lo demas: la app con sesion, igual que antes.
// eslint-disable-next-line react/only-export-components
const App = lazy(() => import('./App.jsx'))
// eslint-disable-next-line react/only-export-components
const PublicQrApp = lazy(() => import('./PublicQrApp.jsx'))

const isPublicQr = window.location.pathname.startsWith('/m/')

// Despierta en segundo plano los servicios que va a usar esta vista (Render gratis los apaga sin uso)
wakeServices(isPublicQr ? PUBLIC_QR_SERVICES : SESSION_APP_SERVICES)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        {isPublicQr ? (
          <PublicQrApp />
        ) : (
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        )}
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
