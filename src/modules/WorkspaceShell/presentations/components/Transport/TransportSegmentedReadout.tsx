import { type ReactElement, type ReactNode, type RefObject } from 'react';

import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

type TransportSegmentedReadoutProps = {
    label: ReactNode;
    segments: [ReactNode, ReactNode, ReactNode];
    separators: [ReactNode, ReactNode];
    segmentRefs?: [
        RefObject<HTMLSpanElement | null>,
        RefObject<HTMLSpanElement | null>,
        RefObject<HTMLSpanElement | null>,
    ];
    active?: boolean;
    onClick: () => void;
    ariaLabel: string;
    'data-testid'?: string;
};

export const TransportSegmentedReadout = ({
    label,
    segments,
    separators,
    segmentRefs,
    active = false,
    onClick,
    ariaLabel,
    ...rest
}: TransportSegmentedReadoutProps): ReactElement => {
    const primaryTone = active ? '#7fb8a4' : '#b0b0b0';
    const secondaryTone = active ? 'rgba(127,184,164,0.5)' : 'rgba(176,176,176,0.4)';

    return (
        <Button
            variant="bare"
            size="bare"
            type="button"
            className="daw-readout-well group flex cursor-pointer items-center gap-0.5 rounded-sm px-2.5 py-1 font-mono font-medium tabular-nums transition-colors"
            onClick={onClick}
            aria-label={ariaLabel}
            {...rest}
        >
            <DawEyebrowLabel size="xs" className="mr-1.5 font-sans text-muted-foreground/40">
                {label}
            </DawEyebrowLabel>
            <span ref={segmentRefs?.[0]} className="min-w-8 text-right text-xl" style={{ color: primaryTone }}>
                {segments[0]}
            </span>
            <span className="mt-0.5 text-sm" style={{ color: 'rgba(255,255,255,0.2)' }}>
                {separators[0]}
            </span>
            <span ref={segmentRefs?.[1]} className="min-w-6 text-xl" style={{ color: primaryTone }}>
                {segments[1]}
            </span>
            <span className="mt-0.5 text-sm" style={{ color: 'rgba(255,255,255,0.2)' }}>
                {separators[1]}
            </span>
            <span ref={segmentRefs?.[2]} className={cn('mt-0.5 min-w-8 text-sm')} style={{ color: secondaryTone }}>
                {segments[2]}
            </span>
        </Button>
    );
};
