import { api } from './client.js'

// Menu de muestra SOLO para desarrollar sin Catalog levantado. Exige las dos condiciones: servidor de
// desarrollo de Vite y el flag explicito VITE_USE_MOCK_MENU=true (en frontend/.env.local, sin commitear).
// En produccion, o sin el flag, un fallo de Catalog se propaga y la pantalla lo muestra: nunca se
// ofrecen productos inventados a un mesero.
const MOCK_MENU = [
  {
    categoryId: 'cat-pizzas',
    name: 'Pizzas',
    products: [
      { productId: '00000000-0000-4000-a000-000000000001', name: 'Pizza Margarita', description: 'Tomate, mozzarella, albahaca', price: 28000, photoUrl: null },
      { productId: '00000000-0000-4000-a000-000000000002', name: 'Pizza Pepperoni', description: 'Pepperoni, mozzarella, salsa', price: 32000, photoUrl: null },
    ],
  },
  {
    categoryId: 'cat-bebidas',
    name: 'Bebidas',
    products: [
      { productId: '00000000-0000-4000-a000-000000000008', name: 'Coca-Cola 350ml', description: 'Bebida gaseosa', price: 5000, photoUrl: null },
      { productId: '00000000-0000-4000-a000-000000000009', name: 'Agua Mineral', description: 'Sin gas', price: 5000, photoUrl: null },
    ],
  },
]

export function mockMenuEnabled(env = import.meta.env) {
  return env.DEV === true && env.VITE_USE_MOCK_MENU === 'true'
}

export async function getMenu({ env } = {}) {
  try {
    return await api('/api/catalog/public/menu')
  } catch (err) {
    if (mockMenuEnabled(env)) {
      console.warn('[menu] Catalog no respondio: usando MOCK_MENU (VITE_USE_MOCK_MENU=true)')
      return MOCK_MENU
    }
    throw err
  }
}
