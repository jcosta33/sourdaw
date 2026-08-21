import { type ComponentProps } from 'react';

import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '#/utils/Styles/cn';

const buttonVariants = cva(
    'inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-[color,background,border-color,box-shadow,transform,filter] duration-fast cursor-pointer outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-border-focus/70 focus-visible:ring-offset-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 select-none',
    {
        variants: {
            variant: {
                default:
                    'daw-panel-surface text-text-primary hover:brightness-[1.04] hover:saturate-[1.02] active:daw-inset-surface active:translate-y-px',
                destructive:
                    'border border-red-900/70 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.5)] hover:brightness-105 active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] [background:linear-gradient(180deg,rgba(196,80,64,0.92)_0%,rgba(152,72,72,0.92)_100%)]',
                outline:
                    'border border-border-soft border-t-[var(--color-light-edge)] bg-black/10 text-text-secondary hover:bg-surface-raised/70 hover:text-text-primary active:daw-inset-surface active:translate-y-px',
                secondary: 'daw-inset-surface text-white/92 hover:text-white',
                ghost: 'text-text-secondary hover:bg-surface-raised/75 hover:text-text-primary active:daw-inset-surface active:translate-y-px',
                link: 'text-accent-cyan underline-offset-4 hover:underline',

                // --- DAW Specific Custom Variants ---
                surface:
                    'daw-panel-surface text-text-primary hover:brightness-[1.03] active:daw-inset-surface active:translate-y-px',
                transport:
                    'text-text-primary border border-border-soft border-t-[var(--color-light-edge)] border-l-[rgba(255,255,255,0.04)] border-b-[rgba(0,0,0,0.3)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_2px_4px_rgba(0,0,0,0.5)] hover:text-accent-cyan hover:brightness-[1.05] active:translate-y-px active:text-accent-cyan active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(0,0,0,0.4)] [background:linear-gradient(180deg,#1d1d1d_0%,#111111_100%)] active:[background:linear-gradient(180deg,#111_0%,#181818_100%)]',
                danger: 'daw-panel-surface text-text-secondary hover:border-transparent hover:bg-state-danger hover:text-white active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] focus-visible:ring-state-danger/50',
                bare: '',
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
                bare: '',
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
}: ComponentProps<'button'> &
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
