import React, {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
} from 'react';
import type { MenuItem, SelectedOption } from '../../lib/types';
import { formatPrice } from '../../lib/utils';
import { useCartStore } from '../../lib/cart-store';
import { useToast } from '../ui/useToast';
import QuantityStepper from '../ui/QuantityStepper';
import Textarea from '../ui/Textarea';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';

export interface ProductSheetProps {
  item: MenuItem | null;
  categoryItems?: MenuItem[];
  open: boolean;
  onClose: () => void;
  onSelect?: (item: MenuItem) => void;
}

function getInitialSelections(item: MenuItem | null): Record<string, string[]> {
  if (!item) return {};
  const initial: Record<string, string[]> = {};
  (item.optionGroups || []).forEach(g => {
    if (g.required && g.type === 'single' && g.options && g.options.length > 0) {
      initial[g.id] = [g.options[0].id];
    }
  });
  return initial;
}

const initialSelectionsCache = new Map<string, Record<string, string[]>>();
function getCachedInitialSelections(item: MenuItem): Record<string, string[]> {
  let cached = initialSelectionsCache.get(item.id);
  if (!cached) {
    cached = getInitialSelections(item);
    initialSelectionsCache.set(item.id, cached);
  }
  return cached;
}

export function ProductSheet({
  item,
  categoryItems = [],
  open,
  onClose,
  onSelect: _onSelect,
}: ProductSheetProps) {
  void _onSelect;
  const addItem = useCartStore(s => s.addItem);
  const { toast } = useToast();

  // Find initial index from category items
  const initialIndex = useMemo(() => {
    if (!item || categoryItems.length === 0) return 0;
    const idx = categoryItems.findIndex(i => i.id === item.id);
    return idx >= 0 ? idx : 0;
  }, [item, categoryItems]);

  const [activeIndex, setActiveIndex] = useState(initialIndex);

  // Sync index when incoming item prop opens a different product
  const lastOpenedId = useRef<string | null>(null);
  useEffect(() => {
    if (open && item && item.id !== lastOpenedId.current) {
      lastOpenedId.current = item.id;
      const idx = categoryItems.findIndex(i => i.id === item.id);
      if (idx >= 0) {
        setActiveIndex(idx);
      }
    }
    if (!open) {
      lastOpenedId.current = null;
    }
  }, [open, item, categoryItems]);

  // Selected options, notes, and quantities stored in per-item map outside panels
  const [allSelections, setAllSelections] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const [allNotes, setAllNotes] = useState<Record<string, string>>({});
  const [allQuantities, setAllQuantities] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Active item references
  const totalItems = categoryItems.length;
  const currentItem = categoryItems[activeIndex] || item;
  const canPrev = activeIndex > 0;
  const canNext = activeIndex < totalItems - 1;

  // Preload ±2 neighbor images (decode before swipe lands, deduplicated)
  const preloadedUrls = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (categoryItems.length === 0) return;
    [-2, -1, 1, 2].forEach(offset => {
      const targetIdx = activeIndex + offset;
      if (targetIdx >= 0 && targetIdx < categoryItems.length) {
        const neighbor = categoryItems[targetIdx];
        if (neighbor?.image && !preloadedUrls.current.has(neighbor.image)) {
          preloadedUrls.current.add(neighbor.image);
          const img = new Image();
          img.src = neighbor.image;
          img.decode?.().catch(() => {});
        }
      }
    });
  }, [activeIndex, categoryItems]);

  // Trap keyboard Esc and lock body scroll
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [open, onClose]);

  // DOM refs
  const sheetOverlayRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Add-to-cart animation state
  const [buttonScale, setButtonScale] = useState(1);
  const [isAdded, setIsAdded] = useState(false);
  const [flyingDot, setFlyingDot] = useState<{
    startX: number;
    startY: number;
    deltaX: number;
    deltaY: number;
    animating: boolean;
  } | null>(null);

  // Open at tapped item with scrollTo instant before first paint
  useLayoutEffect(() => {
    if (!open) return;
    const carousel = carouselRef.current;
    if (!carousel) return;
    const width = carousel.offsetWidth || window.innerWidth;
    const targetLeft = initialIndex * width;
    carousel.scrollTo({
      left: targetLeft,
      behavior: 'instant' as ScrollBehavior,
    });
  }, [open, initialIndex]);

  // Track active index with IntersectionObserver (no scroll-event state updates)
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel || categoryItems.length === 0) return;

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idxAttr = entry.target.getAttribute('data-index');
            if (idxAttr !== null) {
              const newIndex = parseInt(idxAttr, 10);
              setActiveIndex(prev => (prev === newIndex ? prev : newIndex));
            }
          }
        }
      },
      {
        root: carousel,
        threshold: 0.51,
      }
    );

    panelRefs.current.forEach(el => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [categoryItems.length]);

  // Desktop Arrow Buttons (≥768px): scrollBy smooth
  const handlePrev = useCallback(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const width = carousel.offsetWidth || 390;
    carousel.scrollBy({ left: -width, behavior: 'smooth' });
  }, []);

  const handleNext = useCallback(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const width = carousel.offsetWidth || 390;
    carousel.scrollBy({ left: width, behavior: 'smooth' });
  }, []);

  // Swipe-down-to-dismiss strictly on header / drag handle
  const dismissStartY = useRef(0);
  const dismissDy = useRef(0);

  const handleDismissTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      dismissStartY.current = e.touches[0].clientY;
      dismissDy.current = 0;
    }
  };

  const handleDismissTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      const dy = e.touches[0].clientY - dismissStartY.current;
      if (dy > 0 && sheetOverlayRef.current) {
        dismissDy.current = dy;
        sheetOverlayRef.current.style.transition = 'none';
        sheetOverlayRef.current.style.transform = `translate3d(0, ${dy}px, 0)`;
      }
    }
  };

  const handleDismissTouchEnd = () => {
    const dy = dismissDy.current;
    const sheetHeight = sheetOverlayRef.current?.offsetHeight || 800;
    if (dy > sheetHeight * 0.25 || dy > 120) {
      if (sheetOverlayRef.current) {
        sheetOverlayRef.current.style.transition =
          'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)';
        sheetOverlayRef.current.style.transform = `translate3d(0, ${sheetHeight}px, 0)`;
        setTimeout(onClose, 200);
      } else {
        onClose();
      }
    } else if (sheetOverlayRef.current) {
      sheetOverlayRef.current.style.transition =
        'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)';
      sheetOverlayRef.current.style.transform = 'translate3d(0, 0, 0)';
    }
    dismissDy.current = 0;
  };

  // Support synthetic test TouchEvents on carousel
  const touchStartX = useRef(0);
  const handleCarouselTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      touchStartX.current = e.touches[0].clientX;
    }
  };

  const handleCarouselTouchEnd = (e: React.TouchEvent) => {
    if (e.changedTouches.length > 0) {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      const width = carouselRef.current?.offsetWidth || 390;
      if (dx < -width * 0.25) {
        carouselRef.current?.scrollBy({ left: width, behavior: 'smooth' });
      } else if (dx > width * 0.25) {
        carouselRef.current?.scrollBy({ left: -width, behavior: 'smooth' });
      }
    }
  };

  // Selection handlers updating per-item map
  const handleSingleSelect = useCallback(
    (itemId: string, groupId: string, optionId: string) => {
      setAllSelections(prev => {
        const itemObj = categoryItems.find(i => i.id === itemId) || currentItem;
        const itemPrev = prev[itemId] || getInitialSelections(itemObj);
        return {
          ...prev,
          [itemId]: {
            ...itemPrev,
            [groupId]: [optionId],
          },
        };
      });
      setErrors(prev => {
        if (!prev[groupId]) return prev;
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    },
    [categoryItems, currentItem]
  );

  const handleMultiToggle = useCallback(
    (
      itemId: string,
      groupId: string,
      optionId: string,
      maxSelections?: number
    ) => {
      setAllSelections(prev => {
        const itemObj = categoryItems.find(i => i.id === itemId) || currentItem;
        const itemPrev = prev[itemId] || getInitialSelections(itemObj);
        const groupPrev = itemPrev[groupId] || [];
        let groupNext: string[];
        if (groupPrev.includes(optionId)) {
          groupNext = groupPrev.filter(id => id !== optionId);
        } else {
          if (maxSelections && groupPrev.length >= maxSelections) return prev;
          groupNext = [...groupPrev, optionId];
        }
        return {
          ...prev,
          [itemId]: {
            ...itemPrev,
            [groupId]: groupNext,
          },
        };
      });
      setErrors(prev => {
        if (!prev[groupId]) return prev;
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    },
    [categoryItems, currentItem]
  );

  const handleNotesChange = useCallback((itemId: string, notes: string) => {
    setAllNotes(prev => ({ ...prev, [itemId]: notes }));
  }, []);

  const handleQuantityChange = useCallback(
    (qty: number) => {
      if (!currentItem) return;
      setAllQuantities(prev => ({ ...prev, [currentItem.id]: qty }));
    },
    [currentItem]
  );

  // Pricing & selections for sticky footer
  const activeSelections = useMemo(() => {
    if (!currentItem) return {};
    return allSelections[currentItem.id] || getInitialSelections(currentItem);
  }, [currentItem, allSelections]);

  const activeNotes = currentItem ? allNotes[currentItem.id] || '' : '';
  const activeQuantity = currentItem ? allQuantities[currentItem.id] || 1 : 1;

  const selectedOptionsList = useMemo((): SelectedOption[] => {
    if (!currentItem) return [];
    const result: SelectedOption[] = [];
    for (const group of currentItem.optionGroups || []) {
      const selected = activeSelections[group.id] || [];
      for (const optId of selected) {
        const opt = group.options.find(o => o.id === optId);
        if (opt) {
          result.push({
            groupId: group.id,
            groupName: group.name,
            optionId: opt.id,
            optionName: opt.name,
            price: opt.price,
          });
        }
      }
    }
    return result;
  }, [currentItem, activeSelections]);

  const unitPrice = useMemo(() => {
    if (!currentItem) return 0;
    return (
      currentItem.price +
      selectedOptionsList.reduce((sum, o) => sum + o.price, 0)
    );
  }, [currentItem, selectedOptionsList]);

  const totalPrice = unitPrice * activeQuantity;

  // Add to cart action with complete animation sequence
  const handleAddToCart = useCallback(() => {
    if (!currentItem || !currentItem.available) return;

    // Validate required options
    const newErrors: Record<string, string> = {};
    const requiredGroups = (currentItem.optionGroups || []).filter(
      g => g.required && g.options && g.options.length > 0
    );

    for (const group of requiredGroups) {
      const selected = activeSelections[group.id] || [];
      if (selected.length === 0) {
        newErrors[group.id] = `Please select an option for ${group.name}`;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 1. Button scale animation (0.96 then back over 120ms)
    setButtonScale(0.96);
    setTimeout(() => {
      setButtonScale(1);
    }, 120);

    // 2. Label swaps to check + "Added" for 600ms
    setIsAdded(true);
    setTimeout(() => {
      setIsAdded(false);
    }, 600);

    // Add item to cart store
    addItem({
      menuItemId: currentItem.id,
      name: currentItem.name,
      image: currentItem.image,
      basePrice: currentItem.price,
      quantity: activeQuantity,
      selectedOptions: selectedOptionsList,
      notes: activeNotes,
    });

    const triggerBadgePop = () => {
      if (typeof document === 'undefined') return;
      const badges = document.querySelectorAll(
        'header button[aria-label*="cart" i] span, [aria-label*="cart" i] span, button[aria-label*="View cart" i] span'
      );
      badges.forEach(b => {
        b.animate(
          [{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }],
          { duration: 180, easing: 'ease-out' }
        );
      });
    };

    // 3. Flying dot from button to cart bar/icon (~400ms transform only)
    if (!prefersReducedMotion && typeof window !== 'undefined') {
      const btnRect = buttonRef.current?.getBoundingClientRect();
      const startX = btnRect
        ? btnRect.left + btnRect.width / 2 - 16
        : window.innerWidth / 2 - 16;
      const startY = btnRect
        ? btnRect.top + btnRect.height / 2 - 16
        : window.innerHeight - 80;

      const cartTarget =
        document.querySelector(
          'header button[aria-label*="cart" i], [aria-label*="cart" i]'
        ) ||
        document.querySelector('button[aria-label*="View cart" i]');
      const targetRect = cartTarget?.getBoundingClientRect();
      const targetX = targetRect
        ? targetRect.left + targetRect.width / 2 - 16
        : window.innerWidth - 40;
      const targetY = targetRect
        ? targetRect.top + targetRect.height / 2 - 16
        : 28;

      const deltaX = targetX - startX;
      const deltaY = targetY - startY;

      setFlyingDot({ startX, startY, deltaX, deltaY, animating: false });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setFlyingDot(prev => (prev ? { ...prev, animating: true } : null));
        });
      });

      setTimeout(() => {
        triggerBadgePop();
        setFlyingDot(null);
      }, 400);
    } else {
      triggerBadgePop();
    }

    // 4. Close the sheet after ~500ms
    setTimeout(() => {
      onClose();
      toast('Added to cart');
    }, 500);
  }, [
    currentItem,
    activeSelections,
    selectedOptionsList,
    activeNotes,
    activeQuantity,
    addItem,
    onClose,
    toast,
  ]);

  if (!open || !currentItem) return null;

  return (
    <div
      ref={sheetOverlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={currentItem.name}
      onTouchStart={e => {
        // Allow swipe down if touch begins at top bar/handle (clientY < 140)
        if (e.touches.length > 0 && e.touches[0].clientY < 140) {
          handleDismissTouchStart(e);
        }
      }}
      onTouchMove={e => {
        if (dismissStartY.current > 0) {
          handleDismissTouchMove(e);
        }
      }}
      onTouchEnd={handleDismissTouchEnd}
      onTouchCancel={handleDismissTouchEnd}
      className="fixed inset-0 z-50 flex flex-col bg-background h-[100dvh] max-h-[100dvh] overflow-hidden select-none"
    >
      {/* ─── Top Bar with Drag Handle & Sticky Close X Button (Outside carousel, never moves) ─── */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border/80 px-4 pt-[max(env(safe-area-inset-top,0px),6px)] pb-2 flex flex-col shrink-0">
        {/* Swipe-down-to-dismiss drag handle */}
        <div
          className="mx-auto w-12 h-1.5 rounded-full bg-border/80 mb-2 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={handleDismissTouchStart}
          onTouchMove={handleDismissTouchMove}
          onTouchEnd={handleDismissTouchEnd}
          onTouchCancel={handleDismissTouchEnd}
          aria-hidden="true"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {totalItems > 1 && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-surface border border-border text-ink text-xs font-semibold tabular-nums shadow-sm">
                {activeIndex + 1} / {totalItems}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-ink hover:bg-surface border border-border transition-colors cursor-pointer shadow-sm pointer-events-auto"
          >
            <X className="h-5 w-5 stroke-[2.2]" />
          </button>
        </div>
      </div>

      {/* ─── Desktop Arrows (≥768px): call scrollBy smooth ─── */}
      {canPrev && (
        <button
          type="button"
          onClick={handlePrev}
          aria-label="Previous item"
          className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-40 w-11 h-11 items-center justify-center rounded-full bg-black/50 hover:bg-black/75 text-white backdrop-blur-md shadow-lg transition-all cursor-pointer"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {canNext && (
        <button
          type="button"
          onClick={handleNext}
          aria-label="Next item"
          className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-40 w-11 h-11 items-center justify-center rounded-full bg-black/50 hover:bg-black/75 text-white backdrop-blur-md shadow-lg transition-all cursor-pointer"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* ─── Native Scroll-Snap Horizontal Container ─── */}
      <div
        ref={carouselRef}
        data-testid="customizer-swipe-container"
        onTouchStart={handleCarouselTouchStart}
        onTouchEnd={handleCarouselTouchEnd}
        className="flex-1 flex overflow-x-auto overflow-y-hidden scroll-hide overscroll-x-contain select-none w-full"
        style={{
          display: 'flex',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          overscrollBehaviorX: 'contain',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {categoryItems.map((catItem, idx) => {
          const itemSelections =
            allSelections[catItem.id] || getCachedInitialSelections(catItem);
          const itemNotes = allNotes[catItem.id] || '';

          return (
            <div
              key={catItem.id}
              data-item-id={catItem.id}
              data-index={idx}
              ref={el => {
                panelRefs.current[idx] = el;
              }}
              style={{
                flex: '0 0 100%',
                scrollSnapAlign: 'center',
                scrollSnapStop: 'always',
              }}
              className="w-full h-full overflow-y-auto overscroll-y-contain flex flex-col select-auto"
            >
              <MemoizedItemPanel
                item={catItem}
                selections={itemSelections}
                errors={catItem.id === currentItem.id ? errors : EMPTY_ERRORS}
                notes={itemNotes}
                onSingleSelect={handleSingleSelect}
                onMultiToggle={handleMultiToggle}
                onNotesChange={handleNotesChange}
              />
            </div>
          );
        })}
      </div>

      {/* ─── Sticky Footer (Add to Cart · ₹total) (Outside carousel, never moves) ─── */}
      <div className="sticky bottom-0 bg-surface/95 backdrop-blur-md border-t border-border px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)] flex items-center gap-3 z-30 shrink-0">
        <QuantityStepper
          value={activeQuantity}
          onChange={handleQuantityChange}
          min={1}
          max={10}
          disabled={!currentItem.available}
        />
        <Button
          ref={buttonRef}
          size="lg"
          className="flex-1"
          disabled={!currentItem.available}
          onClick={handleAddToCart}
          style={{
            transform: `scale(${buttonScale})`,
            transition: 'transform 120ms ease-out',
          }}
        >
          {isAdded ? (
            <span className="flex items-center justify-center gap-2">
              <Check className="h-5 w-5 stroke-[2.5]" />
              <span>Added</span>
            </span>
          ) : !currentItem.available ? (
            'Sold out'
          ) : (
            `Add to cart · ${formatPrice(totalPrice)}`
          )}
        </Button>
      </div>

      {/* ─── Flying Item Dot (Transform only ~400ms) ─── */}
      {flyingDot && (
        <div
          style={{
            position: 'fixed',
            zIndex: 9999,
            left: flyingDot.startX,
            top: flyingDot.startY,
            width: 32,
            height: 32,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            pointerEvents: 'none',
            transform: flyingDot.animating
              ? `translate3d(${flyingDot.deltaX}px, ${flyingDot.deltaY}px, 0) scale(0.35)`
              : 'translate3d(0, 0, 0) scale(1)',
            opacity: flyingDot.animating ? 0.75 : 1,
            transition:
              'transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 400ms ease-in',
          }}
        >
          <img
            src={currentItem.image}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}
    </div>
  );
}

const EMPTY_ERRORS: Record<string, string> = {};

// ─── Memoized Item Panel Component (Rendered once per item lifetime) ───

interface ItemPanelProps {
  item: MenuItem;
  selections: Record<string, string[]>;
  errors: Record<string, string>;
  notes: string;
  onSingleSelect: (itemId: string, groupId: string, optionId: string) => void;
  onMultiToggle: (
    itemId: string,
    groupId: string,
    optionId: string,
    maxSelections?: number
  ) => void;
  onNotesChange: (itemId: string, notes: string) => void;
}

const MemoizedItemPanel = React.memo(
  function ItemPanel({
    item,
    selections,
    errors,
    notes,
    onSingleSelect,
    onMultiToggle,
    onNotesChange,
  }: ItemPanelProps) {
    // Track render count per item (renders once on initial mount)
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        __itemPanelRenderCounts?: Record<string, number>;
      };
      if (!w.__itemPanelRenderCounts) {
        w.__itemPanelRenderCounts = {};
      }
      w.__itemPanelRenderCounts[item.id] =
        (w.__itemPanelRenderCounts[item.id] || 0) + 1;
    }

    return (
      <div className="w-full pb-8 select-auto">
        {/* Fixed-aspect image with reserved 16:10 ratio (CLS = 0) */}
        <div className="relative w-full aspect-[16/10] bg-surface overflow-hidden">
          <img
            src={item.image}
            alt={item.name}
            decoding="async"
            className="w-full h-full object-cover"
          />
          {!item.available && (
            <div className="absolute bottom-3 left-4 z-20">
              <Badge variant="danger">Sold out</Badge>
            </div>
          )}
        </div>

        {/* Item info with reserved min-heights */}
        <div className="px-5 pt-4">
          <h2 className="text-xl font-heading font-bold text-ink min-h-[1.75rem]">
            {item.name}
          </h2>
          <p className="text-sm text-muted mt-1 line-clamp-2 min-h-[2.5rem]">
            {item.description}
          </p>
          <p className="text-lg font-heading font-bold text-ink tabular-nums mt-2">
            {formatPrice(item.price)}
          </p>
        </div>

        {/* Option Groups */}
        {(item.optionGroups || []).map(group => {
          const selected = selections[group.id] || [];
          const atMax =
            group.type === 'multi' && group.maxSelections
              ? selected.length >= group.maxSelections
              : false;

          return (
            <div key={group.id} className="px-5 pt-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-semibold text-ink">
                  {group.name}
                  {group.required && <span className="text-danger ml-1">*</span>}
                </h3>
                {group.type === 'multi' && group.maxSelections && (
                  <span className="text-xs text-muted">
                    Max {group.maxSelections}
                  </span>
                )}
              </div>

              {errors[group.id] && (
                <p className="text-xs font-medium text-danger mb-2">
                  {errors[group.id]}
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                {(group.options || []).map(opt => {
                  const isSelected = selected.includes(opt.id);
                  const isDisabled =
                    group.type === 'multi' && !isSelected && atMax;

                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        if (group.type === 'single') {
                          onSingleSelect(item.id, group.id, opt.id);
                        } else {
                          onMultiToggle(
                            item.id,
                            group.id,
                            opt.id,
                            group.maxSelections
                          );
                        }
                      }}
                      disabled={isDisabled || !item.available}
                      className={`
                        flex items-center justify-between w-full px-3.5 py-3 rounded-[var(--radius-input)]
                        text-left transition-colors duration-150 cursor-pointer
                        disabled:opacity-40 disabled:cursor-not-allowed
                        ${
                          isSelected
                            ? 'bg-primary/5 border border-primary'
                            : 'border border-border hover:border-ink/20'
                        }
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`
                            flex items-center justify-center shrink-0
                            ${
                              group.type === 'single'
                                ? 'h-5 w-5 rounded-full border-2'
                                : 'h-5 w-5 rounded border-2'
                            }
                            ${isSelected ? 'border-primary bg-primary' : 'border-border'}
                          `}
                        >
                          {isSelected && (
                            <svg
                              className="h-3 w-3 text-white"
                              viewBox="0 0 12 12"
                              fill="none"
                            >
                              <path
                                d="M10 3L4.5 8.5L2 6"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm font-medium text-ink">
                          {opt.name}
                        </span>
                      </div>
                      {opt.price > 0 && (
                        <span className="text-sm font-semibold text-muted tabular-nums">
                          +{formatPrice(opt.price)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Special instructions */}
        <div className="px-5 pt-5">
          <label htmlFor="notes" className="block text-sm font-semibold text-ink mb-2">
            Special instructions
          </label>
          <Textarea
            id="notes"
            placeholder="Any allergies, dislikes, or special requests? (Optional)"
            value={notes}
            onChange={e => onNotesChange(item.id, e.target.value)}
            maxChars={140}
            rows={3}
            disabled={!item.available}
          />
        </div>
      </div>
    );
  },
  function areItemPanelPropsEqual(prev: ItemPanelProps, next: ItemPanelProps) {
    if (prev.item.id !== next.item.id) return false;
    if (prev.notes !== next.notes) return false;
    if (prev.errors !== next.errors) {
      if (
        Object.keys(prev.errors).length !== 0 ||
        Object.keys(next.errors).length !== 0
      ) {
        return false;
      }
    }
    if (prev.selections !== next.selections) {
      const prevKeys = Object.keys(prev.selections);
      const nextKeys = Object.keys(next.selections);
      if (prevKeys.length !== nextKeys.length) return false;
      for (const k of prevKeys) {
        const pArr = prev.selections[k] || [];
        const nArr = next.selections[k] || [];
        if (pArr.length !== nArr.length || pArr.some((v, i) => v !== nArr[i])) {
          return false;
        }
      }
    }
    return true;
  }
);

export default ProductSheet;
