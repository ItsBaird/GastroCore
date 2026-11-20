import { CircleDollarSign, Table, UtensilsCrossed } from 'lucide-react'
import './TableCards.css'

// Resumen de mesas (Figma 31:58, 31:48, 31:43, 31:53), compartido por "Mis Mesas" y la Gestion de Mesas del ADMIN.
// `tables`: [{ status }] con libre | ocupada | en_cobro. Los colores son los de los estados de las mesas.
// `totalLabel`: "Asignadas" para el mesero, "Total" para el ADMIN.
export function TableStats({ tables, totalLabel = 'Asignadas' }) {
  const count = (status) => tables.filter((t) => t.status === status).length
  const stats = [
    { key: 'asignadas', value: tables.length, label: totalLabel, icon: Table },
    { key: 'libre', value: count('libre'), label: 'Libres', icon: Table },
    { key: 'ocupada', value: count('ocupada'), label: 'Ocupadas', icon: UtensilsCrossed },
    { key: 'en-cobro', value: count('en_cobro'), label: 'En cobro', icon: CircleDollarSign },
  ]
  return (
    <div className="ts-stats" role="group" aria-label="Resumen de mesas">
      {stats.map(({ key, value, label, icon: Icon }) => (
        <div key={key} className={`ts-stat ts-stat--${key}`}>
          <div className="ts-stat__bar" />
          <div className="ts-stat__info">
            <span className="ts-stat__value">{value}</span>
            <span className="ts-stat__label">{label}</span>
          </div>
          <div className="ts-stat__circle" aria-hidden="true">
            <Icon size={18} />
          </div>
        </div>
      ))}
    </div>
  )
}
