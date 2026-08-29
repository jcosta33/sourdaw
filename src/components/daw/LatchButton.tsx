import { type ReactElement, type ButtonHTMLAttributes, type Ref } from 'react';

import { cn } from '#/utils/Styles/cn';

type LatchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    variant?: 'cyan' | 'mint' | 'amber' | 'red' | 'neutral';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';
    ref?: Ref<HTMLButtonElement>;
};

/**
 * LatchButton
 *
 * A tactile DAW toggle that physically "sinks" into the panel when active.
 * Uses inverted shadows + reversed gradient + translateY(1px) for realism.
 * Built for React 19 (no forwardRef).
 */
export function LatchButton({
    active = false,
    variant = 'neutral',
    size = 'md',
    className,
    children,
    ref,
    ...props
}: LatchButtonProps): ReactElement {
    // Variant mapping for the active localized glow and text color
    const activeStyles = {
        cyan: 'text-accent-cyan drop-shadow-[0_0_4px_var(--color-accent-cyan)]',
        mint: 'text-accent-mint drop-shadow-[0_0_4px_var(--color-accent-mint)]',
        amber: 'text-state-solo drop-shadow-[0_0_4px_var(--color-state-solo)]',
        red: 'text-state-record drop-shadow-[0_0_5px_var(--color-state-record)]',
        neutral: 'text-text-primary',
    };

    // Active colored glow box-shadows per variant (adds halo around the button itself)
    const activeGlowShadow: Record<string, string> = {
        cyan: ', 0 0 8px rgba(127,184,196,0.3)',
        mint: ', 0 0 8px rgba(125,184,160,0.3)',
        amber: ', 0 0 8px rgba(247,167,56,0.3)',
        red: ', 0 0 8px rgba(255,64,50,0.35)',
        neutral: '',
    };

    const sizeStyles = {
        xs: 'h-5 px-1.5 text-[10px] rounded-micro',
        sm: 'h-6 px-2 text-[10px] rounded-sm',
        md: 'h-8 px-3 text-xs rounded-sm',
        lg: 'h-10 px-4 text-sm rounded-md',
        icon: 'size-6 flex items-center justify-center rounded-sm p-0',
        'icon-sm': 'size-5 flex items-center justify-center rounded-sm p-0',
    };

    return (
        <button
            ref={ref}
            type="button"
            data-active={active}
            className={cn(
                // Base structure & smooth DAW transitions
                'relative inline-flex items-center justify-center font-medium select-none overflow-hidden cursor-pointer',
                'transition-[color,background,border-color,box-shadow,transform,filter] duration-fast easing-press',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
                'disabled:opacity-50 disabled:pointer-events-none',

                // Hardware layout size
                sizeStyles[size],

                className
            )}
            style={
                active
                    ? {
                          // Reversed gradient + deep inset — sinks INTO the panel
                          background:
                              'linear-gradient(180deg, var(--surface-default) 0%, color-mix(in srgb, var(--surface-default) 35%, var(--surface-raised)) 50%, var(--surface-raised) 100%)',
                          boxShadow: `inset 0 2px 4px rgba(0,0,0,0.6), inset 0 1px 1px rgba(0,0,0,0.4)${
                              activeGlowShadow[variant]
                          }`,
                          border: '1px solid rgba(0,0,0,0.6)',
                          borderTopColor: 'rgba(0,0,0,0.8)',
                          borderBottomColor: 'rgba(255,249,242,0.03)',
                          transform: 'translateY(1px)',
                      }
                    : {
                          // Raised with NW light model, darkened slightly
                          background:
                              'linear-gradient(180deg, var(--surface-raised) 0%, color-mix(in srgb, var(--surface-raised) 55%, var(--surface-default)) 42%, var(--surface-default) 100%)',
                          boxShadow:
                              '0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,249,242,0.08), inset 0 -1px 0 rgba(0,0,0,0.24)',
                          border: '1px solid var(--color-border-soft)',
                          borderTopColor: 'var(--color-light-edge)',
                          borderLeftColor: 'rgba(255,249,242,0.04)',
                          borderBottomColor: 'rgba(0,0,0,0.3)',
                      }
            }
            {...props}
        >
            <span
                className={cn(
                    'flex items-center gap-1.5',
                    active ? activeStyles[variant] : 'text-text-secondary hover:text-text-primary'
                )}
            >
                {children}
            </span>
        </button>
    );
}
