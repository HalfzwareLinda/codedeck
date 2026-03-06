import { useRef, useCallback } from 'react';

const SWIPE_THRESHOLD = 80;

/**
 * Hook that adds swipe-left-to-delete to an element.
 * Returns touch handlers to spread onto the element and a ref-based
 * swiping flag so the caller can conditionally render a backdrop.
 *
 * No extra DOM layers — the element itself is translated via inline style.
 */
export function useSwipeToDelete(onDelete: () => void) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentXRef = useRef(0);
  const swipingRef = useRef(false);
  const elRef = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    currentXRef.current = 0;
    swipingRef.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;

    // Determine direction on first significant move
    if (!swipingRef.current && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (!swipingRef.current) {
      // Vertical scroll is dominant — don't swipe
      if (Math.abs(dy) > Math.abs(dx)) return;
      swipingRef.current = true;
    }

    const offset = Math.min(0, dx); // Only left
    currentXRef.current = offset;
    const el = elRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${offset}px)`;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!swipingRef.current) return;
    const el = elRef.current;
    if (!el) return;

    if (Math.abs(currentXRef.current) >= SWIPE_THRESHOLD) {
      // Full swipe — animate off-screen then delete
      el.style.transition = 'transform 0.2s ease-out';
      el.style.transform = 'translateX(-100%)';
      setTimeout(onDelete, 200);
    } else {
      // Snap back
      el.style.transition = 'transform 0.2s ease-out';
      el.style.transform = 'translateX(0)';
    }
    swipingRef.current = false;
    currentXRef.current = 0;
  }, [onDelete]);

  return {
    ref: elRef,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
