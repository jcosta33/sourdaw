import { type ButtonHTMLAttributes, type ReactElement } from 'react';

import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

type MixerInsetButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: 'default' | 'accent';
};

export const MixerInsetButton = ({
    tone = 'default',
    className,
    children,
    type = 'button',
    ...props
}: MixerInsetButtonProps): ReactElement => (
    <Button
        variant="bare"
        size="bare"
        type={type}
        className={cn(
            'w-full rounded border px-1 py-0.5 text-center text-[10px] transition-colors',
            tone === 'default'
                ? 'border-border-hairline bg-surface-inset shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] hover:bg-surface-raised'
                : 'border-[var(--color-accent-lavender)]/20 bg-[var(--color-accent-lavender)]/10 text-foreground hover:bg-[var(--color-accent-lavender)]/20',
            className
        )}
        {...props}
    >
        {children}
    </Button>
);
