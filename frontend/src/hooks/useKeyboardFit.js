import { useCallback, useEffect, useState } from 'react'

const GAP = 12
// Bajo la nota queda su contador de caracteres (11/255): tambien debe verse
const GAP_BOTTOM = 28

// Teclado del celular sobre una pantalla superpuesta a pantalla completa con pie fijo (detalle de producto
// del menu QR). Al abrirse el teclado, el navegador movil solo achica el area visible (visualViewport) y la
// pantalla seguia midiendo lo mismo: el pie fijo quedaba encima del campo y no se veia lo que se escribia.
// Mientras el campo tiene el foco, la pantalla se ajusta al area visible y el panel se desplaza para dejar el
// campo entero entre el borde de arriba y el pie (que sigue fijo con la cantidad y el total).
export function useKeyboardFit({ dialogRef, panelRef, fieldRef, footerRef }) {
  const [active, setActive] = useState(false)

  const keepFieldVisible = useCallback(() => {
    const panel = panelRef.current
    const field = fieldRef.current
    if (!panel || !field) return
    const box = panel.getBoundingClientRect()
    const target = field.getBoundingClientRect()
    // El pie esta pegado al borde de abajo del panel: se usa su alto y no su posicion, que cambia mientras se
    // desplaza el panel
    const limit = box.bottom - (footerRef.current?.offsetHeight ?? 0) - GAP_BOTTOM
    if (target.bottom > limit) panel.scrollTop += target.bottom - limit
    else if (target.top < box.top + GAP) panel.scrollTop -= box.top + GAP - target.top
  }, [panelRef, fieldRef, footerRef])

  useEffect(() => {
    if (!active) return undefined
    const dialog = dialogRef.current
    const viewport = window.visualViewport
    if (!dialog) return undefined

    const fit = () => {
      if (viewport) {
        dialog.style.top = `${viewport.offsetTop}px`
        dialog.style.bottom = 'auto'
        dialog.style.height = `${viewport.height}px`
      }
      keepFieldVisible()
    }
    fit()
    // El teclado tarda en terminar de abrir: se vuelve a ajustar con cada cambio del area visible
    viewport?.addEventListener('resize', fit)
    viewport?.addEventListener('scroll', fit)
    return () => {
      viewport?.removeEventListener('resize', fit)
      viewport?.removeEventListener('scroll', fit)
      dialog.style.top = ''
      dialog.style.bottom = ''
      dialog.style.height = ''
    }
  }, [active, dialogRef, keepFieldVisible])

  return {
    onFocus: () => setActive(true),
    onBlur: () => setActive(false),
    // Al escribir o saltar de linea el cursor sigue a la vista
    onInput: keepFieldVisible,
  }
}
