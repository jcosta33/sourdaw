import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

type InsetPanelProps = HTMLAttributes<HTMLDivElement>;

export const InsetPanel = ({ className, children, ...props }: InsetPanelProps): ReactElement => (
    <div
        className={cn(
            'rounded-md border border-border-hairline bg-surface-well p-2 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]',
            className
        )}
        {...props}
    >
        {children}
    </div>
);
