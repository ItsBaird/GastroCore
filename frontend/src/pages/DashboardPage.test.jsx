import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as dashboardApi from '../api/dashboard.js'
import { ApiError } from '../api/errors.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import DashboardPage from './DashboardPage.jsx'

vi.mock('../api/dashboard.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.com', role: 'ADMIN', isActive: true }

// Miercoles 18 de noviembre de 2026, 12:00 en Neiva: semana en curso del 16 al 22 (faltan 4 dias)
const NOW = new Date('2026-11-18T17:00:00Z')

const kpi = (value, previous, changePercent) => ({ value, previous, changePercent })
const days = (from, n) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-11-${String(Number(from.slice(8)) + i).padStart(2, '0')}`,
    totalSales: 0,
    orders: 0,
  }))
const hours = () => Array.from({ length: 24 }, (_, hour) => ({ hour, totalSales: 0, orders: 0 }))

function makeDashboard(overrides = {}) {
  return {
    period: { from: '2026-11-16', to: '2026-11-22' },
    previousPeriod: { from: '2026-11-09', to: '2026-11-15' },
    kpis: {
      sales: kpi(4250000, 3927000, 8.2),
      orders: kpi(128, 132, -3),
      averageTicket: kpi(33203, 29750, 11.6),
      preparationMinutes: kpi(12.4, 12.9, -3.9),
    },
    salesByDay: days('2026-11-16', 7),
    salesByHour: hours(),
    topProducts: [],
    preparation: { averageMinutes: 12.4, itemsMeasured: 310, byCategory: [] },
    waiterBreakdown: [],
    paymentBreakdown: [],
    ...overrides,
  }
}

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <DashboardPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const strip = () => within(screen.getByRole('region', { name: 'Indicadores del periodo' }))
// La etiqueta del KPI (el mismo texto aparece en la ayuda con las definiciones)
const kpiCell = (label) =>
  strip()
    .getAllByText(label)
    .find((el) => el.classList.contains('dash-kpi__label'))
    .closest('.dash-kpi')

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  dashboardApi.getDashboard.mockResolvedValue(makeDashboard())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DashboardPage: periodo y franja de KPI', () => {
  it('pide la semana en curso de Colombia y rotula el periodo, lo que falta y la comparacion', async () => {
    renderPage()

    expect(await screen.findByText('16–22 nov 2026')).toBeInTheDocument()
    expect(dashboardApi.getDashboard).toHaveBeenCalledWith({ from: '2026-11-16', to: '2026-11-22' })
    expect(screen.getByText(/Semana en curso \(faltan 4 días\) · comparado con 9–15 nov 2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Esta semana' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Días de negocio en hora de Colombia (UTC−5).')).toBeInTheDocument()
  })

  it('cada KPI: cifra, cambio con flecha y el valor anterior', async () => {
    renderPage()
    await screen.findByText('16–22 nov 2026')

    const sales = within(kpiCell('Ventas'))
    expect(sales.getByText('$4.250.000')).toBeInTheDocument()
    expect(sales.getByText('+8,2 %').closest('.dash-delta')).toHaveClass('dash-delta--good')
    expect(sales.getByText('vs $3.927.000')).toBeInTheDocument()

    const orders = within(kpiCell('Cuentas cerradas'))
    expect(orders.getByText('128')).toBeInTheDocument()
    expect(orders.getByText('−3,0 %').closest('.dash-delta')).toHaveClass('dash-delta--bad')
  })

  it('preparacion: menos es mejor, asi que bajar es bueno', async () => {
    renderPage()
    await screen.findByText('16–22 nov 2026')

    const prep = within(kpiCell('Tiempo de preparación'))
    expect(prep.getByText('12,4 min')).toBeInTheDocument()
    expect(prep.getByText('−3,9 %').closest('.dash-delta')).toHaveClass('dash-delta--good')
    expect(prep.getByText(/menos es mejor/)).toBeInTheDocument()
    expect(prep.getByText('(mejora)')).toBeInTheDocument()
  })

  it('sin periodo anterior: "—" y "Sin periodo anterior", nunca 0 % ni infinito', async () => {
    dashboardApi.getDashboard.mockResolvedValue(
      makeDashboard({
        kpis: {
          sales: kpi(62000, 0, null),
          orders: kpi(1, 0, null),
          averageTicket: kpi(62000, 0, null),
          preparationMinutes: kpi(null, null, null),
        },
      }),
    )
    renderPage()
    await screen.findByText('16–22 nov 2026')

    expect(strip().getAllByText('Sin periodo anterior')).toHaveLength(4)
    expect(kpiCell('Tiempo de preparación').querySelector('.dash-kpi__value')).toHaveTextContent('—')
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|∞/)
  })

  it('periodo sin ventas: ceros, aviso de estado vacio y sin NaN', async () => {
    dashboardApi.getDashboard.mockResolvedValue(
      makeDashboard({
        kpis: {
          sales: kpi(0, 0, null),
          orders: kpi(0, 0, null),
          averageTicket: kpi(0, 0, null),
          preparationMinutes: kpi(null, null, null),
        },
        preparation: { averageMinutes: null, itemsMeasured: 0, byCategory: [] },
      }),
    )
    renderPage()

    expect(await screen.findByText('Sin ventas en este periodo.')).toBeInTheDocument()
    expect(within(kpiCell('Ventas')).getByText('$0')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('las definiciones estan a un clic (details)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('16–22 nov 2026')

    await user.click(screen.getByText('Cómo se calculan estas cifras'))
    expect(screen.getByText('Ventas ÷ cuentas cerradas.')).toBeVisible()
    expect(screen.getByText('Ventas atribuidas a quien abrió la mesa.')).toBeVisible()
  })
})

describe('DashboardPage: selector de periodo', () => {
  it('los accesos rapidos recalculan con su rango', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('16–22 nov 2026')

    dashboardApi.getDashboard.mockResolvedValue(
      makeDashboard({
        period: { from: '2026-11-09', to: '2026-11-15' },
        previousPeriod: { from: '2026-11-02', to: '2026-11-08' },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Semana pasada' }))

    expect(dashboardApi.getDashboard).toHaveBeenLastCalledWith({ from: '2026-11-09', to: '2026-11-15' })
    expect(await screen.findByText('9–15 nov 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Semana pasada' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('rango personalizado valido: se envia solo con "Aplicar"', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('16–22 nov 2026')

    await user.clear(screen.getByLabelText('Desde'))
    await user.type(screen.getByLabelText('Desde'), '2026-11-01')
    expect(dashboardApi.getDashboard).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(dashboardApi.getDashboard).toHaveBeenLastCalledWith({ from: '2026-11-01', to: '2026-11-22' })
  })

  it.each([
    ['2026-11-25', '2026-11-22', 'La fecha final no puede ser anterior a la inicial.'],
    ['2026-01-01', '2026-11-22', 'El rango máximo es de 92 días.'],
  ])('rango invalido (%s a %s): error junto al campo y sin llamar al servidor', async (from, to, message) => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('16–22 nov 2026')

    await user.clear(screen.getByLabelText('Desde'))
    await user.type(screen.getByLabelText('Desde'), from)
    await user.clear(screen.getByLabelText('Hasta'))
    await user.type(screen.getByLabelText('Hasta'), to)
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText('Desde')).toHaveAttribute('aria-invalid', 'true')
    expect(dashboardApi.getDashboard).toHaveBeenCalledTimes(1)
  })

  it('si el servidor responde 400, muestra su mensaje y conserva las cifras', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('16–22 nov 2026')

    dashboardApi.getDashboard.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'x', { fields: [{ path: 'to', message: 'El rango máximo es de 92 días' }] }),
    )
    await user.click(screen.getByRole('button', { name: 'Semana pasada' }))

    expect(await screen.findByText(/El rango máximo es de 92 días/)).toBeInTheDocument()
    expect(within(kpiCell('Ventas')).getByText('$4.250.000')).toBeInTheDocument()
  })
})

describe('DashboardPage: carga y error (patron catalog-state)', () => {
  it('carga: esqueleto y aria-busy hasta que llegan los datos', async () => {
    let resolve
    dashboardApi.getDashboard.mockReturnValue(new Promise((r) => (resolve = r)))
    const { container } = renderPage()

    expect(container.querySelector('.dash')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('.dash-skel').length).toBeGreaterThan(0)

    resolve(makeDashboard())
    expect(await screen.findByText('16–22 nov 2026')).toBeInTheDocument()
    expect(container.querySelector('.dash')).toHaveAttribute('aria-busy', 'false')
  })

  it('error sin datos: mensaje y Reintentar', async () => {
    dashboardApi.getDashboard
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'))
      .mockResolvedValueOnce(makeDashboard())
    const user = userEvent.setup()
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveClass('catalog-state')
    expect(alert).toHaveTextContent('No se pudieron cargar las métricas.')

    await user.click(within(alert).getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('16–22 nov 2026')).toBeInTheDocument()
  })
})
