import { type ReactElement, type ReactNode, useEffect, useRef } from 'react';

import { subscribePeakMeter } from '#/modules/AudioEngine/useCases';
import { LevelMeter } from '#/modules/Metering/presentations/views';
import { cn } from '#/utils/Styles/cn';

import { MixerStripValue } from '../../components/Mixer/MixerStripValue';

type MixerLevelReadoutProps = {
    trackId: string | null;
    control: ReactNode;
    value: ReactNode;
    clusterClassName?: string;
    valueSize?: 'sm' | 'md';
};

const MIN_DB = -60;

const linearToDb = (linear: number): number => {
    if (linear <= 0) {
        return MIN_DB;
    }
    return Math.max(MIN_DB, 20 * Math.log10(linear));
};

export const MixerLevelReadout = ({
    trackId,
    control,
    value,
    clusterClassName,
    valueSize = 'md',
}: MixerLevelReadoutProps): ReactElement => {
    const peakTextRef = useRef<HTMLButtonElement>(null);
    const maxPeakRef = useRef<number>(MIN_DB);

    useEffect(() => {
        const tick = (rawPeak: number) => {
            const db = linearToDb(rawPeak);

            if (db > maxPeakRef.current) {
                maxPeakRef.current = db;
                if (peakTextRef.current) {
                    const peakText = db <= MIN_DB ? '-∞' : db.toFixed(1);
                    peakTextRef.current.textContent = peakText;
                    peakTextRef.current.ariaLabel = `Peak level: ${peakText} dB. Click to reset.`;
                    if (db > 0) {
                        peakTextRef.current.classList.add('text-state-error');
                        peakTextRef.current.classList.remove('text-muted-foreground/80');
                    } else {
                        peakTextRef.current.classList.remove('text-state-error');
                        peakTextRef.current.classList.add('text-muted-foreground/80');
                    }
                }
            }
        };

        const unsubscribe = subscribePeakMeter({ trackId, onFrame: tick });

        return () => {
            unsubscribe();
        };
    }, [trackId]);

    const handleReset = () => {
        maxPeakRef.current = MIN_DB;
        if (peakTextRef.current) {
            peakTextRef.current.textContent = '-∞';
            peakTextRef.current.ariaLabel = 'Peak level: -∞ dB. Click to reset.';
            peakTextRef.current.classList.remove('text-state-error');
            peakTextRef.current.classList.add('text-muted-foreground/80');
        }
    };

    return (
        <>
            <div className={cn('mt-1 flex shrink-0 flex-col items-center gap-1', clusterClassName)}>
                <button
                    type="button"
                    ref={peakTextRef}
                    onClick={handleReset}
                    className="text-[9px] font-mono cursor-pointer text-muted-foreground/80 hover:text-text-primary transition-colors h-3 flex items-center justify-center border-0 bg-transparent p-0"
                    title="Click to reset peak"
                    aria-label="Peak level: -∞ dB. Click to reset."
                >
                    -∞
                </button>
                <div className="flex items-end justify-center h-full">
                    <LevelMeter trackId={trackId} width="w-1.5" />
                </div>
                {control}
            </div>
            <MixerStripValue size={valueSize}>{value}</MixerStripValue>
        </>
    );
};
