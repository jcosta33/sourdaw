import { type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

type LEDVariant = 'cyan' | 'mint' | 'amber' | 'red';

interface LEDProps {
    on: boolean;
    variant?: LEDVariant;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

/** Tinted dark off-state colors for each LED variant */
const offBackground: Record<LEDVariant, string> = {
    cyan: 'var(--color-led-off-cyan)',
    mint: 'var(--color-led-off-green)',
    amber: 'var(--color-led-off-amber)',
    red: 'var(--color-led-off-red)',
};

/** Active glow — multi-layered box-shadow for realistic LED halo */
const activeGlow: Record<LEDVariant, { bg: string; shadow: string }> = {
    cyan: {
        bg: 'var(--color-accent-cyan)',
        shadow: '0 0 4px var(--color-accent-cyan), 0 0 12px rgba(127,184,196,0.4), 0 0 24px rgba(127,184,196,0.15)',
    },
    mint: {
        bg: 'var(--color-accent-mint)',
        shadow: '0 0 4px var(--color-accent-mint), 0 0 12px rgba(125,184,160,0.4), 0 0 24px rgba(125,184,160,0.15)',
    },
    amber: {
        bg: 'var(--color-state-solo)',
        shadow: '0 0 4px var(--color-state-solo), 0 0 12px rgba(196,152,64,0.4), 0 0 24px rgba(196,152,64,0.15)',
    },
    red: {
        bg: 'var(--color-state-record)',
        shadow: '0 0 4px var(--color-state-record), 0 0 12px rgba(196,80,64,0.4), 0 0 24px rgba(196,80,64,0.15)',
    },
};

const sizeStyles = {
    sm: 'size-1.5',
    md: 'size-2',
    lg: 'size-3',
};

/**
 * LED indicator primitive with multi-layered glow.
 * Off state uses tinted dark color (not flat gray) for realism.
 */
export const LED = ({ on, variant = 'amber', size = 'md', className }: LEDProps): ReactElement => {
    const active = activeGlow[variant];
    return (
        <div
            className={cn('rounded-full transition-all duration-fast', sizeStyles[size], className)}
            style={{
                background: on ? active.bg : offBackground[variant],
                boxShadow: on
                    ? active.shadow
                    : 'inset 0 1px 2px rgba(0,0,0,0.6)',
                border: '1px solid rgba(0,0,0,0.5)',
            }}
            aria-hidden="true"
        />
    );
};
