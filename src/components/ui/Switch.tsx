interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export default function Switch({ checked, onChange, label, disabled, id }: SwitchProps) {
  const switchId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <label htmlFor={switchId} className="inline-flex items-center gap-2 cursor-pointer select-none">
      <button
        id={switchId}
        role="switch"
        type="button"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`
          relative inline-flex h-6 w-11 shrink-0 items-center rounded-full
          transition-colors duration-200 ease-out cursor-pointer
          disabled:opacity-50 disabled:cursor-not-allowed
          ${checked ? 'bg-primary' : 'bg-border'}
        `}
      >
        <span
          className={`
            inline-block h-5 w-5 rounded-full bg-white shadow-sm
            transition-transform duration-200 ease-out
            ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}
          `}
        />
      </button>
      {label && <span className="text-sm text-ink">{label}</span>}
    </label>
  );
}
