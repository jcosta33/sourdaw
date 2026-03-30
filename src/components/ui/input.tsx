import { type ComponentProps } from 'react';

import { cn } from '#/helpers/Styles/cn';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                'h-9 w-full min-w-0 rounded-sm px-3 py-1 text-sm transition-[color,box-shadow,border-color] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-text-disabled disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 text-text-primary',
                'focus-visible:border-border-focus focus-visible:ring-1 focus-visible:ring-border-focus/50',
                'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
                className
            )}
            style={{
                background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.7), inset 0 0 1px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.04)',
                border: '1px solid rgba(0,0,0,0.5)',
                borderTopColor: 'rgba(0,0,0,0.7)',
                borderBottomColor: 'rgba(40,40,40,0.35)',
            }}
            {...props}
        />
    );
}

export { Input };
