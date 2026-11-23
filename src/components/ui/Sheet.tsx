import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  hideHeader?: boolean;
  showCloseButton?: boolean;
}

export default function Sheet({
  open,
  onClose,
  children,
  title,
  hideHeader = false,
  showCloseButton = false,
}: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';

    const sheet = sheetRef.current;
    if (sheet) {
      const focusable = sheet.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) focusable[0].focus();
    }

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (sheetRef.current && sheetRef.current.scrollTop > 5) return;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    startTimeRef.current = Date.now();
    isDraggingRef.current = true;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.touches[0].clientX - startXRef.current;
    const deltaY = e.touches[0].clientY - startYRef.current;

    // If horizontal motion is dominant, ignore vertical drag (allows horizontal swipe inside sheet)
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      return;
    }

    if (deltaY > 0) {
      setDragY(deltaY);
    } else {
      setDragY(0);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    const deltaY = e.changedTouches[0].clientY - startYRef.current;
    const elapsed = Date.now() - startTimeRef.current;
    const velocity = deltaY / Math.max(elapsed, 1);
    const sheetHeight = sheetRef.current?.offsetHeight || 400;

    // Fast flick down or dragged past ~25%
    if ((velocity > 0.45 && deltaY > 30) || deltaY > sheetHeight * 0.25) {
      onClose();
    }
    setDragY(0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
      <div className="overlay-backdrop absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Sheet'}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="
          relative z-10 w-full max-h-[90vh] overflow-y-auto bg-surface
          rounded-t-[20px] md:rounded-[var(--radius-card)] md:max-w-lg md:mx-4
          shadow-[var(--shadow-lg)]
        "
        style={{
          animation: isDragging || dragY > 0 ? undefined : 'sheet-up 250ms ease-out both',
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: isDragging ? 'none' : 'transform 200ms ease-out',
        }}
      >
        {/* Drag handle at top */}
        <div
          className="mx-auto w-10 h-1.5 rounded-full bg-border my-2.5 cursor-grab active:cursor-grabbing md:hidden"
          aria-hidden="true"
        />

        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 z-30 w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-black/45 hover:bg-black/60 text-white backdrop-blur-md transition-colors cursor-pointer shadow-[var(--shadow-sm)]"
          >
            <X className="h-5 w-5 stroke-[2.5]" />
          </button>
        )}

        {!hideHeader && title && (
          <div className="sticky top-0 z-10 bg-surface px-5 pt-1 pb-3 border-b border-border flex items-center justify-between">
            <h2 className="text-lg font-heading font-bold text-ink">{title}</h2>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
