import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type MixerStripValueProps = HTMLAttributes<HTMLSpanElement> & {
    size?: 'sm' | 'md';
};

export const MixerStripValue = ({ size = 'md', className, children, ...props }: MixerStripValueProps): ReactElement => (
    <span
        className={cn('mt-1 font-mono text-text-secondary', size === 'md' ? 'text-[10px]' : 'text-[9px]', className)}
        {...props}
    >
        {children}
    </span>
);
