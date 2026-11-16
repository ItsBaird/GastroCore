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
vi.mock('../api/staff.js')
vi.mock('../api/paymentMethods.js')

const staffApi = await import('../api/staff.js')
const methodsApi = await import('../api/paymentMethods.js')

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
  staffApi.listEmployees.mockResolvedValue([{ userId: 'w1', fullName: 'Ana Martínez' }])
  methodsApi.listPaymentMethods.mockResolvedValue([{ paymentMethodId: 'm1', name: 'Efectivo' }])
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

    // Una sola vez, en la franja: las tarjetas no repiten el aviso
    expect(await screen.findByText('Sin ventas en este periodo.')).toHaveClass('dash-strip__empty')
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

describe('DashboardPage: graficas y listados', () => {
  const full = () => {
    const salesByDay = days('2026-11-16', 7).map((d, i) => ({
      ...d,
      totalSales: [0, 120000, 340000, 90000, 0, 0, 0][i],
      orders: [0, 3, 8, 2, 0, 0, 0][i],
    }))
    const salesByHour = hours().map((h) => {
      if (h.hour === 13) return { ...h, totalSales: 300000, orders: 7 }
      if (h.hour === 20) return { ...h, totalSales: 250000, orders: 6 }
      return h
    })
    return makeDashboard({
      kpis: { ...makeDashboard().kpis, sales: kpi(550000, 500000, 10) },
      salesByDay,
      salesByHour,
      topProducts: [
        { rank: 1, productId: 'p1', productName: 'Pizza Margarita', quantitySold: 12, revenue: 336000 },
        {
          rank: 2,
          productId: 'p2',
          productName: 'Limonada de coco con hierbabuena y un nombre larguísimo',
          quantitySold: 9,
          revenue: 72000,
        },
      ],
      preparation: {
        averageMinutes: 12.4,
        itemsMeasured: 30,
        byCategory: [
          { categoryId: 'c1', categoryName: 'Pizzas', averageMinutes: 18.2, itemsMeasured: 12 },
          { categoryId: 'c2', categoryName: 'Bebidas', averageMinutes: 3.1, itemsMeasured: 18 },
        ],
      },
      waiterBreakdown: [
        { waiterId: 'w1', totalAmount: 350000, ordersCount: 8 },
        { waiterId: 'w-borrado', totalAmount: 200000, ordersCount: 5 },
      ],
      paymentBreakdown: [
        { paymentMethodId: 'm1', totalAmount: 450000, paymentCount: 10 },
        { paymentMethodId: 'm-otro', totalAmount: 100000, paymentCount: 3 },
      ],
    })
  }
  const card = (title) => screen.getByRole('region', { name: title })
  // Subtitulo de la tarjeta como texto completo (lleva cifras en negrita, partidas en varios elementos)
  const subtitle = (title) => card(title).querySelector('.dash-chart__sub').textContent

  it('ventas por dia y por hora: resumen en texto, marca del pico en rojo y la hora pico rotulada', async () => {
    dashboardApi.getDashboard.mockResolvedValue(full())
    renderPage()
    await screen.findByText('16–22 nov 2026')

    const byDay = within(card('Ventas por día'))
    expect(subtitle('Ventas por día')).toBe('Día más alto: mié 18 nov · $340.000')
    // el maximo lleva su valor escrito encima, en formato compacto
    expect(card('Ventas por día').querySelector('.dash-col__bar--hi .dash-col__value')).toHaveTextContent('$340 mil')
    expect(card('Ventas por día')).toHaveClass('dash-tone--red')
    expect(byDay.getByRole('img')).toHaveAccessibleName(/Ventas por día, 7 días, total \$550\.000/)
    const bars = card('Ventas por día').querySelectorAll('.dash-col__bar')
    expect(bars).toHaveLength(7)
    expect(card('Ventas por día').querySelectorAll('.dash-col__bar--hi')).toHaveLength(1)
    expect(bars[2]).toHaveClass('dash-col__bar--hi')

    expect(subtitle('Ventas por hora de cobro')).toBe('Hora pico: 1:00–2:00 p. m. · $300.000')
    expect(card('Ventas por hora de cobro').querySelectorAll('.dash-col__bar')).toHaveLength(24)
  })

  it('"Ver como tabla" muestra una tabla real con encabezados y vuelve a la grafica', async () => {
    dashboardApi.getDashboard.mockResolvedValue(full())
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('16–22 nov 2026')

    const byHour = within(card('Ventas por hora de cobro'))
    await user.click(byHour.getByRole('button', { name: 'Ver como tabla' }))
    const table = byHour.getByRole('table', { name: 'Ventas por hora de cobro' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Hora',
      'Ventas',
      'Cuentas',
    ])
    expect(within(table).getAllByRole('row')).toHaveLength(25)
    expect(within(table).getByRole('rowheader', { name: '1:00–2:00 p. m.' }).closest('tr')).toHaveTextContent(
      '$300.000',
    )

    await user.click(byHour.getByRole('button', { name: 'Ver gráfica' }))
    expect(byHour.queryByRole('table')).toBeNull()
    expect(byHour.getByRole('img')).toBeInTheDocument()
  })

  it('top 5, preparacion por categoria, meseros y metodos con su participacion', async () => {
    dashboardApi.getDashboard.mockResolvedValue(full())
    renderPage()
    await screen.findByText('16–22 nov 2026')

    const top = within(card('Top 5 productos'))
    const first = top.getByText('Pizza Margarita').closest('.dash-rank__row')
    // el lider va destacado y con su posicion en una insignia
    expect(first).toHaveClass('dash-rank__row--lead')
    expect(first.querySelector('.dash-rank__pos')).toHaveTextContent('1')
    expect(top.getByText('12 u.')).toBeInTheDocument()
    expect(top.getByText('$336.000 ingreso bruto')).toBeInTheDocument()
    // nombre largo: se recorta con puntos suspensivos y queda completo en el title
    expect(top.getByTitle(/nombre larguísimo/)).toHaveClass('dash-rank__name')

    const prep = within(card('Tiempo de preparación'))
    expect(subtitle('Tiempo de preparación')).toMatch(/Promedio 12,4 min · 30 ítems medidos ·\s*menos es mejor/)
    expect(card('Tiempo de preparación')).toHaveClass('dash-tone--mustard')
    expect(prep.getByText('Pizzas')).toBeInTheDocument()
    expect(prep.getByText('18,2 min')).toBeInTheDocument()

    const waiters = within(card('Ventas por mesero'))
    expect(await waiters.findByText('Ana Martínez')).toBeInTheDocument()
    expect(card('Ventas por mesero')).toHaveClass('dash-tone--raspberry')
    const ana = waiters.getByText('Ana Martínez').closest('.dash-rank__row')
    expect(ana.querySelector('.dash-rank__sub')).toHaveTextContent('63,6 % · 8 cuentas')
    expect(ana.querySelector('.dash-rank__sub strong')).toHaveTextContent('63,6 %')
    // mesero que ya no existe: nombre generico, sus ventas no se pierden
    expect(waiters.getByText('Mesero no disponible')).toBeInTheDocument()
    expect(waiters.getByText('$200.000')).toBeInTheDocument()

    const methods = within(card('Ventas por método de pago'))
    expect(await methods.findByText('Efectivo')).toBeInTheDocument()
    expect(card('Ventas por método de pago')).toHaveClass('dash-tone--purple')
    expect(methods.getByText('Efectivo').closest('.dash-rank__row').querySelector('.dash-rank__sub')).toHaveTextContent(
      '81,8 % · 10 pagos',
    )
    // plural correcto: "3 pagos", y con uno solo seria "1 pago"
    expect(methods.getByText('Método no disponible').closest('.dash-rank__row')).toHaveTextContent('3 pagos')
    expect(methods.getByText('Método no disponible')).toBeInTheDocument()
  })

  it('resumen en una frase con lo importante en negrita, y Ventas como cifra principal', async () => {
    dashboardApi.getDashboard.mockResolvedValue(full())
    renderPage()
    await screen.findByText('16–22 nov 2026')

    const insight = document.querySelector('.dash-insight')
    // un solo punto despues de "p. m." (no "p. m..")
    expect(insight.textContent).toBe(
      'Se vendieron $550.000 en 128 cuentas. El mejor día fue el mié 18 nov y la hora pico, 1:00–2:00 p. m. Lo más vendido: Pizza Margarita (12 unidades).',
    )
    expect([...insight.querySelectorAll('strong')].map((s) => s.textContent)).toEqual([
      '$550.000',
      '128 cuentas',
      'mié 18 nov',
      '1:00–2:00 p. m.',
      'Pizza Margarita',
    ])
    expect(kpiCell('Ventas')).toHaveClass('dash-kpi--lead')
    expect(kpiCell('Cuentas cerradas')).not.toHaveClass('dash-kpi--lead')
    // el cambio va en una pastilla con el tono de bueno/malo
    expect(within(kpiCell('Ventas')).getByText('+10,0 %').closest('.dash-delta')).toHaveClass('dash-delta--good')
  })

  it('sin ventas no hay frase de resumen (no se inventa un "mejor dia")', async () => {
    dashboardApi.getDashboard.mockResolvedValue(
      makeDashboard({ kpis: { ...makeDashboard().kpis, sales: kpi(0, 100, -100), orders: kpi(0, 2, -100) } }),
    )
    renderPage()
    await screen.findByText('16–22 nov 2026')
    expect(document.querySelector('.dash-insight')).toBeNull()
  })

  it('si Staff y metodos fallan, los montos se muestran igual con nombre generico', async () => {
    dashboardApi.getDashboard.mockResolvedValue(full())
    staffApi.listEmployees.mockRejectedValue(new ApiError(503, 'X', 'x'))
    methodsApi.listPaymentMethods.mockRejectedValue(new ApiError(503, 'X', 'x'))
    renderPage()
    await screen.findByText('16–22 nov 2026')

    expect(within(card('Ventas por mesero')).getAllByText('Mesero no disponible')).toHaveLength(2)
    expect(within(card('Ventas por método de pago')).getByText('$450.000')).toBeInTheDocument()
  })

  it('Catalog sin categorias: el promedio global sigue y se explica que falta el desglose', async () => {
    dashboardApi.getDashboard.mockResolvedValue(
      makeDashboard({ preparation: { averageMinutes: 9.5, itemsMeasured: 4, byCategory: null } }),
    )
    renderPage()
    await screen.findByText('16–22 nov 2026')

    const prep = within(card('Tiempo de preparación'))
    expect(subtitle('Tiempo de preparación')).toMatch(/Promedio 9,5 min · 4 ítems medidos/)
    expect(
      prep.getByText('El desglose por categoría no está disponible por ahora; el promedio general sí.'),
    ).toBeInTheDocument()
  })

  it('periodo sin ventas: graficas dibujadas sin barras, listados con su aviso y sin NaN', async () => {
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
    await screen.findByText('Sin ventas en este periodo.', { selector: '.dash-strip__empty' })

    const day = card('Ventas por día')
    expect(day.querySelectorAll('.dash-col__bar')).toHaveLength(7)
    expect([...day.querySelectorAll('.dash-col__bar')].every((b) => b.style.height === '0%')).toBe(true)
    expect(day.querySelectorAll('.dash-col__bar--hi')).toHaveLength(0)
    expect(within(card('Top 5 productos')).getByText('Ningún producto vendido en este periodo.')).toBeInTheDocument()
    expect(within(card('Tiempo de preparación')).getByText('Sin ítems preparados en este periodo.')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('cifras de 8 digitos se formatean completas', async () => {
    dashboardApi.getDashboard.mockResolvedValue(
      makeDashboard({ kpis: { ...makeDashboard().kpis, sales: kpi(12345678, 9876543, 25) } }),
    )
    renderPage()
    await screen.findByText('16–22 nov 2026')
    expect(within(kpiCell('Ventas')).getByText('$12.345.678')).toBeInTheDocument()
  })
})
