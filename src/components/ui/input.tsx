import { type ComponentProps } from 'react';

import { cn } from '#/utils/Styles/cn';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                'daw-inset-surface h-8 w-full min-w-0 rounded-sm px-3 py-1 text-sm text-text-primary transition-[color,box-shadow,border-color,filter] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-text-disabled/90 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
                'focus-visible:border-border-focus/70 focus-visible:ring-1 focus-visible:ring-border-focus/60 focus-visible:brightness-[1.03]',
                'aria-invalid:border-destructive/70 aria-invalid:ring-1 aria-invalid:ring-destructive/20',
                className
            )}
            {...props}
        />
    );
}

export { Input };
