import { useEffect, useState, useCallback, useRef } from 'react';
import { getMenu, toggleAvailability, updateMenuItem, addMenuItem } from '../../lib/api';
import type { MenuItem, MenuCategory } from '../../lib/types';
import { CATEGORIES, CATEGORY_LABELS } from '../../lib/types';
import { formatPrice } from '../../lib/utils';
import { IMAGES } from '../../lib/constants';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Chip from '../../components/ui/Chip';
import Switch from '../../components/ui/Switch';
import Dialog from '../../components/ui/Dialog';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import { useToast } from '../../components/ui/useToast';
import { Plus, Edit2, Check, X, Search } from 'lucide-react';

export default function MenuManagerPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Inline price edit
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceVal, setEditPriceVal] = useState<string>('');

  // Add / Edit Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formCategory, setFormCategory] = useState<MenuCategory>('burgers');
  const [formImage, setFormImage] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const initialLoadRef = useRef(true);

  const { toast } = useToast();

  const fetchMenuItems = useCallback(async () => {
    if (!initialLoadRef.current) setLoading(true);
    setError(null);
    try {
      const data = await getMenu();
      setItems(data);
    } catch {
      setError('Failed to fetch menu items');
    } finally {
      setLoading(false);
      initialLoadRef.current = false;
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    getMenu()
      .then(data => {
        if (!ignore) {
          setItems(data);
          setError(null);
        }
      })
      .catch(() => {
        if (!ignore) setError('Failed to fetch menu items');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  // Instant optimistic availability toggle
  async function handleToggleAvailability(item: MenuItem) {
    const nextVal = !item.available;
    // Optimistic update
    setItems(prev =>
      prev.map(i => (i.id === item.id ? { ...i, available: nextVal } : i))
    );

    try {
      await toggleAvailability(item.id);
      toast(`${item.name} is now ${nextVal ? 'available' : 'marked sold out'}`);
    } catch {
      // Revert on error
      setItems(prev =>
        prev.map(i => (i.id === item.id ? { ...i, available: item.available } : i))
      );
      toast('Failed to update availability', 'error');
    }
  }

  // Inline Price Editing
  function startPriceEdit(item: MenuItem) {
    setEditingPriceId(item.id);
    setEditPriceVal(String(item.price / 100)); // Rupees
  }

  async function savePriceEdit(item: MenuItem) {
    const rupees = parseFloat(editPriceVal);
    if (isNaN(rupees) || rupees <= 0) {
      toast('Invalid price', 'error');
      setEditingPriceId(null);
      return;
    }
    const paise = Math.round(rupees * 100);

    // Optimistic update
    setItems(prev =>
      prev.map(i => (i.id === item.id ? { ...i, price: paise } : i))
    );
    setEditingPriceId(null);

    try {
      await updateMenuItem(item.id, { price: paise });
      toast(`Updated price for ${item.name} to ₹${rupees}`, 'success');
    } catch {
      toast('Failed to update price', 'error');
      fetchMenuItems();
    }
  }

  // Open Dialog for Adding or Editing
  function openAddDialog() {
    setEditingItem(null);
    setFormName('');
    setFormDesc('');
    setFormPrice('');
    setFormCategory('burgers');
    setFormImage(IMAGES.classicSmash);
    setFormErrors({});
    setIsDialogOpen(true);
  }

  function openEditDialog(item: MenuItem) {
    setEditingItem(item);
    setFormName(item.name);
    setFormDesc(item.description);
    setFormPrice(String(item.price / 100));
    setFormCategory(item.category);
    setFormImage(item.image);
    setFormErrors({});
    setIsDialogOpen(true);
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!formName.trim()) errors.name = 'Name is required';
    if (!formDesc.trim()) errors.description = 'Description is required';
    const rupees = parseFloat(formPrice);
    if (isNaN(rupees) || rupees <= 0) errors.price = 'Enter a valid price in ₹';

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const paise = Math.round(rupees * 100);

    try {
      if (editingItem) {
        const updated = await updateMenuItem(editingItem.id, {
          name: formName.trim(),
          description: formDesc.trim(),
          price: paise,
          image: formImage || editingItem.image,
        });
        setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)));
        toast('Item updated successfully', 'success');
      } else {
        const created = await addMenuItem({
          name: formName.trim(),
          description: formDesc.trim(),
          price: paise,
          image: formImage || IMAGES.classicSmash,
          category: formCategory,
          available: true,
          optionGroups: [],
        });
        setItems(prev => [...prev, created]);
        toast('New item added to menu', 'success');
      }
      setIsDialogOpen(false);
    } catch {
      toast('Failed to save item', 'error');
    }
  }

  // Filtered Items
  const filteredItems = items.filter(item => {
    const matchesCat = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-ink">Menu Manager</h1>
          <p className="text-sm text-muted mt-0.5">Control pricing, availability & menu items</p>
        </div>

        <Button
          size="md"
          variant="primary"
          onClick={openAddDialog}
          icon={<Plus className="h-4 w-4" />}
        >
          Add New Item
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between bg-surface p-4 rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-sm)]">
        {/* Category Chips */}
        <div className="flex gap-2 overflow-x-auto scroll-hide">
          <Chip
            label="All Items"
            active={selectedCategory === 'all'}
            onClick={() => setSelectedCategory('all')}
          />
          {CATEGORIES.map(cat => (
            <Chip
              key={cat}
              label={CATEGORY_LABELS[cat]}
              active={selectedCategory === cat}
              onClick={() => setSelectedCategory(cat)}
            />
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            type="search"
            placeholder="Search items…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-3 text-sm bg-background border border-border rounded-[var(--radius-input)] text-ink placeholder:text-muted focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Items List / Table */}
      {loading && <MenuManagerSkeleton />}
      {error && <ErrorState message={error} onRetry={fetchMenuItems} />}

      {!loading && !error && (
        <div className="bg-surface rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-background/50 text-xs font-semibold text-muted uppercase tracking-wider">
                  <th className="py-3 px-4">Item</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Price (Click to edit)</th>
                  <th className="py-3 px-4">Available</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {filteredItems.map(item => (
                  <tr
                    key={item.id}
                    className={`hover:bg-background/40 transition-colors ${!item.available ? 'bg-background/20 opacity-80' : ''}`}
                  >
                    {/* Item Thumb & Info */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="h-12 w-12 rounded-[var(--radius-input)] object-cover bg-background shrink-0 border border-border"
                          loading="lazy"
                        />
                        <div className="min-w-0 max-w-xs sm:max-w-md">
                          <p className="font-heading font-semibold text-ink truncate">{item.name}</p>
                          <p className="text-xs text-muted truncate mt-0.5">{item.description}</p>
                        </div>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <Badge variant="default">{CATEGORY_LABELS[item.category]}</Badge>
                    </td>

                    {/* Price with Inline Edit */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {editingPriceId === item.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-ink">₹</span>
                          <input
                            type="number"
                            value={editPriceVal}
                            onChange={e => setEditPriceVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') savePriceEdit(item);
                              if (e.key === 'Escape') setEditingPriceId(null);
                            }}
                            className="w-20 h-8 px-2 text-sm font-semibold bg-surface border border-primary rounded-[var(--radius-input)] text-ink focus:outline-none"
                            autoFocus
                          />
                          <button
                            onClick={() => savePriceEdit(item)}
                            className="h-8 w-8 rounded-[var(--radius-input)] bg-success text-white flex items-center justify-center hover:bg-emerald-600 cursor-pointer"
                            aria-label="Save price"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingPriceId(null)}
                            className="h-8 w-8 rounded-[var(--radius-input)] bg-border text-ink flex items-center justify-center hover:bg-muted/20 cursor-pointer"
                            aria-label="Cancel edit"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startPriceEdit(item)}
                          className="group flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-input)] hover:bg-background border border-transparent hover:border-border transition-colors cursor-pointer text-left"
                          title="Click to edit price"
                        >
                          <span className="font-semibold text-ink tabular-nums">
                            {formatPrice(item.price)}
                          </span>
                          <Edit2 className="h-3 w-3 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      )}
                    </td>

                    {/* Availability Switch */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={item.available}
                          onChange={() => handleToggleAvailability(item)}
                        />
                        <span className={`text-xs font-semibold ${item.available ? 'text-success' : 'text-danger'}`}>
                          {item.available ? 'In Stock' : 'Sold Out'}
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openEditDialog(item)}
                        icon={<Edit2 className="h-3.5 w-3.5" />}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Item Dialog */}
      <Dialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title={editingItem ? `Edit ${editingItem.name}` : 'Add Menu Item'}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleFormSubmit} className="space-y-4">
          <Input
            label="Item Name *"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            error={formErrors.name}
            placeholder="e.g. Smoky Double Bacon Burger"
            required
          />

          <Textarea
            label="Description *"
            value={formDesc}
            onChange={e => setFormDesc(e.target.value)}
            error={formErrors.description}
            placeholder="Describe ingredients, cooking style, flavours..."
            rows={2}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Price in ₹ *"
              type="number"
              step="1"
              value={formPrice}
              onChange={e => setFormPrice(e.target.value)}
              error={formErrors.price}
              placeholder="e.g. 299"
              required
            />

            <div>
              <label htmlFor="item-category-select" className="text-sm font-medium text-ink block mb-1.5">
                Category
              </label>
              <select
                id="item-category-select"
                value={formCategory}
                onChange={e => setFormCategory(e.target.value as MenuCategory)}
                className="h-11 px-3 text-sm bg-surface text-ink border border-border rounded-[var(--radius-input)] w-full focus:border-primary focus:outline-none"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Input
            label="Image URL"
            value={formImage}
            onChange={e => setFormImage(e.target.value)}
            placeholder="https://images.unsplash.com/..."
          />

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button variant="ghost" type="button" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              {editingItem ? 'Save Changes' : 'Create Item'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function MenuManagerSkeleton() {
  return (
    <div className="bg-surface rounded-[var(--radius-card)] border border-border p-4 space-y-4">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-[var(--radius-input)]" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}
