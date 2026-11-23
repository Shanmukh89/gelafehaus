import { forwardRef, type TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  charCount?: number;
  maxChars?: number;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, charCount, maxChars, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={`
            px-3 py-2.5 text-sm bg-surface text-ink placeholder:text-muted
            border rounded-[var(--radius-input)]
            transition-colors duration-150 resize-none
            hover:border-ink/30 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border'}
            ${className}
          `}
          {...props}
        />
        <div className="flex justify-between">
          {error && <p className="text-xs text-danger">{error}</p>}
          {maxChars !== undefined && (
            <p className={`text-xs ml-auto ${(charCount || 0) > maxChars ? 'text-danger' : 'text-muted'}`}>
              {charCount || 0}/{maxChars}
            </p>
          )}
        </div>
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
export default Textarea;
