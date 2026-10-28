import * as React from 'react';
import { cn } from '@/lib/utils';

const control =
  'h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-muted disabled:opacity-60 aria-[invalid=true]:border-critical';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, className)} {...props} />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(control, className)} {...props} />
));
Select.displayName = 'Select';
