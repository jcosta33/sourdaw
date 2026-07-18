import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type ChoiceCardProps = HTMLAttributes<HTMLDivElement> & {
    selected?: boolean;
    interactive?: boolean;
};

export const ChoiceCard = ({
    selected = false,
    interactive = true,
    className,
    children,
    ...props
}: ChoiceCardProps): ReactElement => (
    <div
        className={cn(
            'rounded-md border border-border/50 bg-surface-base p-2 shadow-none transition-colors',
            interactive ? 'cursor-pointer hover:bg-surface-raised' : '',
            selected ? 'ring-1 ring-primary/30' : '',
            className
        )}
        {...props}
    >
        {children}
    </div>
);
