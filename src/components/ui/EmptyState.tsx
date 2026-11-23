import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-muted mb-4">{icon}</div>
      <h3 className="text-lg font-heading font-bold text-ink mb-1">{title}</h3>
      {description && <p className="text-sm text-muted mb-6 max-w-xs">{description}</p>}
      {action}
    </div>
  );
}
