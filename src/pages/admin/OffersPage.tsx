import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getOffers,
  getMenu,
  createOffer,
  updateOffer,
  endOfferEarly,
  deleteOffer,
} from '../../lib/api';
import type { Offer, MenuItem, OfferStatus } from '../../lib/types';
import { getOfferStatus } from '../../lib/types';
import { formatPrice } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Dialog from '../../components/ui/Dialog';
import Input from '../../components/ui/Input';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import { useToast } from '../../components/ui/useToast';
import { Plus, Edit2, Trash2, StopCircle, Tag, Clock } from 'lucide-react';

function toLocalDatetimeInputString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function OffersPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);

  // Form fields
  const [formItemId, setFormItemId] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formStartsAt, setFormStartsAt] = useState('');
  const [formEndsAt, setFormEndsAt] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const initialLoadRef = useRef(true);

  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    if (!initialLoadRef.current) setLoading(true);
    setError(null);
    try {
      const [fetchedOffers, fetchedMenu] = await Promise.all([
        getOffers(),
        getMenu(true),
      ]);
      setOffers(fetchedOffers);
      setMenuItems(fetchedMenu);
    } catch {
      setError('Failed to fetch offers');
    } finally {
      setLoading(false);
      initialLoadRef.current = false;
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.all([getOffers(), getMenu(true)])
      .then(([fetchedOffers, fetchedMenu]) => {
        if (!ignore) {
          setOffers(fetchedOffers);
          setMenuItems(fetchedMenu);
          setError(null);
          setLoading(false);
          initialLoadRef.current = false;
        }
      })
      .catch(() => {
        if (!ignore) {
          setError('Failed to fetch offers');
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  function openCreateDialog() {
    setEditingOffer(null);
    const defaultItem = menuItems[0];
    setFormItemId(defaultItem ? defaultItem.id : '');
    setFormLabel('Weekend Special');
    if (defaultItem) {
      setFormPrice(String(Math.round((defaultItem.price * 0.8) / 100)));
    } else {
      setFormPrice('');
    }

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    setFormStartsAt(toLocalDatetimeInputString(now));
    setFormEndsAt(toLocalDatetimeInputString(tomorrow));
    setFormErrors({});
    setIsDialogOpen(true);
  }

  function openEditDialog(offer: Offer) {
    setEditingOffer(offer);
    setFormItemId(offer.menuItemId);
    setFormLabel(offer.label);
    setFormPrice(String(offer.offerPrice / 100));
    setFormStartsAt(toLocalDatetimeInputString(new Date(offer.startsAt)));
    setFormEndsAt(toLocalDatetimeInputString(new Date(offer.endsAt)));
    setFormErrors({});
    setIsDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!formItemId) errors.itemId = 'Please select a menu item';
    if (!formLabel.trim()) errors.label = 'Label is required';

    const rupees = parseFloat(formPrice);
    if (isNaN(rupees) || rupees <= 0) {
      errors.price = 'Please enter a valid price';
    }

    const selectedItem = menuItems.find(m => m.id === formItemId);
    const offerPaise = Math.round(rupees * 100);

    if (selectedItem && offerPaise >= selectedItem.price) {
      errors.price = `Offer price (₹${rupees}) must be strictly less than base price (₹${selectedItem.price / 100})`;
    }

    const startDate = new Date(formStartsAt);
    const endDate = new Date(formEndsAt);

    if (isNaN(startDate.getTime())) errors.startsAt = 'Invalid start datetime';
    if (isNaN(endDate.getTime())) errors.endsAt = 'Invalid end datetime';
    if (!errors.startsAt && !errors.endsAt && endDate <= startDate) {
      errors.endsAt = 'End datetime must be after start datetime';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    try {
      if (editingOffer) {
        const updated = await updateOffer(editingOffer.id, {
          menuItemId: formItemId,
          label: formLabel.trim(),
          offerPrice: offerPaise,
          startsAt: startDate.toISOString(),
          endsAt: endDate.toISOString(),
        });
        setOffers(prev => prev.map(o => (o.id === updated.id ? updated : o)));
        toast('Offer updated successfully', 'success');
      } else {
        const created = await createOffer({
          menuItemId: formItemId,
          label: formLabel.trim(),
          offerPrice: offerPaise,
          startsAt: startDate.toISOString(),
          endsAt: endDate.toISOString(),
          isActive: true,
        });
        setOffers(prev => [created, ...prev]);
        toast('Limited-time offer created', 'success');
      }
      setIsDialogOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save offer';
      toast(msg, 'error');
    }
  }

  async function handleEndEarly(offer: Offer) {
    try {
      const updated = await endOfferEarly(offer.id);
      setOffers(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      toast(`Ended offer "${offer.label}" early`, 'info');
    } catch {
      toast('Failed to end offer early', 'error');
    }
  }

  async function handleDelete(offer: Offer) {
    try {
      await deleteOffer(offer.id);
      setOffers(prev => prev.filter(o => o.id !== offer.id));
      toast(`Deleted offer "${offer.label}"`, 'info');
    } catch {
      toast('Failed to delete offer', 'error');
    }
  }

  function renderStatusBadge(status: OfferStatus) {
    if (status === 'active') {
      return <Badge variant="success">Active</Badge>;
    }
    if (status === 'scheduled') {
      return <Badge variant="primary">Scheduled</Badge>;
    }
    return <Badge variant="default">Expired</Badge>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-ink">Limited-Time Offers</h1>
          <p className="text-sm text-muted mt-0.5">
            Configure promotional deals, scheduled discounts & flash sales
          </p>
        </div>

        <Button
          size="md"
          variant="primary"
          onClick={openCreateDialog}
          icon={<Plus className="h-4 w-4" />}
        >
          Create Offer
        </Button>
      </div>

      {loading && <OffersSkeleton />}
      {error && <ErrorState message={error} onRetry={fetchData} />}

      {!loading && !error && offers.length === 0 && (
        <div className="bg-surface rounded-[var(--radius-card)] border border-border p-12 text-center">
          <Tag className="h-12 w-12 text-muted mx-auto mb-3 opacity-60" />
          <h2 className="text-base font-heading font-semibold text-ink">No offers active or scheduled</h2>
          <p className="text-sm text-muted mt-1 max-w-sm mx-auto">
            Create a limited-time deal to feature items in the customer app with discounted pricing and countdown timers.
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={openCreateDialog}
            className="mt-4"
            icon={<Plus className="h-4 w-4" />}
          >
            Create Offer
          </Button>
        </div>
      )}

      {!loading && !error && offers.length > 0 && (
        <div className="bg-surface rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-background/50 text-xs font-semibold text-muted uppercase tracking-wider">
                  <th className="py-3 px-4">Offer</th>
                  <th className="py-3 px-4">Menu Item</th>
                  <th className="py-3 px-4">Pricing</th>
                  <th className="py-3 px-4">Schedule</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {offers.map(offer => {
                  const status = getOfferStatus(offer);
                  const item = menuItems.find(m => m.id === offer.menuItemId);
                  const basePrice = item?.price ?? offer.menuItemBasePrice ?? 0;
                  const discountPaise = Math.max(0, basePrice - offer.offerPrice);
                  const discountPct = basePrice > 0 ? Math.round((discountPaise / basePrice) * 100) : 0;

                  return (
                    <tr
                      key={offer.id}
                      className={`hover:bg-background/40 transition-colors ${status === 'expired' ? 'opacity-70' : ''}`}
                    >
                      {/* Label */}
                      <td className="py-3.5 px-4 font-semibold text-ink whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Tag className="h-4 w-4 text-primary shrink-0" />
                          <span>{offer.label}</span>
                        </div>
                      </td>

                      {/* Item */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          {item?.image && (
                            <img
                              src={item.image}
                              alt={item.name}
                              className="h-9 w-9 rounded-md object-cover bg-background shrink-0 border border-border"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-ink truncate">{item?.name || offer.menuItemName || 'Item'}</p>
                            <p className="text-xs text-muted">Base: {formatPrice(basePrice)}</p>
                          </div>
                        </div>
                      </td>

                      {/* Pricing */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-baseline gap-2">
                          <span className="font-bold text-primary text-base tabular-nums">
                            {formatPrice(offer.offerPrice)}
                          </span>
                          <span className="text-xs text-muted line-through tabular-nums">
                            {formatPrice(basePrice)}
                          </span>
                          {discountPct > 0 && (
                            <span className="text-[11px] font-semibold text-success bg-success/10 px-1.5 py-0.5 rounded">
                              {discountPct}% off
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Schedule Window */}
                      <td className="py-3.5 px-4 text-xs text-muted whitespace-nowrap">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3 w-3 text-muted/80" />
                            <span>Ends: {new Date(offer.endsAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                          </div>
                          <p className="text-[11px] text-muted/70">
                            Starts: {new Date(offer.startsAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {renderStatusBadge(status)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {status === 'active' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEndEarly(offer)}
                              className="text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                              icon={<StopCircle className="h-3.5 w-3.5" />}
                              aria-label={`End early ${offer.label}`}
                            >
                              End early
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openEditDialog(offer)}
                            icon={<Edit2 className="h-3.5 w-3.5" />}
                            aria-label={`Edit ${offer.label}`}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(offer)}
                            className="text-danger hover:text-danger hover:bg-danger/10"
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            aria-label={`Delete ${offer.label}`}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Offer Dialog */}
      <Dialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title={editingOffer ? `Edit Offer: ${editingOffer.label}` : 'Create Limited-Time Offer'}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="offer-item-select" className="text-sm font-medium text-ink block mb-1.5">
              Select Menu Item *
            </label>
            <select
              id="offer-item-select"
              value={formItemId}
              onChange={e => {
                const nextId = e.target.value;
                setFormItemId(nextId);
                const found = menuItems.find(m => m.id === nextId);
                if (found && !editingOffer) {
                  setFormPrice(String(Math.round((found.price * 0.8) / 100)));
                }
              }}
              className="h-11 px-3 text-sm bg-surface text-ink border border-border rounded-[var(--radius-input)] w-full focus:outline-none focus:border-primary"
              required
            >
              {menuItems.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name} — base price {formatPrice(item.price)}
                </option>
              ))}
            </select>
            {formErrors.itemId && (
              <p className="text-xs text-danger mt-1">{formErrors.itemId}</p>
            )}
          </div>

          <Input
            label="Offer Label *"
            value={formLabel}
            onChange={e => setFormLabel(e.target.value)}
            placeholder="e.g. Weekend Deal, Flash 20% Off"
            error={formErrors.label}
            required
          />

          <Input
            label="Offer Price in ₹ *"
            type="number"
            step="1"
            value={formPrice}
            onChange={e => setFormPrice(e.target.value)}
            placeholder="e.g. 199"
            error={formErrors.price}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="offer-starts-at" className="text-sm font-medium text-ink block mb-1.5">
                Starts At *
              </label>
              <input
                id="offer-starts-at"
                type="datetime-local"
                value={formStartsAt}
                onChange={e => setFormStartsAt(e.target.value)}
                className="h-11 px-3 text-sm bg-surface text-ink border border-border rounded-[var(--radius-input)] w-full focus:outline-none focus:border-primary"
                required
              />
              {formErrors.startsAt && (
                <p className="text-xs text-danger mt-1">{formErrors.startsAt}</p>
              )}
            </div>

            <div>
              <label htmlFor="offer-ends-at" className="text-sm font-medium text-ink block mb-1.5">
                Ends At *
              </label>
              <input
                id="offer-ends-at"
                type="datetime-local"
                value={formEndsAt}
                onChange={e => setFormEndsAt(e.target.value)}
                className="h-11 px-3 text-sm bg-surface text-ink border border-border rounded-[var(--radius-input)] w-full focus:outline-none focus:border-primary"
                required
              />
              {formErrors.endsAt && (
                <p className="text-xs text-danger mt-1">{formErrors.endsAt}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button variant="ghost" type="button" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              {editingOffer ? 'Save Changes' : 'Create Offer'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function OffersSkeleton() {
  return (
    <div className="bg-surface rounded-[var(--radius-card)] border border-border p-4 space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-md" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}
