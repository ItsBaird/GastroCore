import { MyShiftPanel } from '../components/MyShiftPanel.jsx'
import { WaiterPage } from '../layouts/WaiterLayout.jsx'

// "Mi Turno" del panel del mesero. Sin la insignia fija "Turno Activo" de la barra superior: aqui el
// estado real del turno lo muestra el propio panel.
export default function WaiterShiftPage() {
  return (
    <WaiterPage title="Mi Turno" showShiftBadge={false}>
      <MyShiftPanel />
    </WaiterPage>
  )
}
