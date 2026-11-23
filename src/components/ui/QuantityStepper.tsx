import { Minus, Plus } from 'lucide-react';

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export default function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 20,
  disabled = false,
}: QuantityStepperProps) {
  return (
    <div className={`inline-flex items-center gap-0 border border-border rounded-[var(--radius-input)] overflow-hidden bg-surface ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
        className="h-11 w-11 flex items-center justify-center text-ink hover:bg-background transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="h-11 w-11 flex items-center justify-center text-sm font-semibold tabular-nums select-none border-x border-border">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
        className="h-11 w-11 flex items-center justify-center text-ink hover:bg-background transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
