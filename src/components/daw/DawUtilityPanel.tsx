import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/utils/Styles/cn';

type DawUtilityPanelProps = HTMLAttributes<HTMLDivElement>;

export const DawUtilityPanel = ({ className, children, ...props }: DawUtilityPanelProps): ReactElement => (
    <div className={cn('daw-floating-surface flex flex-col overflow-hidden rounded-lg', className)} {...props}>
        {children}
    </div>
);
