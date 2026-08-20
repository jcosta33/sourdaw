import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawMenuSectionLabelProps = HTMLAttributes<HTMLParagraphElement>;

export const DawMenuSectionLabel = ({ className, children, ...props }: DawMenuSectionLabelProps): ReactElement => (
    <p
        className={cn('px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground', className)}
        {...props}
    >
        {children}
    </p>
);

type DawMenuSeparatorProps = HTMLAttributes<HTMLDivElement>;

export const DawMenuSeparator = ({ className, ...props }: DawMenuSeparatorProps): ReactElement => (
    <div className={cn('mx-2 my-1 border-t border-border/30', className)} {...props} />
);

type DawMenuMutedRowProps = HTMLAttributes<HTMLDivElement>;

export const DawMenuMutedRow = ({ className, children, ...props }: DawMenuMutedRowProps): ReactElement => (
    <div className={cn('px-3 py-1 text-[10px] text-muted-foreground', className)} {...props}>
        {children}
    </div>
);

type DawMenuDisabledRowProps = HTMLAttributes<HTMLDivElement> & {
    icon?: ReactNode;
};

export const DawMenuDisabledRow = ({ icon, className, children, ...props }: DawMenuDisabledRowProps): ReactElement => (
    <Row gap={2} className={cn('cursor-not-allowed px-3 py-2 opacity-50', className)} aria-disabled="true" {...props}>
        {icon}
        <span className="text-[10px] text-muted-foreground">{children}</span>
    </Row>
);

type DawMenuButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: 'default' | 'danger';
    active?: boolean;
    leadingContent?: ReactNode;
    trailingContent?: ReactNode;
    shortcut?: ReactNode;
};

export const DawMenuButton = ({
    tone = 'default',
    active = false,
    leadingContent,
    trailingContent,
    shortcut,
    className,
    children,
    type = 'button',
    ...props
}: DawMenuButtonProps): ReactElement => (
    <Row
        as="button"
        type={type}
        gap={2}
        className={cn(
            'w-full rounded-sm px-2 py-1.5 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-30',
            tone === 'danger'
                ? 'text-destructive hover:bg-destructive/10'
                : 'text-popover-foreground hover:bg-accent hover:text-accent-foreground',
            active ? 'font-medium text-primary' : '',
            className
        )}
        {...props}
    >
        <Row grow gap={2} className="min-w-0">
            {leadingContent}
            <span className="truncate">{children}</span>
        </Row>
        {(trailingContent ?? shortcut) ? (
            <span className="pl-4 text-[10px] text-muted-foreground">{trailingContent ?? shortcut}</span>
        ) : null}
    </Row>
);
