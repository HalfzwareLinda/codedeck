import { useRef, useCallback } from 'react';

const SWIPE_THRESHOLD = 60;
const DAMPEN = 0.4;
const DEBOUNCE_MS = 400;
const SLIDE_DURATION = 200;

/**
 * Hook that detects horizontal swipe gestures on a container element
 * to navigate between sessions. Follows the same ref-based DOM
 * manipulation pattern as useSwipeToDelete.
 */
export function useSwipeToNavigate(options: {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  enabled: boolean;
  canSwipeLeft?: boolean;
  canSwipeRight?: boolean;
}) {
  const { onSwipeLeft, onSwipeRight, enabled, canSwipeLeft = true, canSwipeRight = true } = options;

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentXRef = useRef(0);
  const swipingRef = useRef(false);
  const directionLockedRef = useRef(false);
  const lastSwipeTimeRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const snapBack = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.transition = `transform ${SLIDE_DURATION}ms ease-out`;
    el.style.transform = 'translateX(0)';
  }, []);

  /**
   * Carousel-style transition: slide current content out, switch session,
   * then slide new content in from the opposite direction.
   */
  const slideOut = useCallback((exitOffset: string, onSwipe: () => void, enterOffset: string) => {
    const el = containerRef.current;
    if (!el) return;
    // Phase 1: slide out
    el.style.transition = `transform ${SLIDE_DURATION}ms ease-out`;
    el.style.transform = `translateX(${exitOffset})`;
    setTimeout(() => {
      // Phase 2: switch session, position at enter side (no transition)
      onSwipe();
      el.style.transition = 'none';
      el.style.transform = `translateX(${enterOffset})`;
      // Phase 3: slide in to center (double rAF ensures browser paints the off-screen position first)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = `transform ${SLIDE_DURATION}ms ease-out`;
          el.style.transform = 'translateX(0)';
        });
      });
    }, SLIDE_DURATION);
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    currentXRef.current = 0;
    swipingRef.current = false;
    directionLockedRef.current = false;
    const el = containerRef.current;
    if (el) {
      el.style.transition = 'none';
    }
  }, [enabled]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    // Direction already locked as vertical — let scroll happen
    if (directionLockedRef.current && !swipingRef.current) return;

    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;

    // Not enough movement to determine direction yet
    if (!directionLockedRef.current && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

    // Lock direction on first significant movement
    if (!directionLockedRef.current) {
      directionLockedRef.current = true;
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical scroll — abort horizontal swipe
        return;
      }
      swipingRef.current = true;
    }

    // Suppress drag visual at edges
    if (dx < 0 && !canSwipeLeft) return;
    if (dx > 0 && !canSwipeRight) return;

    currentXRef.current = dx;
    const el = containerRef.current;
    if (el) {
      el.style.transform = `translateX(${dx * DAMPEN}px)`;
    }
  }, [enabled, canSwipeLeft, canSwipeRight]);

  const onTouchEnd = useCallback(() => {
    if (!swipingRef.current) return;

    const now = Date.now();
    const dx = currentXRef.current;

    // Debounce rapid swipes
    if (now - lastSwipeTimeRef.current < DEBOUNCE_MS) {
      snapBack();
      swipingRef.current = false;
      return;
    }

    if (dx < -SWIPE_THRESHOLD) {
      if (!canSwipeLeft) {
        snapBack();
      } else {
        lastSwipeTimeRef.current = now;
        slideOut(`-${window.innerWidth}px`, onSwipeLeft, `${window.innerWidth}px`);
      }
    } else if (dx > SWIPE_THRESHOLD) {
      if (!canSwipeRight) {
        snapBack();
      } else {
        lastSwipeTimeRef.current = now;
        slideOut(`${window.innerWidth}px`, onSwipeRight, `-${window.innerWidth}px`);
      }
    } else {
      snapBack();
    }

    swipingRef.current = false;
    currentXRef.current = 0;
  }, [onSwipeLeft, onSwipeRight, snapBack, canSwipeLeft, canSwipeRight]);

  return {
    containerRef,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
