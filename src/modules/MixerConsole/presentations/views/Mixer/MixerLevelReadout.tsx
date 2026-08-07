import { type ReactElement, type ReactNode, useEffect, useRef } from 'react';

import { getTrackPeakLevel, getMasterPeakLevel } from '#/modules/AudioEngine/useCases';
import { LevelMeter } from '#/modules/Metering/presentations/views';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';
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
    const id = crypto.randomUUID();
    const peakTextRef = useRef<HTMLDivElement>(null);
    const maxPeakRef = useRef<number>(MIN_DB);

    useEffect(() => {
        const tick = () => {
            const rawPeak = trackId ? getTrackPeakLevel(trackId) : getMasterPeakLevel();
            if (rawPeak === null) {
                // Master bus with no meter tap wired. "-∞" is the readout for a
                // bus that was measured and found silent; printing it here claims
                // a measurement nobody took, and any peak held from before the
                // tap went away is stale. Say the level is unavailable instead.
                maxPeakRef.current = MIN_DB;
                if (peakTextRef.current && peakTextRef.current.textContent !== 'n/a') {
                    peakTextRef.current.textContent = 'n/a';
                }
                return;
            }
            const db = linearToDb(rawPeak);

            if (db > maxPeakRef.current) {
                maxPeakRef.current = db;
                if (peakTextRef.current) {
                    peakTextRef.current.textContent = db <= MIN_DB ? '-∞' : db.toFixed(1);
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

        animationScheduler.register(`peak-readout-${id}`, tick);

        return () => {
            animationScheduler.unregister(`peak-readout-${id}`);
        };
    }, [trackId, id]);

    const handleReset = () => {
        maxPeakRef.current = MIN_DB;
        if (peakTextRef.current) {
            peakTextRef.current.textContent = '-∞';
            peakTextRef.current.classList.remove('text-state-error');
            peakTextRef.current.classList.add('text-muted-foreground/80');
        }
    };

    return (
        <>
            <div className={cn('mt-1 flex shrink-0 flex-col items-center gap-1', clusterClassName)}>
                <div
                    ref={peakTextRef}
                    onClick={handleReset}
                    className="text-[9px] font-mono cursor-pointer text-muted-foreground/80 hover:text-text-primary transition-colors h-3 flex items-center justify-center"
                    title="Click to reset peak"
                >
                    -∞
                </div>
                <div className="flex items-end justify-center h-full">
                    <LevelMeter trackId={trackId} width="w-1.5" />
                </div>
                {control}
            </div>
            <MixerStripValue size={valueSize}>{value}</MixerStripValue>
        </>
    );
};
