import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/utils/Styles/cn';

type DawControlStripProps = HTMLAttributes<HTMLDivElement>;

export const DawControlStrip = ({ className, children, ...props }: DawControlStripProps): ReactElement => (
    <div className={cn('daw-control-strip flex min-w-0 shrink-0 items-center gap-2 px-2 py-1', className)} {...props}>
        {children}
    </div>
);
