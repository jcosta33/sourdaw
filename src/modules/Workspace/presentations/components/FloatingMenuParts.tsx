import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';

type FloatingMenuSectionLabelProps = HTMLAttributes<HTMLParagraphElement>;

export const FloatingMenuSectionLabel = ({
    className,
    children,
    ...props
}: FloatingMenuSectionLabelProps): ReactElement => (
    <p
        className={cn('px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground', className)}
        {...props}
    >
        {children}
    </p>
);

type FloatingMenuSeparatorProps = HTMLAttributes<HTMLDivElement>;

export const FloatingMenuSeparator = ({ className, ...props }: FloatingMenuSeparatorProps): ReactElement => (
    <div className={cn('mx-2 my-1 border-t border-border/30', className)} {...props} />
);

type FloatingMenuDisabledRowProps = HTMLAttributes<HTMLDivElement> & {
    icon?: ReactNode;
};

export const FloatingMenuDisabledRow = ({
    icon,
    className,
    children,
    ...props
}: FloatingMenuDisabledRowProps): ReactElement => (
    <div
        className={cn('flex cursor-not-allowed items-center gap-2 px-3 py-2 opacity-50', className)}
        aria-disabled="true"
        {...props}
    >
        {icon}
        <span className="text-[10px] text-muted-foreground">{children}</span>
    </div>
);
