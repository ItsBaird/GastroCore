import { api } from './client.js'

const MOCK_MENU = [
  {
    categoryId: 'cat-pizzas',
    name: 'Pizzas',
    products: [
      { productId: '00000000-0000-4000-a000-000000000001', name: 'Pizza Margarita', description: 'Tomate, mozzarella, albahaca', price: 28000, photoUrl: null },
      { productId: '00000000-0000-4000-a000-000000000002', name: 'Pizza Pepperoni', description: 'Pepperoni, mozzarella, salsa', price: 32000, photoUrl: null },
      { productId: '00000000-0000-4000-a000-000000000006', name: 'Pizza Hawaiana', description: 'Jamón, piña, mozzarella', price: 30000, photoUrl: null },
    ],
  },
  {
    categoryId: 'cat-pastas',
    name: 'Pastas',
    products: [
      { productId: '00000000-0000-4000-a000-000000000003', name: 'Pasta Carbonara', description: 'Tocino, huevo, parmesano', price: 25000, photoUrl: null },
      { productId: '00000000-0000-4000-a000-000000000007', name: 'Pasta Bolognesa', description: 'Carne molida, tomate, albahaca', price: 24000, photoUrl: null },
    ],
  },
  {
    categoryId: 'cat-bebidas',
    name: 'Bebidas',
    products: [
      { productId: '00000000-0000-4000-a000-000000000004', name: 'Limonada Natural', description: 'Limón, agua, azúcar', price: 7000, photoUrl: null },
      { productId: '00000000-0000-4000-a000-000000000008', name: 'Coca-Cola 350ml', description: 'Bebida gaseosa', price: 5000, photoUrl: null },
      { productId: '00000000-0000-4000-a000-000000000009', name: 'Agua Mineral', description: 'Sin gas', price: 5000, photoUrl: null },
    ],
  },
  {
    categoryId: 'cat-ensaladas',
    name: 'Ensaladas',
    products: [
      { productId: '00000000-0000-4000-a000-000000000010', name: 'Ensalada César', description: 'Lechuga, crutones, parmesano', price: 18000, photoUrl: null },
    ],
  },
  {
    categoryId: 'cat-postres',
    name: 'Postres',
    products: [
      { productId: '00000000-0000-4000-a000-000000000005', name: 'Tiramisú', description: 'Café, mascarpone, cacao', price: 15000, photoUrl: null },
    ],
  },
]

export async function getMenu() {
  try {
    return await api('/api/catalog/public/menu')
  } catch {
    return MOCK_MENU
  }
}
