import { Download, LoaderCircle, Printer, TriangleAlert } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal.jsx'
import { qrUrlFor } from '../utils/qrUrl.js'
import './QrPrintModal.css'

// QR imprimible de una mesa (aprobado por Oscar; propuesta sin Figma). Se genera EN EL NAVEGADOR con la
// libreria qrcode: el token de la mesa no sale hacia ningun servicio externo. Apunta a
// window.location.origin + /m/<qrToken>: en Vercel sale la URL real sin cambiar codigo. Los QR definitivos
// se imprimen despues del despliegue final (si cambia el dominio o se recrea la mesa, hay que reimprimir).

const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 512,
  color: { dark: '#0a0a0a', light: '#ffffff' },
}

const isLocalOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)

// PNG listo para imprimir: tarjeta blanca de 600x800 con marca, mesa, QR y la indicacion
async function buildPng(url, tableNumber) {
  const qrCanvas = document.createElement('canvas')
  await QRCode.toCanvas(qrCanvas, url, { ...QR_OPTIONS, width: 440 })
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 800
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#dc2626'
  ctx.font = '700 30px "Inter Variable", system-ui, sans-serif'
  ctx.fillText('La Pizzeta', 300, 70)
  ctx.fillStyle = '#0a0a0a'
  ctx.font = '700 64px "Inter Variable", system-ui, sans-serif'
  ctx.fillText(`Mesa ${tableNumber}`, 300, 150)
  ctx.drawImage(qrCanvas, 80, 190, 440, 440)
  ctx.fillStyle = '#404040'
  ctx.font = '500 28px "Inter Variable", system-ui, sans-serif'
  ctx.fillText('Escanea para ver el menú', 300, 700)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png'))), 'image/png'),
  )
}

export function QrPrintModal({ table, onClose }) {
  const origin = window.location.origin
  const url = qrUrlFor(table.qrToken, origin)
  const [image, setImage] = useState(null)
  const [error, setError] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let active = true
    QRCode.toDataURL(url, QR_OPTIONS)
      .then((dataUrl) => active && setImage(dataUrl))
      .catch(() => active && setError(true))
    return () => {
      active = false
    }
  }, [url])

  // Imprime solo la tarjeta del QR (ver @media print en QrPrintModal.css)
  const print = () => {
    document.body.classList.add('printing-qr')
    const done = () => {
      document.body.classList.remove('printing-qr')
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    window.print()
    // Algunos navegadores no emiten afterprint: se limpia igual
    setTimeout(done, 1000)
  }

  const download = async () => {
    setDownloading(true)
    try {
      const blob = await buildPng(url, table.tableNumber)
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `mesa-${table.tableNumber}-qr.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(href)
    } catch {
      setError(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal
      title={`Código QR — Mesa ${table.tableNumber}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={download}
            disabled={!image || downloading}
          >
            {downloading ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
            Descargar PNG
          </button>
          <button type="button" className="btn btn--primary" onClick={print} disabled={!image}>
            <Printer size={16} aria-hidden="true" />
            Imprimir
          </button>
        </>
      }
    >
      {isLocalOrigin(origin) && (
        <p className="qr-print-warning" role="note">
          <TriangleAlert size={16} aria-hidden="true" />
          Este QR apunta a {origin}: solo sirve en este equipo. Imprime los definitivos desde la versión
          desplegada.
        </p>
      )}

      {error ? (
        <p className="alert" role="alert">
          No se pudo generar el código QR. Intenta de nuevo.
        </p>
      ) : (
        <div className="qr-print-card">
          <span className="qr-print-card__brand">La Pizzeta</span>
          <span className="qr-print-card__table">Mesa {table.tableNumber}</span>
          {image ? (
            <img
              className="qr-print-card__img"
              src={image}
              alt={`Código QR de la mesa ${table.tableNumber}`}
              width="240"
              height="240"
            />
          ) : (
            <span className="qr-print-card__loading" aria-live="polite">
              Generando código…
            </span>
          )}
          <span className="qr-print-card__hint">Escanea para ver el menú</span>
        </div>
      )}

      <p className="qr-print-url">
        Apunta a: <code>{url}</code>
      </p>
    </Modal>
  )
}
