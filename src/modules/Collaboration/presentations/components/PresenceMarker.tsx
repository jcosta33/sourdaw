import { type ReactElement } from 'react';

import { PresenceLabel } from './PresenceLabel';

type PresenceMarkerProps = {
    name: string;
    color: string;
    left: number;
    variant: 'playhead' | 'cursor';
    trackDotY?: number | null;
};

export const PresenceMarker = ({
    name,
    color,
    left,
    variant,
    trackDotY = null,
}: PresenceMarkerProps): ReactElement => {
    const isPlayhead = variant === 'playhead';

    return (
        <>
            <div
                className={isPlayhead ? 'absolute top-0 bottom-0' : 'absolute top-0 bottom-0 w-px'}
                style={{
                    left: `${left}px`,
                    width: isPlayhead ? '1px' : undefined,
                    backgroundColor: isPlayhead ? undefined : color,
                    backgroundImage: isPlayhead
                        ? `repeating-linear-gradient(to bottom, ${color} 0px, ${color} 4px, transparent 4px, transparent 8px)`
                        : undefined,
                    opacity: isPlayhead ? 0.6 : 0.7,
                }}
            />

            <PresenceLabel
                name={name}
                color={color}
                edge={isPlayhead ? 'bottom' : 'top'}
                left={left}
                offset={isPlayhead ? 3 : 2}
                opacity={isPlayhead ? 0.75 : 0.9}
            />

            {!isPlayhead && trackDotY !== null ? (
                <div
                    className="absolute size-2 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                    style={{
                        left: `${left - 3}px`,
                        top: `${trackDotY - 3}px`,
                        backgroundColor: color,
                    }}
                />
            ) : null}
        </>
    );
};
