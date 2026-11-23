import { useState, useMemo, useRef, useCallback } from 'react';
import type { MenuItem, SelectedOption } from '../../lib/types';
import { formatPrice } from '../../lib/utils';
import { useCartStore } from '../../lib/cart-store';
import { useToast } from '../ui/useToast';
import Sheet from '../ui/Sheet';
import FoodImage from '../ui/FoodImage';
import QuantityStepper from '../ui/QuantityStepper';
import Textarea from '../ui/Textarea';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface ItemCustomizerProps {
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

export default function ItemCustomizer({
  item,
  categoryItems = [],
  open,
  onClose,
  onSelect,
}: ItemCustomizerProps) {
  const addItem = useCartStore(s => s.addItem);
  const { toast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selections, setSelections] = useState<Record<string, string[]>>(() => getInitialSelections(item));
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Position within category
  const currentIndex = useMemo(() => {
    if (!item || categoryItems.length === 0) return -1;
    return categoryItems.findIndex(i => i.id === item.id);
  }, [item, categoryItems]);

  const totalItems = categoryItems.length;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < totalItems - 1;

  const prevItem = canPrev ? categoryItems[currentIndex - 1] : null;
  const nextItem = canNext ? categoryItems[currentIndex + 1] : null;

  // Track & gesture refs for 1:1 finger tracking
  const trackRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);

  const pointerState = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startTime: number;
    currentDx: number;
    isHorizDrag: boolean;
    pointerId?: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    currentDx: 0,
    isHorizDrag: false,
  });

  const animateTrack = useCallback((targetDx: number, onComplete?: () => void) => {
    const track = trackRef.current;
    if (!track) {
      onComplete?.();
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      track.style.transition = 'none';
      track.style.transform = `translate3d(${targetDx}px, 0, 0)`;
      onComplete?.();
      return;
    }

    animatingRef.current = true;
    track.style.transition = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';
    track.style.transform = `translate3d(${targetDx}px, 0, 0)`;

    const handleTransitionEnd = (e: TransitionEvent) => {
      if (e.target !== track) return;
      track.removeEventListener('transitionend', handleTransitionEnd);
      animatingRef.current = false;
      onComplete?.();
    };

    track.addEventListener('transitionend', handleTransitionEnd);
  }, []);

  const handlePrev = useCallback(() => {
    if (!canPrev || !onSelect || animatingRef.current) return;
    const containerWidth = containerRef.current?.offsetWidth || 390;
    animateTrack(containerWidth, () => {
      if (trackRef.current) {
        trackRef.current.style.transition = 'none';
        trackRef.current.style.transform = 'translate3d(0, 0, 0)';
      }
      onSelect(categoryItems[currentIndex - 1]);
    });
  }, [canPrev, onSelect, currentIndex, categoryItems, animateTrack]);

  const handleNext = useCallback(() => {
    if (!canNext || !onSelect || animatingRef.current) return;
    const containerWidth = containerRef.current?.offsetWidth || 390;
    animateTrack(-containerWidth, () => {
      if (trackRef.current) {
        trackRef.current.style.transition = 'none';
        trackRef.current.style.transform = 'translate3d(0, 0, 0)';
      }
      onSelect(categoryItems[currentIndex + 1]);
    });
  }, [canNext, onSelect, currentIndex, categoryItems, animateTrack]);

  const handleDragStart = (clientX: number, clientY: number, pointerId?: number) => {
    if (!trackRef.current) return;

    // Interrupt-safe: mid-animation interaction stops animation immediately
    if (animatingRef.current) {
      trackRef.current.style.transition = 'none';
      animatingRef.current = false;
    }

    pointerState.current = {
      active: true,
      startX: clientX,
      startY: clientY,
      startTime: Date.now(),
      currentDx: 0,
      isHorizDrag: false,
      pointerId,
    };
  };

  const handleDragMove = (clientX: number, clientY: number) => {
    const state = pointerState.current;
    if (!state.active || !trackRef.current) return;

    const dx = clientX - state.startX;
    const dy = clientY - state.startY;

    if (!state.isHorizDrag) {
      // If vertical motion is dominant, allow vertical scrolling
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
        state.active = false;
        return;
      }
      // If horizontal motion is dominant, lock in horizontal drag
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
        state.isHorizDrag = true;
      } else {
        return;
      }
    }

    // 1:1 follow with rubber-band resistance at first / last item
    let effectiveDx = dx;
    if ((!canPrev && dx > 0) || (!canNext && dx < 0)) {
      effectiveDx = dx * 0.28;
    }

    state.currentDx = effectiveDx;
    trackRef.current.style.transition = 'none';
    trackRef.current.style.transform = `translate3d(${effectiveDx}px, 0, 0)`;
  };

  const handleDragEnd = () => {
    const state = pointerState.current;
    if (!state.active) return;
    state.active = false;

    if (!state.isHorizDrag || !trackRef.current) {
      if (trackRef.current) {
        trackRef.current.style.transform = 'translate3d(0, 0, 0)';
      }
      return;
    }

    state.isHorizDrag = false;
    const dx = state.currentDx;
    const elapsed = Math.max(Date.now() - state.startTime, 1);
    const velocity = Math.abs(dx) / elapsed; // px/ms
    const containerWidth = containerRef.current?.offsetWidth || 390;

    const thresholdDist = containerWidth * 0.25;
    const shouldGoNext = canNext && (dx < -thresholdDist || (dx < -15 && velocity > 0.5));
    const shouldGoPrev = canPrev && (dx > thresholdDist || (dx > 15 && velocity > 0.5));

    if (shouldGoNext && onSelect) {
      animateTrack(-containerWidth, () => {
        if (trackRef.current) {
          trackRef.current.style.transition = 'none';
          trackRef.current.style.transform = 'translate3d(0, 0, 0)';
        }
        onSelect(categoryItems[currentIndex + 1]);
      });
    } else if (shouldGoPrev && onSelect) {
      animateTrack(containerWidth, () => {
        if (trackRef.current) {
          trackRef.current.style.transition = 'none';
          trackRef.current.style.transform = 'translate3d(0, 0, 0)';
        }
        onSelect(categoryItems[currentIndex - 1]);
      });
    } else {
      // Snap back to 0
      animateTrack(0);
    }
  };

  // Pointer event handlers
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, a')) return;
    handleDragStart(e.clientX, e.clientY, e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerState.current.active) return;
    handleDragMove(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    handleDragEnd();
  };

  const onPointerCancel = () => {
    handleDragEnd();
  };

  // Touch event handlers (for touch screens and touch test dispatches)
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const onTouchEnd = () => {
    handleDragEnd();
  };

  const selectedOptions = useMemo((): SelectedOption[] => {
    if (!item) return [];
    const result: SelectedOption[] = [];
    for (const group of item.optionGroups || []) {
      const selected = selections[group.id] || [];
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
  }, [item, selections]);

  const unitPrice = useMemo(() => {
    if (!item) return 0;
    return item.price + selectedOptions.reduce((sum, o) => sum + o.price, 0);
  }, [item, selectedOptions]);

  const totalPrice = unitPrice * quantity;

  function handleSingleSelect(groupId: string, optionId: string) {
    setSelections(prev => ({ ...prev, [groupId]: [optionId] }));
    setErrors(prev => {
      if (!prev[groupId]) return prev;
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  }

  function handleMultiToggle(groupId: string, optionId: string, maxSelections?: number) {
    setSelections(prev => {
      const current = prev[groupId] || [];
      if (current.includes(optionId)) {
        return { ...prev, [groupId]: current.filter(id => id !== optionId) };
      }
      if (maxSelections && current.length >= maxSelections) {
        return prev;
      }
      return { ...prev, [groupId]: [...current, optionId] };
    });
    setErrors(prev => {
      if (!prev[groupId]) return prev;
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  }

  function handleAddToCart() {
    if (!item || !item.available) return;

    // Validate all required option groups that have selectable options
    const newErrors: Record<string, string> = {};
    const requiredGroups = (item.optionGroups || []).filter(
      g => g.required && g.options && g.options.length > 0
    );

    for (const group of requiredGroups) {
      const selected = selections[group.id] || [];
      if (selected.length === 0) {
        newErrors[group.id] = `Please select an option for ${group.name}`;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    addItem({
      menuItemId: item.id,
      name: item.name,
      image: item.image,
      basePrice: item.price,
      quantity,
      selectedOptions,
      notes,
    });
    toast('Added to cart');
    onClose();
  }

  if (!item) return null;

  return (
    <Sheet open={open} onClose={onClose} title={item.name} hideHeader={true}>
      <div
        ref={containerRef}
        data-testid="customizer-swipe-container"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ touchAction: 'pan-y' }}
        className="relative w-full overflow-hidden select-none"
      >
        {/* Fixed controls over image (44px target Close X, Position indicator, Desktop arrows) */}
        <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
          {/* Position indicator (e.g. "3 / 8") */}
          {totalItems > 1 && (
            <div className="absolute top-3.5 left-4 px-3 py-1 rounded-full bg-black/50 text-white text-xs font-semibold backdrop-blur-md tabular-nums shadow-sm select-none pointer-events-auto">
              {currentIndex + 1} / {totalItems}
            </div>
          )}

          {/* 44px touch target Close (X) button visible over image */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-2.5 right-3 w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-md transition-colors cursor-pointer shadow-sm pointer-events-auto"
          >
            <X className="h-5 w-5 stroke-[2.5]" />
          </button>

          {/* Desktop Prev/Next Buttons (hidden at edges) */}
          {canPrev && (
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Previous item"
              className="hidden md:flex absolute left-3 top-24 z-30 w-10 h-10 items-center justify-center rounded-full bg-black/45 hover:bg-black/70 text-white backdrop-blur-md shadow-md transition-all cursor-pointer pointer-events-auto"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          {canNext && (
            <button
              type="button"
              onClick={handleNext}
              aria-label="Next item"
              className="hidden md:flex absolute right-3 top-24 z-30 w-10 h-10 items-center justify-center rounded-full bg-black/45 hover:bg-black/70 text-white backdrop-blur-md shadow-md transition-all cursor-pointer pointer-events-auto"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* ─── Carousel Track ─── */}
        <div
          ref={trackRef}
          style={{ willChange: 'transform' }}
          className="relative w-full"
        >
          {/* Previous item neighbor panel */}
          {prevItem && (
            <div
              className="absolute top-0 left-[-100%] w-full h-full pointer-events-none select-none overflow-hidden"
              aria-hidden="true"
            >
              <NeighborPanel item={prevItem} />
            </div>
          )}

          {/* Current active item panel */}
          <div className="relative w-full pb-6 select-auto">
            <div className="relative overflow-hidden bg-background">
              <FoodImage
                src={item.image}
                alt={item.name}
                className="rounded-none w-full aspect-[16/10] object-cover"
              />

              {/* Sold out badge */}
              {!item.available && (
                <div className="absolute bottom-3 left-4 z-20">
                  <Badge variant="danger">Sold out</Badge>
                </div>
              )}
            </div>

            <div className="px-5 pt-4">
              <h2 className="text-xl font-heading font-bold text-ink">{item.name}</h2>
              <p className="text-sm text-muted mt-1">{item.description}</p>
              <p className="text-lg font-heading font-bold text-ink tabular-nums mt-2">
                {formatPrice(item.price)}
              </p>
            </div>

            {/* Option Groups */}
            {(item.optionGroups || []).map(group => {
              const selected = selections[group.id] || [];
              const atMax = group.type === 'multi' && group.maxSelections
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
                      <span className="text-xs text-muted">Max {group.maxSelections}</span>
                    )}
                  </div>

                  {errors[group.id] && (
                    <p className="text-xs font-medium text-danger mb-2">
                      {errors[group.id]}
                    </p>
                  )}

                  <div className="flex flex-col gap-1">
                    {(group.options || []).map(opt => {
                      const isSelected = selected.includes(opt.id);
                      const isDisabled = group.type === 'multi' && !isSelected && atMax;

                      return (
                        <button
                          key={opt.id}
                          onClick={() => {
                            if (group.type === 'single') {
                              handleSingleSelect(group.id, opt.id);
                            } else {
                              handleMultiToggle(group.id, opt.id, group.maxSelections);
                            }
                          }}
                          disabled={isDisabled || !item.available}
                          className={`
                            flex items-center justify-between w-full px-3 py-3 rounded-[var(--radius-input)]
                            text-left transition-colors duration-150 cursor-pointer
                            disabled:opacity-40 disabled:cursor-not-allowed
                            ${isSelected ? 'bg-primary/5 border border-primary' : 'border border-border hover:border-ink/20'}
                          `}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`
                              flex items-center justify-center shrink-0
                              ${group.type === 'single' ? 'h-5 w-5 rounded-full border-2' : 'h-5 w-5 rounded border-2'}
                              ${isSelected ? 'border-primary bg-primary' : 'border-border'}
                            `}
                            >
                              {isSelected && (
                                <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
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
                            <span className="text-sm font-medium text-ink">{opt.name}</span>
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

            {/* Special Instructions */}
            <div className="px-5 pt-5">
              <label htmlFor="notes" className="block text-sm font-semibold text-ink mb-2">
                Special instructions
              </label>
              <Textarea
                id="notes"
                placeholder="Any allergies, dislikes, or special requests? (Optional)"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                maxChars={140}
                rows={3}
                disabled={!item.available}
              />
            </div>
          </div>

          {/* Next item neighbor panel */}
          {nextItem && (
            <div
              className="absolute top-0 left-[100%] w-full h-full pointer-events-none select-none overflow-hidden"
              aria-hidden="true"
            >
              <NeighborPanel item={nextItem} />
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 bg-surface border-t border-border px-5 py-4 flex items-center gap-4 z-20">
          <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            min={1}
            max={10}
            disabled={!item.available}
          />
          <Button
            size="lg"
            className="flex-1"
            disabled={!item.available}
            onClick={handleAddToCart}
          >
            {!item.available ? 'Sold out' : `Add to cart · ${formatPrice(totalPrice)}`}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function NeighborPanel({ item }: { item: MenuItem }) {
  return (
    <div className="w-full pb-6 select-none bg-surface">
      <div className="relative overflow-hidden bg-background">
        <FoodImage
          src={item.image}
          alt={item.name}
          className="rounded-none w-full aspect-[16/10] object-cover"
        />
        {!item.available && (
          <div className="absolute bottom-3 left-4 z-20">
            <Badge variant="danger">Sold out</Badge>
          </div>
        )}
      </div>

      <div className="px-5 pt-4">
        <h2 className="text-xl font-heading font-bold text-ink">{item.name}</h2>
        <p className="text-sm text-muted mt-1 line-clamp-2">{item.description}</p>
        <p className="text-lg font-heading font-bold text-ink tabular-nums mt-2">
          {formatPrice(item.price)}
        </p>
      </div>
    </div>
  );
}
