import { type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

export interface LatchButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    variant?: 'cyan' | 'mint' | 'amber' | 'red' | 'neutral';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';
    ref?: React.Ref<HTMLButtonElement>;
}

/**
 * LatchButton
 * 
 * A tactile DAW toggle that physically "sinks" into the panel when active.
 * Uses strict Layer 1 elevation tokens and localized LED glows.
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
        cyan: 'text-accent-cyan shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] bg-bg-panelInset drop-shadow-[0_0_3px_var(--color-accent-cyan)] border-black',
        mint: 'text-accent-mint shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] bg-bg-panelInset drop-shadow-[0_0_3px_var(--color-accent-mint)] border-black',
        amber: 'text-accent-amber shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] bg-bg-panelInset drop-shadow-[0_0_3px_var(--color-accent-amber)] border-black',
        red: 'text-state-record shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] bg-bg-panelInset drop-shadow-[0_0_4px_var(--color-state-record)] border-black',
        neutral: 'text-text-primary shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] bg-bg-panelInset border-black'
    };

    const sizeStyles = {
        xs: 'h-5 px-1.5 text-[10px] rounded-micro',
        sm: 'h-6 px-2 text-[10px] rounded-sm',
        md: 'h-8 px-3 text-xs rounded-sm',
        lg: 'h-10 px-4 text-sm rounded-md',
        icon: 'size-6 flex items-center justify-center rounded-sm p-0',
        'icon-sm': 'size-5 flex items-center justify-center rounded-sm p-0'
    };

    return (
        <button
            ref={ref}
            type="button"
            data-active={active}
            className={cn(
                // Base structure & smooth DAW transitions
                'relative inline-flex items-center justify-center font-medium select-none overflow-hidden',
                'transition-all duration-fast easing-press',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
                'disabled:opacity-50 disabled:pointer-events-none',
                
                // Idle state — subtle raised button in recessed tray
                !active && 'bg-surface-panel text-text-secondary hover:text-text-primary border border-border-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.5)] hover:bg-surface-raised',
                
                // Active state styling applied via the variant map
                active && activeStyles[variant],

                // Hardware layout size
                sizeStyles[size],
                
                className
            )}
            {...props}
        >
            {/* 
              When active, we shift the entire content down by 1px 
              to sell the physical "push in" effect. 
            */}
            <span className="flex items-center gap-1.5">
                {children}
            </span>
        </button>
    );
}
