import { type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

export interface LEDProps {
    on: boolean;
    variant?: 'cyan' | 'mint' | 'amber' | 'red';
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const activeGlows = {
    cyan: 'bg-accent-cyan shadow-[0_0_6px_var(--color-accent-cyan)]',
    mint: 'bg-accent-mint shadow-[0_0_6px_var(--color-accent-mint)]',
    amber: 'bg-accent-amber shadow-[0_0_6px_var(--color-accent-amber)]',
    red: 'bg-state-record shadow-[0_0_6px_var(--color-state-record)]',
};

const sizeStyles = {
    sm: 'size-1.5',
    md: 'size-2',
    lg: 'size-3',
};

/**
 * LED indicator primitive.
 * Used for status lights (record armed, solo, sync).
 */
export const LED = ({ on, variant = 'amber', size = 'md', className }: LEDProps): ReactElement => {
    return (
        <div
            className={cn(
                'rounded-micro transition-colors duration-fast shadow-elevation-inset border border-[rgba(0,0,0,0.5)]',
                sizeStyles[size],
                on ? activeGlows[variant] : 'bg-[#1A1A1A]',
                className
            )}
            aria-hidden="true"
        />
    );
};
