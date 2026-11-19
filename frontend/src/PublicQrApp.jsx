import { Route, Routes } from 'react-router-dom'
import { ToastProvider } from './components/Toast.jsx'
import PublicMenuPage, { InvalidQrPage } from './pages/PublicMenuPage.jsx'

// GC-QR-0001. App publica del canal QR (/m/:qrToken). Se monta SIN AuthProvider: el cliente del restaurante
// no tiene sesion y la pagina no debe pedir /api/auth/refresh ni mandar la cookie de un mesero. Se carga en su
// propio paquete (import dinamico en main.jsx) para no descargar las pantallas de admin y mesero en 4G.
export default function PublicQrApp() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/m/:qrToken" element={<PublicMenuPage />} />
        <Route path="*" element={<InvalidQrPage />} />
      </Routes>
    </ToastProvider>
  )
}
