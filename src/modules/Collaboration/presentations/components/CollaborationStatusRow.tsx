import { type ReactElement, type ReactNode } from 'react';

import { cn } from '#/helpers/Styles/cn';

type CollaborationStatusRowProps = {
    icon: ReactNode;
    label: ReactNode;
    tone?: 'muted' | 'danger';
    endSlot?: ReactNode;
    className?: string;
};

export const CollaborationStatusRow = ({
    icon,
    label,
    tone = 'muted',
    endSlot,
    className,
}: CollaborationStatusRowProps): ReactElement => (
    <div
        className={cn(
            'flex items-center gap-2 rounded-md border px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
            tone === 'danger'
                ? 'border-[var(--color-state-danger)]/20 bg-[var(--color-state-danger)]/6 text-[var(--color-state-danger)]'
                : 'border-white/8 bg-black/20 text-muted-foreground',
            className
        )}
    >
        <div className="shrink-0">{icon}</div>
        <div className="min-w-0 flex-1 truncate text-[11px]">{label}</div>
        {endSlot ? <div className="shrink-0">{endSlot}</div> : null}
    </div>
);
