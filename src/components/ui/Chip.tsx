interface ChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export default function Chip({ label, active = false, onClick }: ChipProps) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center px-4 h-9 text-sm font-medium
        rounded-[var(--radius-chip)] whitespace-nowrap transition-colors duration-150
        select-none cursor-pointer shrink-0
        ${active
          ? 'bg-primary text-white'
          : 'bg-surface text-muted border border-border hover:text-ink hover:border-ink/20'
        }
      `}
    >
      {label}
    </button>
  );
}
