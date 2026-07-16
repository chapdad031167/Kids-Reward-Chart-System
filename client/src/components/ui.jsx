import { useEffect } from 'react';

export function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function Toast({ message, onDone, ms = 2500 }) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [onDone, ms]);
  return <div className="toast">{message}</div>;
}
