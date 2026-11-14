import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QRCode from 'qrcode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { qrUrlFor } from '../utils/qrUrl.js'
import { QrPrintModal } from './QrPrintModal.jsx'

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(), toCanvas: vi.fn() } }))

const TABLE = { tableId: 't1', tableNumber: 7, qrToken: 'tok_ABC-123' }

beforeEach(() => {
  vi.resetAllMocks()
  QRCode.toDataURL.mockResolvedValue('data:image/png;base64,QR')
  QRCode.toCanvas.mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.classList.remove('printing-qr')
})

describe('qrUrlFor', () => {
  it('arma la URL completa con el origen y el token codificado', () => {
    expect(qrUrlFor('tok_ABC-123', 'https://gastrocore.vercel.app')).toBe(
      'https://gastrocore.vercel.app/m/tok_ABC-123',
    )
    expect(qrUrlFor('a/b?c', 'https://x.app')).toBe('https://x.app/m/a%2Fb%3Fc')
  })
})

describe('QrPrintModal', () => {
  it('genera el QR en el navegador con la URL de la mesa y lo muestra con "Mesa N"', async () => {
    render(<QrPrintModal table={TABLE} onClose={vi.fn()} />)

    const img = await screen.findByRole('img', { name: 'Código QR de la mesa 7' })
    expect(img).toHaveAttribute('src', 'data:image/png;base64,QR')
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      `${window.location.origin}/m/tok_ABC-123`,
      expect.objectContaining({ errorCorrectionLevel: 'M' }),
    )
    expect(screen.getByText('Mesa 7')).toBeInTheDocument()
    expect(screen.getByText('Escanea para ver el menú')).toBeInTheDocument()
    expect(screen.getByText(`${window.location.origin}/m/tok_ABC-123`)).toBeInTheDocument()
  })

  it('avisa si apunta a localhost (los definitivos se imprimen desde la versión desplegada)', async () => {
    render(<QrPrintModal table={TABLE} onClose={vi.fn()} />)
    await screen.findByRole('img', { name: /Código QR/ })

    expect(screen.getByRole('note')).toHaveTextContent('solo sirve en este equipo')
  })

  it('Imprimir marca la página para imprimir solo la tarjeta y lo deshace después', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<QrPrintModal table={TABLE} onClose={vi.fn()} />)
    await screen.findByRole('img', { name: /Código QR/ })

    await user.click(screen.getByRole('button', { name: /Imprimir/ }))

    expect(print).toHaveBeenCalledOnce()
    expect(document.body).toHaveClass('printing-qr')
    act(() => window.dispatchEvent(new Event('afterprint')))
    expect(document.body).not.toHaveClass('printing-qr')
  })

  it('Descargar PNG arma la tarjeta en un canvas y la descarga como mesa-N-qr.png', async () => {
    const ctx = { fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'])))
    URL.createObjectURL = vi.fn(() => 'blob:qr')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      this.dataset.clicked = this.download
    })
    const user = userEvent.setup()
    render(<QrPrintModal table={TABLE} onClose={vi.fn()} />)
    await screen.findByRole('img', { name: /Código QR/ })

    await user.click(screen.getByRole('button', { name: /Descargar PNG/ }))

    expect(QRCode.toCanvas).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      `${window.location.origin}/m/tok_ABC-123`,
      expect.objectContaining({ width: 440 }),
    )
    expect(ctx.fillText).toHaveBeenCalledWith('Mesa 7', 300, 150)
    expect(ctx.fillText).toHaveBeenCalledWith('Escanea para ver el menú', 300, 700)
    expect(click).toHaveBeenCalledOnce()
    expect(click.mock.contexts[0].download).toBe('mesa-7-qr.png')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qr')
  })

  it('si no se puede generar, lo dice y no deja imprimir', async () => {
    QRCode.toDataURL.mockRejectedValue(new Error('qr'))
    render(<QrPrintModal table={TABLE} onClose={vi.fn()} />)

    expect(await screen.findByText('No se pudo generar el código QR. Intenta de nuevo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Imprimir/ })).toBeDisabled()
  })
})
