import { type ReactElement, type ReactNode } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawPluginChoiceRowProps = {
    title: ReactNode;
    subtitle?: ReactNode;
    detail?: ReactNode;
    startSlot?: ReactNode;
    endSlot?: ReactNode;
    active?: boolean;
    onPress?: () => void;
    className?: string;
    role?: string;
    'aria-selected'?: boolean;
    'aria-label'?: string;
};

export const DawPluginChoiceRow = ({
    title,
    subtitle,
    detail,
    startSlot,
    endSlot,
    active = false,
    onPress,
    className,
    role,
    'aria-selected': ariaSelected,
    'aria-label': ariaLabel,
}: DawPluginChoiceRowProps): ReactElement => {
    const content = (
        <>
            {startSlot ? <div className="shrink-0">{startSlot}</div> : null}
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-foreground">{title}</span>
                    {detail ? (
                        <span className="shrink-0 text-[8px] uppercase tracking-[0.2em] text-muted-foreground/45">
                            {detail}
                        </span>
                    ) : null}
                </div>
                {subtitle ? <div className="text-[9px] leading-4 text-muted-foreground">{subtitle}</div> : null}
            </div>
            {endSlot ? <div className="shrink-0">{endSlot}</div> : null}
        </>
    );

    const sharedClassName = cn(
        'flex items-center gap-3 px-3 py-2 text-left transition-all',
        active ? 'border-white/18 bg-white/[0.03]' : 'hover:border-white/12 hover:bg-white/[0.02]',
        className
    );

    if (onPress) {
        return (
            <button
                type="button"
                className={sharedClassName}
                onClick={onPress}
                role={role}
                aria-selected={ariaSelected}
                aria-label={ariaLabel}
            >
                {content}
            </button>
        );
    }

    return (
        <div className={sharedClassName} role={role} aria-selected={ariaSelected} aria-label={ariaLabel}>
            {content}
        </div>
    );
};
