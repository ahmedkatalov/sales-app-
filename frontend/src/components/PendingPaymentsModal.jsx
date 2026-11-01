import { useCallback, useRef } from "react";
import Modal from "./Modal";
import PendingPaymentsWorkspace from "./PendingPaymentsWorkspace";

export default function PendingPaymentsModal({ onClose }) {
  const closeBlockedRef = useRef(false);
  const onCloseBlockedChange = useCallback((busy) => { closeBlockedRef.current = busy; }, []);
  const close = () => { if (!closeBlockedRef.current) onClose?.(); };

  return (
    <div className="pending-modal-scope">
      <Modal title="Отложенные чеки" wide legacyLight={false} onClose={close}>
        <PendingPaymentsWorkspace embedded onCloseBlockedChange={onCloseBlockedChange} />
      </Modal>
    </div>
  );
}
