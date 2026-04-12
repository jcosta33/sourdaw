import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawDialogBodyProps = HTMLAttributes<HTMLDivElement> & {
    scrollable?: boolean;
};

export const DawDialogBody = ({
    className,
    scrollable = false,
    children,
    ...props
}: DawDialogBodyProps): ReactElement => (
    <div
        className={cn(
            'flex min-h-0 flex-col gap-4 bg-surface-base/40 px-4 py-4',
            scrollable ? 'overflow-y-auto' : '',
            className
        )}
        {...props}
    >
        {children}
    </div>
);
