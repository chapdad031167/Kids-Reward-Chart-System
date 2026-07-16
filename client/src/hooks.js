import { useEffect, useRef, useCallback } from 'react';

/** Fire `onIdle` after `ms` of no touch/click/key activity. */
export function useIdleTimer(onIdle, ms = 90000) {
  const timer = useRef(null);
  const cb = useRef(onIdle);
  cb.current = onIdle;

  useEffect(() => {
    const reset = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => cb.current(), ms);
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [ms]);
}

/** Long-press handler props for the hidden parent-dashboard entrance. */
export function useLongPress(onLongPress, ms = 800) {
  const timer = useRef(null);
  const start = useCallback(() => {
    timer.current = setTimeout(onLongPress, ms);
  }, [onLongPress, ms]);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e) => e.preventDefault(),
  };
}
