// Catalogo de demostracion de La Pizzeta. El productId de cada uno es seedUuid(`product:${slug}`): el seed de Orders
// usa el mismo calculo (y los mismos nombres y precios) para sus ordenes de ejemplo.
// Si una categoria o un producto con ese nombre ya existe (por ejemplo, creados a mano) se respeta tal cual.
export const CATEGORIES = [
  { name: 'Entradas', displayOrder: 1, tint: 'yellow' },
  { name: 'Pizzas', displayOrder: 2, tint: 'red' },
  { name: 'Pastas', displayOrder: 3, tint: 'orange' },
  { name: 'Bebidas', displayOrder: 4, tint: 'blue' },
  { name: 'Postres', displayOrder: 5, tint: 'purple' },
];

export const PRODUCTS = [
  {
    slug: 'palitos-de-ajo',
    category: 'Entradas',
    name: 'Palitos de ajo',
    price: 12000,
    description: 'Palitos de pan horneados con mantequilla de ajo y queso gratinado.',
  },
  {
    slug: 'ensalada-caprese',
    category: 'Entradas',
    name: 'Ensalada Caprese',
    price: 16000,
    description: 'Tomate, mozzarella fresca, albahaca y aceite de oliva.',
  },
  {
    slug: 'pizza-margarita',
    category: 'Pizzas',
    name: 'Pizza Margarita',
    price: 28000,
    description: 'Salsa de tomate, mozzarella y albahaca.',
  },
  {
    slug: 'pizza-pepperoni',
    category: 'Pizzas',
    name: 'Pizza Pepperoni',
    price: 32000,
    description: 'Mozzarella y abundante pepperoni.',
  },
  {
    slug: 'pizza-hawaiana',
    category: 'Pizzas',
    name: 'Pizza Hawaiana',
    price: 30000,
    description: 'Jamón, piña y mozzarella.',
  },
  {
    slug: 'pizza-cuatro-quesos',
    category: 'Pizzas',
    name: 'Pizza Cuatro Quesos',
    price: 34000,
    description: 'Mozzarella, parmesano, gorgonzola y provolone.',
  },
  {
    slug: 'pizza-vegetariana',
    category: 'Pizzas',
    name: 'Pizza Vegetariana',
    price: 29000,
    description: 'Pimentón, champiñones, cebolla, aceitunas y mozzarella.',
  },
  {
    slug: 'pasta-carbonara',
    category: 'Pastas',
    name: 'Pasta Carbonara',
    price: 25000,
    description: 'Spaghetti con tocineta, huevo y parmesano.',
  },
  {
    slug: 'pasta-bolonesa',
    category: 'Pastas',
    name: 'Pasta Boloñesa',
    price: 24000,
    description: 'Spaghetti con salsa de carne y tomate.',
  },
  {
    slug: 'lasana-de-carne',
    category: 'Pastas',
    name: 'Lasaña de Carne',
    price: 27000,
    description: 'Capas de pasta, carne, bechamel y queso gratinado.',
  },
  {
    slug: 'limonada-natural',
    category: 'Bebidas',
    name: 'Limonada Natural',
    price: 8000,
    description: 'Limonada con hielo, recién hecha.',
  },
  {
    slug: 'jugo-de-maracuya',
    category: 'Bebidas',
    name: 'Jugo de Maracuyá',
    price: 9000,
    description: 'Jugo natural en agua o en leche.',
  },
  {
    slug: 'gaseosa',
    category: 'Bebidas',
    name: 'Gaseosa',
    price: 5000,
    description: 'Gaseosa personal.',
  },
  {
    slug: 'cerveza-nacional',
    category: 'Bebidas',
    name: 'Cerveza Nacional',
    price: 7000,
    description: 'Cerveza nacional bien fría.',
  },
  {
    slug: 'tiramisu',
    category: 'Postres',
    name: 'Tiramisú',
    price: 15000,
    description: 'Postre italiano de café y mascarpone.',
    isAvailable: false,
  },
  {
    slug: 'brownie-con-helado',
    category: 'Postres',
    name: 'Brownie con Helado',
    price: 12000,
    description: 'Brownie tibio con una bola de helado de vainilla.',
  },
];

const TINTS = {
  red: { bg: '#fef2f2', circle: '#fecaca', ink: '#dc2626' },
  orange: { bg: '#fff7ed', circle: '#fed7aa', ink: '#ea580c' },
  yellow: { bg: '#fefce8', circle: '#fde68a', ink: '#a16207' },
  blue: { bg: '#eff6ff', circle: '#bfdbfe', ink: '#2563eb' },
  purple: { bg: '#faf5ff', circle: '#e9d5ff', ink: '#9333ea' },
};

const escapeXml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Foto de relleno (la base exige una por producto): SVG con la inicial y el nombre, en el color de su categoria.
export function placeholderSvg({ name, tint }) {
  const { bg, circle, ink } = TINTS[tint] ?? TINTS.red;
  const initial = escapeXml(name.trim().charAt(0).toUpperCase());
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" role="img" aria-label="${escapeXml(name)}">` +
    `<rect width="400" height="300" fill="${bg}"/>` +
    `<circle cx="200" cy="125" r="70" fill="${circle}"/>` +
    `<text x="200" y="148" font-family="Inter, Arial, sans-serif" font-size="68" font-weight="700" text-anchor="middle" fill="${ink}">${initial}</text>` +
    `<text x="200" y="248" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="600" text-anchor="middle" fill="#525252">${escapeXml(name)}</text>` +
    `</svg>`
  );
}

export const photoFileName = (slug) => `seed-${slug}.svg`;
