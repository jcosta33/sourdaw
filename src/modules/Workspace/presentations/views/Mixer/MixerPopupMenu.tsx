import {
    type ButtonHTMLAttributes,
    type ComponentPropsWithRef,
    type HTMLAttributes,
    type ReactElement,
    type ReactNode,
} from 'react';

import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { cn } from '#/utils/Styles/cn';

type MixerPopupMenuProps = ComponentPropsWithRef<'div'> & {
    position?: 'absolute' | 'fixed';
};

export const MixerPopupMenu = ({
    position = 'absolute',
    className,
    children,
    ...props
}: MixerPopupMenuProps): ReactElement => (
    <div
        className={cn(
            'daw-floating-surface z-50 min-w-[160px] rounded-md py-1',
            position === 'fixed' ? 'fixed' : 'absolute',
            className
        )}
        {...props}
    >
        {children}
    </div>
);

type MixerPopupOptionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    tone?: 'default' | 'danger';
    shortcut?: ReactNode;
};

export const MixerPopupOption = ({
    active = false,
    tone = 'default',
    className,
    shortcut,
    children,
    ...props
}: MixerPopupOptionProps): ReactElement => (
    <DawMenuButton
        className={cn(active && 'text-[var(--color-accent-cyan)]', className)}
        tone={tone}
        shortcut={shortcut}
        {...props}
    >
        {children}
    </DawMenuButton>
);

type MixerPopupLabelProps = HTMLAttributes<HTMLDivElement> & {
    children: ReactNode;
};

export const MixerPopupLabel = ({ className, children, ...props }: MixerPopupLabelProps): ReactElement => (
    <DawMenuMutedRow className={cn(className)} {...props}>
        {children}
    </DawMenuMutedRow>
);

export const MixerPopupSeparator = ({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement => (
    <DawMenuSeparator className={cn('border-border/50', className)} {...props} />
);
