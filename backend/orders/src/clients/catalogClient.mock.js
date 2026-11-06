const MOCK_PRODUCTS = new Map([
  ['00000000-0000-4000-a000-000000000001', { productId: '00000000-0000-4000-a000-000000000001', name: 'Pizza Margarita', price: 28000, isAvailable: true }],
  ['00000000-0000-4000-a000-000000000002', { productId: '00000000-0000-4000-a000-000000000002', name: 'Pizza Pepperoni', price: 32000, isAvailable: true }],
  ['00000000-0000-4000-a000-000000000003', { productId: '00000000-0000-4000-a000-000000000003', name: 'Pasta Carbonara', price: 25000, isAvailable: true }],
  ['00000000-0000-4000-a000-000000000004', { productId: '00000000-0000-4000-a000-000000000004', name: 'Limonada Natural', price: 8000, isAvailable: true }],
  ['00000000-0000-4000-a000-000000000005', { productId: '00000000-0000-4000-a000-000000000005', name: 'Tiramisú', price: 15000, isAvailable: false }],
]);

export const catalogClientMock = {
  async getProductsByIds(ids) {
    return ids
      .map((id) => MOCK_PRODUCTS.get(id))
      .filter(Boolean);
  },
};
