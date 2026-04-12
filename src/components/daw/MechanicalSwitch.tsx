import { type ReactElement } from 'react';
import { cn } from '#/utils/Styles/cn';

type MechanicalSwitchProps = {
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
    label?: string;
    size?: 'sm' | 'md' | 'lg';
};

/**
 * MechanicalSwitch
 *
 * A tactile rocker switch component for binary states.
 * Uses strict Layer 1 elevation tokens and gradient trickery to simulate
 * a physical switch pivoting on an axis.
 */
export function MechanicalSwitch({
    checked,
    onChange,
    className,
    label,
    size = 'md',
}: MechanicalSwitchProps): ReactElement {
    const sizeConfig = {
        sm: 'w-4 h-7',
        md: 'w-6 h-10',
        lg: 'w-8 h-12',
    };

    return (
        <div className={cn('flex flex-col items-center gap-1.5', className)}>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={cn(
                    'relative overflow-hidden rounded-[3px] border border-white/5 bg-black shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]',
                    'focus:outline-none focus-visible:ring-1 focus-visible:ring-border-focus transition-all duration-75 group',
                    sizeConfig[size]
                )}
            >
                <div
                    className={cn(
                        'absolute inset-[1px] rounded-[2px] transition-all duration-100 ease-in-out',
                        'border border-black/50 bg-gradient-to-b from-surface-raised to-surface-base',
                        checked
                            ? 'translate-y-[-1px] shadow-[inset_0_4px_4px_rgba(0,0,0,0.8),inset_0_-1px_1px_rgba(255,255,255,0.1)]'
                            : 'translate-y-[1px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),inset_0_-4px_4px_rgba(0,0,0,0.8)]'
                    )}
                >
                    <div className="absolute top-1.5 w-full flex flex-col items-center gap-[2px] opacity-20">
                        <div className="w-[40%] h-[1px] bg-white rounded-full" />
                        <div className="w-[40%] h-[1px] bg-white rounded-full" />
                    </div>
                    <div className="absolute bottom-1.5 w-full flex flex-col items-center gap-[2px] opacity-20">
                        <div className="w-[40%] h-[1px] bg-white rounded-full" />
                        <div className="w-[40%] h-[1px] bg-white rounded-full" />
                    </div>

                    <div
                        className={cn(
                            'absolute top-[3px] left-1/2 -translate-x-1/2 w-1.5 h-0.5 rounded-full transition-colors duration-200',
                            checked ? 'bg-state-danger drop-shadow-[0_0_2px_var(--color-state-danger)]' : 'bg-black/50'
                        )}
                    />
                </div>
            </button>
            {label ? (
                <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-text-secondary">{label}</span>
            ) : null}
        </div>
    );
}
