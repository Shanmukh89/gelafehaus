import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowRight, QrCode, AlertCircle, Loader2 } from 'lucide-react';
import { validateTable } from '../../lib/api';
import { useCartStore } from '../../lib/cart-store';
import { padTableNumber } from '../../lib/utils';
import Button from '../../components/ui/Button';
import OfflineBanner from '../../components/ui/OfflineBanner';

export default function WelcomePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setTable = useCartStore(s => s.setTable);

  const rawTableParam = searchParams.get('table');
  const [isValidating, setIsValidating] = useState(Boolean(rawTableParam));
  const [validatedTable, setValidatedTable] = useState<string | null>(null);
  const [isInvalidTable, setIsInvalidTable] = useState(false);
  const [showTestQr, setShowTestQr] = useState(false);

  useEffect(() => {
    if (!rawTableParam) {
      Promise.resolve().then(() => {
        setIsValidating(false);
        setValidatedTable(null);
        setIsInvalidTable(false);
      });
      return;
    }

    let isMounted = true;
    async function checkTable(table: string) {
      try {
        const result = await validateTable(table);
        if (!isMounted) return;
        if (result.valid) {
          setValidatedTable(result.tableNumber);
          setIsInvalidTable(false);
        } else {
          setValidatedTable(null);
          setIsInvalidTable(true);
        }
      } catch {
        if (!isMounted) return;
        setValidatedTable(null);
        setIsInvalidTable(true);
      } finally {
        if (isMounted) setIsValidating(false);
      }
    }

    checkTable(rawTableParam);
    return () => {
      isMounted = false;
    };
  }, [rawTableParam]);

  function handleBrowseMenu() {
    if (!validatedTable) return;
    setTable(validatedTable);
    navigate('/menu');
  }

  // ─── 1. Validating State ───
  if (isValidating) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 max-w-md mx-auto">
        <OfflineBanner />
        <Loader2 className="h-8 w-8 text-primary animate-spin mb-4" />
        <p className="text-sm font-medium text-muted">Checking table code…</p>
      </div>
    );
  }

  // ─── 2. Invalid or Inactive Table State ───
  if (isInvalidTable) {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-between p-6 max-w-md mx-auto">
        <OfflineBanner />
        <div /> {/* Spacer for vertical centering */}
        <div className="text-center flex flex-col items-center welcome-entrance">
          <h1 className="font-heading font-bold text-4xl sm:text-5xl text-ink tracking-tight mb-8">
            Gelafehaus
          </h1>
          <div className="h-16 w-16 rounded-full bg-danger/10 text-danger flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h2 className="font-heading font-semibold text-lg text-ink mb-2">
            Invalid Table Code
          </h2>
          <p className="text-muted text-sm max-w-xs leading-relaxed">
            This table code isn't valid. Please ask staff for help.
          </p>
        </div>
        <div className="pb-4" /> {/* No Browse button */}
      </div>
    );
  }

  // ─── 3. No Table Scanned State (Opened / directly or redirected from /menu with no table) ───
  if (!rawTableParam || !validatedTable) {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-between p-6 max-w-md mx-auto">
        <OfflineBanner />
        <div /> {/* Spacer for vertical centering */}
        <div className="text-center flex flex-col items-center welcome-entrance">
          <h1 className="font-heading font-bold text-4xl sm:text-5xl text-ink tracking-tight mb-8">
            Gelafehaus
          </h1>
          <div className="h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
            <QrCode className="h-8 w-8" />
          </div>
          <h2 className="font-heading font-semibold text-lg text-ink mb-2">
            Please scan your table's QR code
          </h2>
          <p className="text-muted text-sm max-w-xs leading-relaxed">
            Point your phone's camera at the QR code stand on your table to browse our menu and start ordering.
          </p>

          {/* Testing / Demo quick selector: only active on localhost / dev builds */}
          {(import.meta.env.DEV || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))) && (
            <div className="mt-6 pt-5 border-t border-border/80 w-full max-w-xs text-center">
              <button
                onClick={() => setShowTestQr(!showTestQr)}
                className="text-xs font-semibold text-primary hover:underline flex items-center justify-center gap-1 mx-auto mb-3"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span>{showTestQr ? 'Hide phone test QR' : 'Show phone test QR code'}</span>
              </button>

              {showTestQr && (
                <div className="mb-4 p-3 bg-surface rounded-xl border border-border text-center">
                  <p className="text-xs text-muted mb-2">Scan with your phone camera:</p>
                  <img
                    src="/qr/local/table-01.png"
                    alt="Table 01 Wi-Fi QR"
                    className="w-44 h-44 mx-auto rounded-lg border border-border shadow-sm p-1.5 bg-white"
                  />
                  <p className="text-[11px] text-muted mt-2 font-mono">http://192.168.137.121:5173/?table=01</p>
                  <p className="text-[11px] text-muted/80 mt-0.5">(Ensure phone is connected to same Wi-Fi)</p>
                </div>
              )}

              <p className="text-xs font-semibold text-muted tracking-wider uppercase mb-2">
                Or click to test directly
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {['01', '02', '05', '07', '12'].map(tbl => (
                  <button
                    key={tbl}
                    onClick={() => navigate(`/?table=${tbl}`)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full bg-surface border border-border text-ink hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors cursor-pointer shadow-[var(--shadow-sm)]"
                  >
                    Table {tbl}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="pb-4" /> {/* No Browse button */}
      </div>
    );
  }

  // ─── 4. Valid Table Welcome Layout ───
  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-6 max-w-md mx-auto">
      <OfflineBanner />

      <div className="w-full text-center flex flex-col items-center welcome-entrance">
        {/* Large "Gelafehaus" wordmark */}
        <h1 className="font-heading font-bold text-4xl sm:text-5xl text-ink tracking-tight">
          Gelafehaus
        </h1>

        {/* Scanned Table Pill */}
        <div className="mt-4">
          <span className="inline-flex items-center px-4 py-1.5 text-sm font-semibold bg-surface border border-border rounded-[var(--radius-chip)] text-ink tabular-nums shadow-[var(--shadow-sm)]">
            Table {padTableNumber(validatedTable)}
          </span>
        </div>

        {/* Short tagline */}
        <p className="mt-3 text-muted text-base sm:text-lg font-medium">
          Fresh burgers, made to order.
        </p>

        {/* Primary full-width button directly under in the same vertically centered group */}
        <div className="w-full pt-6">
          <Button
            variant="primary"
            size="lg"
            className="w-full min-h-[52px] text-base font-semibold shadow-[var(--shadow-sm)] flex items-center justify-center gap-2 cursor-pointer"
            onClick={handleBrowseMenu}
          >
            <span>Browse Menu</span>
            <ArrowRight className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
