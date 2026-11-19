import { api } from './client.js'

export const listCategories = () => api('/api/catalog/categories')

// displayOrder es opcional; en PUT, omitirlo deja el valor actual y null lo borra
export const createCategory = (values) => api('/api/catalog/categories', { method: 'POST', body: values })

export const updateCategory = (categoryId, values) =>
  api(`/api/catalog/categories/${categoryId}`, { method: 'PUT', body: values })

// Incluye los productos agotados (el panel admin los muestra todos)
export const listProducts = () => api('/api/catalog/products')

// El alta y la edicion viajan como multipart/form-data (la foto es un archivo)
export const createProduct = (formData) => api('/api/catalog/products', { method: 'POST', body: formData })

export const updateProduct = (productId, formData) =>
  api(`/api/catalog/products/${productId}`, { method: 'PUT', body: formData })

// Interruptor de disponibilidad: el mismo PUT, enviando solo isAvailable
export function setProductAvailability(productId, isAvailable) {
  const form = new FormData()
  form.append('isAvailable', String(isAvailable))
  return updateProduct(productId, form)
}
