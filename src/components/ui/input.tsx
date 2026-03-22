import * as React from 'react';

import { cn } from '#/helpers/Styles/cn';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                'h-9 w-full min-w-0 rounded-sm border border-black/40 bg-surface-inset px-3 py-1 text-sm shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-text-disabled disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 text-text-primary',
                'focus-visible:border-border-focus focus-visible:ring-1 focus-visible:ring-border-focus/50',
                'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
                className
            )}
            {...props}
        />
    );
}

export { Input };
