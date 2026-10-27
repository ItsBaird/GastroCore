// A donde va cada rol al entrar. Solo ADMIN tiene pantallas por ahora (GC-ADM / GC-ORD).
export const homePathFor = (role) => (role === 'ADMIN' ? '/admin/usuarios' : '/en-construccion')
