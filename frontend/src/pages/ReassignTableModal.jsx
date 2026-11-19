import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listActiveWaiters } from '../api/activeWaiters.js';
import { Field } from '../components/Field.jsx';
import { Modal } from '../components/Modal.jsx';

export function ReassignTableModal({
  tableNumber,
  currentWaiterId,
  currentWaiterName,
  onConfirm,
  onClose,
}) {
  const [{ status, waiters }, setList] = useState({ status: 'loading', waiters: [] });
  const [attempt, setAttempt] = useState(0);
  const [waiterId, setWaiterId] = useState('');
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    listActiveWaiters().then(
      (list) =>
        active &&
        setList({ status: 'ready', waiters: list.filter((w) => w.userId !== currentWaiterId) }),
      () => active && setList({ status: 'error', waiters: [] }),
    );
    return () => {
      active = false;
    };
  }, [currentWaiterId, attempt]);

  const retry = () => {
    setList({ status: 'loading', waiters: [] });
    setAttempt((n) => n + 1);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!waiterId) return;

    setGeneral('');
    setBusy(true);
    try {
      await onConfirm(waiters.find((w) => w.userId === waiterId));
    } catch (err) {
      setGeneral(err?.message || 'No se pudo reasignar la mesa');
      setBusy(false);
    }
  };

  const formId = 'reassign-table-form';

  return (
    <Modal
      title={`Reasignar mesa ${tableNumber}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn--primary"
            disabled={busy || !waiterId}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            Reasignar
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="table-form">
        {general && (
          <div className="alert" role="alert">
            {general}
          </div>
        )}

        <p className="reassign-current">
          Atiende ahora: <strong>{currentWaiterName ?? 'otro mesero'}</strong>
        </p>

        {status === 'loading' && (
          <p className="reassign-note">Cargando meseros con turno activo…</p>
        )}

        {status === 'error' && (
          <div className="alert" role="alert">
            No se pudo cargar la lista de meseros.
            <button type="button" className="btn btn--ghost" onClick={retry}>
              <RefreshCw size={16} /> Reintentar
            </button>
          </div>
        )}

        {status === 'ready' && waiters.length === 0 && (
          <p className="reassign-note">No hay meseros con turno activo.</p>
        )}

        {status === 'ready' && waiters.length > 0 && (
          <Field
            label="Nuevo mesero"
            hint="Quien abrió la mesa conserva la atribución de la venta."
          >
            {(props) => (
              <select
                {...props}
                className="field__select"
                value={waiterId}
                onChange={(event) => setWaiterId(event.target.value)}
                disabled={busy}
              >
                <option value="" disabled>
                  Selecciona un mesero
                </option>
                {waiters.map((w) => (
                  <option key={w.userId} value={w.userId}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
      </form>
    </Modal>
  );
}
