import { type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

type PresenceLabelProps = {
    name: string;
    color: string;
    edge: 'top' | 'bottom';
    left: number;
    offset?: number;
    opacity?: number;
};

export const PresenceLabel = ({
    name,
    color,
    edge,
    left,
    offset = 3,
    opacity = 0.9,
}: PresenceLabelProps): ReactElement => (
    <div
        className={cn(
            'absolute whitespace-nowrap rounded-b px-1 text-[9px] font-medium text-white',
            edge === 'top' ? 'top-0' : 'bottom-1'
        )}
        style={{
            left: `${left + offset}px`,
            backgroundColor: color,
            opacity,
        }}
    >
        {name}
    </div>
);
