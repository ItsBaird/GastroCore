export const homePathFor = (role) => {
  if (role === 'ADMIN') return '/admin/usuarios'
  if (role === 'WAITER') return '/mesero/mesas'
  if (role === 'COOK') return '/cocina'
  return '/en-construccion'
}
