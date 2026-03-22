import { type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

interface LatchButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    variant?: 'cyan' | 'mint' | 'amber' | 'red' | 'neutral';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';
    ref?: React.Ref<HTMLButtonElement>;
}

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
        cyan: 'text-accent-cyan drop-shadow-[0_0_3px_var(--color-accent-cyan)]',
        mint: 'text-accent-mint drop-shadow-[0_0_3px_var(--color-accent-mint)]',
        amber: 'text-state-solo drop-shadow-[0_0_3px_var(--color-state-solo)]',
        red: 'text-state-record drop-shadow-[0_0_4px_var(--color-state-record)]',
        neutral: 'text-text-primary',
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
                'transition-all duration-fast easing-press',
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
                          background: 'linear-gradient(180deg, #111 0%, #1a1a1a 100%)',
                          boxShadow:
                              'inset 0 2px 4px rgba(0,0,0,0.6), inset 0 1px 1px rgba(0,0,0,0.4)',
                          border: '1px solid rgba(0,0,0,0.6)',
                          borderTopColor: 'rgba(0,0,0,0.8)',
                          transform: 'translateY(1px)',
                      }
                    : {
                          // Raised with top-light model
                          background: 'linear-gradient(180deg, #2a2a2a 0%, #1e1e1e 100%)',
                          boxShadow:
                              '0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
                          border: '1px solid var(--color-border-soft)',
                          borderTopColor: 'var(--color-light-edge)',
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
