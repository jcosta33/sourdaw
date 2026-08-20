import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

import { DawHeaderBand } from './DawHeaderBand';

type DawDiagramFrameProps = HTMLAttributes<HTMLDivElement> & {
    title?: ReactNode;
    actions?: ReactNode;
    footer?: ReactNode;
    viewportClassName?: string;
    titleClassName?: string;
    compact?: boolean;
};

export const DawDiagramFrame = ({
    title,
    actions,
    footer,
    viewportClassName,
    titleClassName,
    compact = true,
    className,
    children,
    ...props
}: DawDiagramFrameProps): ReactElement => (
    <Stack
        className={cn(
            'overflow-hidden rounded-[16px] border border-white/8 bg-black/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
            className
        )}
        {...props}
    >
        {title !== undefined || actions !== undefined ? (
            <DawHeaderBand
                compact={compact}
                title={title}
                actions={actions}
                titleClassName={cn('text-white/56', titleClassName)}
                className="border-b border-white/[0.06] bg-black/[0.12]"
            />
        ) : null}
        <div className={cn('min-h-0 flex-1 overflow-auto p-2', viewportClassName)}>{children}</div>
        {footer ? <div className="border-t border-white/[0.06] px-3 py-2">{footer}</div> : null}
    </Stack>
);
