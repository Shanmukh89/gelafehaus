import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, ShoppingCart } from 'lucide-react';
import { getMenu } from '../../lib/api';
import { useCartStore } from '../../lib/cart-store';
import { formatPrice, padTableNumber } from '../../lib/utils';
import type { MenuItem, MenuCategory } from '../../lib/types';
import { CATEGORIES, CATEGORY_LABELS } from '../../lib/types';
import Badge from '../../components/ui/Badge';
import Chip from '../../components/ui/Chip';
import Button from '../../components/ui/Button';
import FoodImage from '../../components/ui/FoodImage';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import OfflineBanner from '../../components/ui/OfflineBanner';
import ItemCustomizer from '../../components/customer/ItemCustomizer';
import CartBar from '../../components/customer/CartBar';
import CartDrawer from '../../components/customer/CartDrawer';
import { useToast } from '../../components/ui/useToast';

export default function MenuPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tableParam = searchParams.get('table');
  const confirmedTable = useCartStore(s => s.tableNumber);
  const addItem = useCartStore(s => s.addItem);
  const cartItems = useCartStore(s => s.items);
  const cartItemCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const { toast } = useToast();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<MenuCategory>('burgers');
  const [customizerItem, setCustomizerItem] = useState<MenuItem | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const chipContainerRef = useRef<HTMLDivElement>(null);
  const isScrollingToCategory = useRef(false);

  function handleOpenCustomizer(item: MenuItem, triggerEl?: HTMLElement) {
    lastTriggerRef.current = triggerEl || (document.activeElement as HTMLElement);
    setCustomizerItem(item);
  }

  function handleCloseCustomizer() {
    setCustomizerItem(null);
    setTimeout(() => {
      lastTriggerRef.current?.focus();
    }, 40);
  }

  // Category items for current customizer item
  const categoryItems = useMemo(() => {
    if (!customizerItem) return [];
    return items.filter(i => i.category === customizerItem.category);
  }, [items, customizerItem]);

  // Guards:
  // 1. Legacy URL /menu?table=07 -> redirect to /?table=07 so everyone sees the Welcome page.
  // 2. /menu with no confirmed table in the store -> redirect to /
  useEffect(() => {
    if (tableParam) {
      navigate(`/?table=${tableParam}`, { replace: true });
      return;
    }
    if (!confirmedTable) {
      navigate('/', { replace: true });
      return;
    }
  }, [tableParam, confirmedTable, navigate]);

  const initialMenuLoadRef = useRef(true);

  // Fetch menu
  const fetchMenu = useCallback(async () => {
    if (!confirmedTable) return;
    if (!initialMenuLoadRef.current) setLoading(true);
    setError(null);
    try {
      const data = await getMenu();
      setItems(data);
    } catch {
      setError('Failed to load menu');
    } finally {
      setLoading(false);
      initialMenuLoadRef.current = false;
    }
  }, [confirmedTable]);

  useEffect(() => {
    if (!confirmedTable) return;
    let ignore = false;
    getMenu()
      .then(data => {
        if (!ignore) {
          setItems(data);
          setError(null);
        }
      })
      .catch(() => {
        if (!ignore) setError('Failed to load menu');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [confirmedTable]);

  // Scroll-spy: watch which category section is in view
  useEffect(() => {
    if (loading || isScrollingToCategory.current) return;

    const observer = new IntersectionObserver(
      entries => {
        if (isScrollingToCategory.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const cat = entry.target.getAttribute('data-category') as MenuCategory;
            if (cat) setActiveCategory(cat);
          }
        }
      },
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 }
    );

    for (const cat of CATEGORIES) {
      const el = sectionRefs.current[cat];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [loading, items]);

  // Click on chip → scroll to section
  function scrollToCategory(cat: MenuCategory) {
    const el = sectionRefs.current[cat];
    if (!el) return;
    isScrollingToCategory.current = true;
    setActiveCategory(cat);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => { isScrollingToCategory.current = false; }, 600);
  }

  // Filter items by search
  const filteredItems = items.filter(
    i => !search || i.name.toLowerCase().includes(search.toLowerCase())
  );

  // Group by category
  const grouped = CATEGORIES.map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    items: filteredItems.filter(i => i.category === cat),
  })).filter(g => g.items.length > 0);

  // Quick add for items without options, or open customizer for items with options
  function handleAddItem(item: MenuItem, triggerEl?: HTMLElement) {
    if (!confirmedTable) return;
    const hasOptions = Boolean(
      item.optionGroups &&
      item.optionGroups.length > 0 &&
      item.optionGroups.some(g => g.options && g.options.length > 0)
    );
    if (hasOptions) {
      handleOpenCustomizer(item, triggerEl);
    } else {
      addItem({
        menuItemId: item.id,
        name: item.name,
        image: item.image,
        basePrice: item.price,
        quantity: 1,
        selectedOptions: [],
        notes: '',
      });
      toast('Added to cart');
    }
  }

  // Guard return: if bouncing to / or /?table=NN, render nothing to avoid flash
  if (tableParam || !confirmedTable) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <OfflineBanner />

      {/* ─── Sticky Header ─── */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between px-4 h-14">
          <h1 className="font-heading font-bold text-xl text-ink">Gelafehaus</h1>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-3 h-8 text-xs font-semibold bg-surface border border-border rounded-[var(--radius-chip)] text-muted tabular-nums">
              Table {padTableNumber(confirmedTable)}
            </span>
            <button
              type="button"
              onClick={() => setCartDrawerOpen(true)}
              aria-label={cartItemCount > 0 ? `Open cart, ${cartItemCount} items` : 'Open cart'}
              className="relative h-9 w-9 flex items-center justify-center rounded-[var(--radius-input)] text-ink hover:bg-surface border border-border transition-colors cursor-pointer"
            >
              <ShoppingCart className="h-4 w-4" />
              {cartItemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-[10px] font-bold h-4 min-w-[16px] px-1 rounded-full flex items-center justify-center tabular-nums shadow-sm">
                  {cartItemCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="search"
              placeholder="Search the menu…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="
                w-full h-10 pl-9 pr-3 text-sm bg-surface text-ink placeholder:text-muted
                border border-border rounded-[var(--radius-input)]
                focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
                transition-colors duration-150
              "
            />
          </div>
        </div>

        {/* Category chips */}
        <div
          ref={chipContainerRef}
          className="flex gap-2 px-4 pb-3 overflow-x-auto scroll-hide"
        >
          {CATEGORIES.map(cat => (
            <Chip
              key={cat}
              label={CATEGORY_LABELS[cat]}
              active={activeCategory === cat}
              onClick={() => scrollToCategory(cat)}
            />
          ))}
        </div>
      </header>

      {/* ─── Content ─── */}
      <main className="px-4 pt-4">
        {loading && <MenuSkeleton />}
        {error && <ErrorState message={error} onRetry={fetchMenu} />}
        {!loading && !error && grouped.length === 0 && (
          <EmptyState
            icon={<Search className="h-12 w-12" />}
            title="No items found"
            description={search ? 'Try a different search term.' : 'The menu is empty.'}
          />
        )}

        {!loading && !error && grouped.map(group => (
          <section
            key={group.category}
            ref={el => { sectionRefs.current[group.category] = el; }}
            data-category={group.category}
            className="mb-8 scroll-mt-36"
          >
            <h2 className="font-heading font-bold text-xl text-ink mb-4">{group.label}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {group.items.map(item => (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  onAdd={el => handleAddItem(item, el)}
                  onOpen={el => handleOpenCustomizer(item, el)}
                />
              ))}
            </div>
          </section>
        ))}
      </main>

      {/* ─── Cart bar ─── */}
      <CartBar onOpen={() => setCartDrawerOpen(true)} />

      {/* ─── Cart drawer ─── */}
      <CartDrawer open={cartDrawerOpen} onClose={() => setCartDrawerOpen(false)} />

      {/* ─── Item customizer ─── */}
      {customizerItem && (
        <ItemCustomizer
          key={customizerItem.id}
          item={customizerItem}
          categoryItems={categoryItems}
          open={Boolean(customizerItem)}
          onClose={handleCloseCustomizer}
          onSelect={setCustomizerItem}
        />
      )}
    </div>
  );
}

// ─── Menu Item Card ───

function MenuItemCard({
  item,
  onAdd,
  onOpen,
}: {
  item: MenuItem;
  onAdd: (el?: HTMLElement) => void;
  onOpen: (el: HTMLElement) => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const soldOut = !item.available;

  return (
    <article
      ref={cardRef}
      tabIndex={0}
      aria-label={item.name}
      onClick={e => {
        if ((e.target as HTMLElement).closest('button')) return;
        if (cardRef.current) onOpen(cardRef.current);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          if ((e.target as HTMLElement).tagName !== 'BUTTON') {
            e.preventDefault();
            if (cardRef.current) onOpen(cardRef.current);
          }
        }
      }}
      className={`
        bg-surface rounded-[var(--radius-card)] shadow-[var(--shadow-sm)] overflow-hidden
        transition-all duration-150 hover:shadow-[var(--shadow-lg)] cursor-pointer
        focus:outline-none focus:ring-2 focus:ring-primary
        ${soldOut ? 'opacity-50' : ''}
      `}
    >
      <div className="relative">
        <FoodImage src={item.image} alt={item.name} className="rounded-none" />
        {soldOut && (
          <div className="absolute top-3 right-3">
            <Badge variant="danger">Sold out</Badge>
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-heading font-semibold text-base text-ink">{item.name}</h3>
        <p className="text-sm text-muted line-clamp-2 mt-1 min-h-[2.5rem]">{item.description}</p>
        <div className="flex items-center justify-between mt-3">
          <span className="text-base font-semibold text-ink tabular-nums">{formatPrice(item.price)}</span>
          <Button
            size="sm"
            variant={soldOut ? 'secondary' : 'primary'}
            disabled={soldOut}
            onClick={e => {
              e.stopPropagation();
              onAdd(cardRef.current || undefined);
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </article>
  );
}

// ─── Loading Skeleton ───

function MenuSkeleton() {
  return (
    <div className="space-y-8">
      {[1, 2].map(section => (
        <div key={section}>
          <Skeleton className="h-7 w-32 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-surface rounded-[var(--radius-card)] overflow-hidden">
                <Skeleton className="aspect-[4/3] rounded-none" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <div className="flex justify-between pt-2">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-9 w-16" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
