import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useKeyboardFit } from './useKeyboardFit.js'

function rect(top, height) {
  return { top, bottom: top + height, left: 0, right: 375, width: 375, height, x: 0, y: top, toJSON() {} }
}

// Pantalla de 812 de alto: panel que se desplaza, nota y pie fijo
function Sheet() {
  const dialogRef = useRef(null)
  const panelRef = useRef(null)
  const fieldRef = useRef(null)
  const footerRef = useRef(null)
  const fit = useKeyboardFit({ dialogRef, panelRef, fieldRef, footerRef })
  return (
    <div ref={dialogRef} data-testid="dialog">
      <div ref={panelRef} data-testid="panel">
        <textarea ref={fieldRef} aria-label="Nota" {...fit} />
        <div ref={footerRef} data-testid="footer" />
      </div>
    </div>
  )
}

describe('useKeyboardFit', () => {
  let viewport
  let noteTop

  beforeEach(() => {
    viewport = Object.assign(new EventTarget(), { height: 812, offsetTop: 0 })
    window.visualViewport = viewport
    noteTop = 560
  })

  afterEach(() => {
    delete window.visualViewport
  })

  function setup() {
    render(<Sheet />)
    const panel = screen.getByTestId('panel')
    // La nota se mueve con el desplazamiento del panel; el pie (180 de alto) queda pegado al borde de abajo
    panel.getBoundingClientRect = () => rect(0, viewport.height)
    screen.getByLabelText('Nota').getBoundingClientRect = () => rect(noteTop - panel.scrollTop, 72)
    Object.defineProperty(screen.getByTestId('footer'), 'offsetHeight', { value: 180 })
    return { panel, dialog: screen.getByTestId('dialog'), note: screen.getByLabelText('Nota') }
  }

  it('al abrirse el teclado ajusta la pantalla al area visible y deja la nota entera sobre el pie', () => {
    const { panel, dialog, note } = setup()
    fireEvent.focus(note)

    act(() => {
      viewport.height = 420
      viewport.offsetTop = 40
      viewport.dispatchEvent(new Event('resize'))
    })

    expect(dialog.style.top).toBe('40px')
    expect(dialog.style.height).toBe('420px')
    // Pie en 240 (420 - 180): la nota (560 + 72) sube hasta terminar 28 px antes del pie (sitio del contador)
    expect(panel.scrollTop).toBe(560 + 72 - (240 - 28))
    const box = note.getBoundingClientRect()
    expect(box.bottom).toBeLessThanOrEqual(240 - 28)
    expect(box.top).toBeGreaterThanOrEqual(0)
  })

  it('al salir de la nota la pantalla vuelve a su tamano normal', () => {
    const { dialog, note } = setup()
    fireEvent.focus(note)
    act(() => {
      viewport.height = 420
      viewport.dispatchEvent(new Event('resize'))
    })
    fireEvent.blur(note)

    expect(dialog.style.top).toBe('')
    expect(dialog.style.height).toBe('')
  })

  it('si la nota ya se ve no mueve el panel', () => {
    noteTop = 100
    const { panel, note } = setup()
    fireEvent.focus(note)
    expect(panel.scrollTop).toBe(0)
  })
})
