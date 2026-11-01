import { useRef } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal';
import useDialogFocus from '../utils/useDialogFocus';
export default function NavigationDialog({ title, onClose, busy = false, children }) {
  const root = useRef(null);
  useDialogFocus(root, true, '.smart-modal-panel');
  return createPortal(<div className="shell-dialog" role="dialog" aria-modal="true" aria-label={title} ref={root}><Modal title={title} section="Рабочее пространство" legacyLight={false} wide onClose={busy ? undefined : onClose}>{children}</Modal></div>, document.body);
}
