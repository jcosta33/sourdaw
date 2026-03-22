import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '#/helpers/Styles/cn';

const buttonVariants = cva(
    'inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-all duration-fast cursor-pointer outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 select-none',
    {
        variants: {
            variant: {
                default:
                    'bg-surface-panel text-text-primary border border-border-soft border-t-[var(--color-light-edge)] border-b-[var(--color-shadow-edge)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.5)] hover:bg-surface-raised active:bg-surface-inset active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] active:border-black active:translate-y-px',
                destructive:
                    'bg-state-danger text-white border border-red-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.5)] hover:brightness-110 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] active:border-black active:translate-y-px',
                outline:
                    'border border-border-soft border-t-[var(--color-light-edge)] bg-transparent hover:bg-surface-raised active:bg-surface-inset active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] active:translate-y-px',
                secondary:
                    'bg-surface-inset text-white border border-black shadow-[inset_0_2px_4px_rgba(0,0,0,0.6),0_1px_0_rgba(255,255,255,0.03)]',
                ghost: 'hover:bg-surface-raised hover:text-text-primary text-text-secondary active:bg-surface-inset active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] active:translate-y-px',
                link: 'text-accent-cyan underline-offset-4 hover:underline',

                // --- DAW Specific Custom Variants ---
                surface:
                    'bg-surface-panel text-text-primary border border-border-soft border-t-[var(--color-light-edge)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.5)] hover:bg-surface-raised active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] active:border-black active:translate-y-px',
                transport:
                    'bg-surface-panel text-text-primary border border-border-soft border-t-[var(--color-light-edge)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.5)] hover:bg-surface-raised hover:text-accent-cyan active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] active:text-accent-cyan active:border-black active:translate-y-px',
                danger: 'bg-surface-panel text-text-secondary border border-border-soft border-t-[var(--color-light-edge)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.5)] hover:bg-state-danger hover:text-white hover:border-transparent active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] focus-visible:ring-state-danger/50 active:translate-y-px',
            },
            size: {
                default: 'h-8 px-3 text-xs rounded-sm',
                xs: "h-5 gap-1 rounded-micro px-2 text-[10px] [&_svg:not([class*='size-'])]:size-3",
                sm: 'h-6 gap-1.5 rounded-sm px-2 text-[11px]',
                lg: 'h-10 rounded-md px-6 text-sm',
                icon: 'size-8 rounded-sm',
                'icon-xs':
                    "size-5 flex items-center justify-center rounded-micro p-0 [&_svg:not([class*='size-'])]:size-3",
                'icon-sm': 'size-6 flex items-center justify-center rounded-sm p-0',
                'icon-lg': 'size-10 flex items-center justify-center rounded-md p-0',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    }
);

function Button({
    className,
    variant = 'default',
    size = 'default',
    asChild = false,
    ...props
}: React.ComponentProps<'button'> &
    VariantProps<typeof buttonVariants> & {
        asChild?: boolean;
    }) {
    const Comp = asChild ? Slot.Root : 'button';

    return (
        <Comp
            data-slot="button"
            data-variant={variant}
            data-size={size}
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    );
}

export { Button, buttonVariants };
