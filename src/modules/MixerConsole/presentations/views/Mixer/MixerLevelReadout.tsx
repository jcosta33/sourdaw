import { type ReactElement, type ReactNode, useEffect, useRef } from 'react';

import { Row } from '#/components/layout';
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
    /**
     * Peak-hold latch. The readout is only written when a sample beats it, so the
     * floor must sit *below* every value `linearToDb` can return — including
     * `MIN_DB` itself, which is what silence maps to. Parking it at `MIN_DB`
     * makes `-60 > -60` false and freezes whatever text was there through every
     * silent frame, which is how a live but idle bus kept reading "n/a".
     */
    const maxPeakRef = useRef<number>(Number.NEGATIVE_INFINITY);

    useEffect(() => {
        const tick = () => {
            const rawPeak = trackId ? getTrackPeakLevel(trackId) : getMasterPeakLevel();
            if (rawPeak === null) {
                // Master bus with no meter tap wired. "-∞" is the readout for a
                // bus that was measured and found silent; printing it here claims
                // a measurement nobody took, and any peak held from before the
                // tap went away is stale. Say the level is unavailable instead.
                //
                // The floor is -Infinity, not MIN_DB: silence maps to MIN_DB, so
                // a MIN_DB floor loses the `db > max` test on the first recovered
                // frame of an idle bus and leaves "n/a" on screen over a meter
                // that is up and measuring correctly.
                maxPeakRef.current = Number.NEGATIVE_INFINITY;
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
        // MIN_DB here, not -Infinity, and the "-∞" write below is not a claim:
        // reset paints the floor itself, and the very next tick either overwrites
        // it with a louder reading or with "n/a". The MIN_DB latch is consistent
        // with the text it just wrote — a silent bus should keep showing "-∞".
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
                <Row
                    ref={peakTextRef}
                    onClick={handleReset}
                    justify="center"
                    className="h-3 cursor-pointer font-mono text-[9px] text-muted-foreground/80 transition-colors hover:text-text-primary"
                    title="Click to reset peak"
                >
                    {/* Pre-tick placeholder. Nothing has been measured yet, so "-∞"
                        would claim a silent bus. The first tick overwrites this. */}
                    n/a
                </Row>
                <Row align="end" justify="center" className="h-full">
                    <LevelMeter trackId={trackId} width="w-1.5" />
                </Row>
                {control}
            </div>
            <MixerStripValue size={valueSize}>{value}</MixerStripValue>
        </>
    );
};
