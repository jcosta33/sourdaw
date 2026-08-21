import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type CollaborationBlockProps = HTMLAttributes<HTMLDivElement> & {
    title?: ReactNode;
    description?: ReactNode;
    tone?: 'default' | 'danger';
};

export const CollaborationBlock = ({
    title,
    description,
    tone = 'default',
    className,
    children,
    ...props
}: CollaborationBlockProps): ReactElement => (
    <div
        className={cn(
            'rounded-md border px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_-1px_0_rgba(0,0,0,0.2)]',
            tone === 'danger'
                ? 'border-[var(--color-state-danger)]/25 bg-[var(--color-state-danger)]/6'
                : 'border-white/8 bg-white/[0.03]',
            className
        )}
        {...props}
    >
        {title || description ? (
            <Stack gap={1} className="mb-2">
                {title ? <DawEyebrowLabel size="sm">{title}</DawEyebrowLabel> : null}
                {description ? <p className="text-[10px] leading-4 text-muted-foreground/70">{description}</p> : null}
            </Stack>
        ) : null}
        {children}
    </div>
);
