import { type ReactElement, useRef, useState } from 'react';

import { DawChannelStripShell } from '#/components/daw/DawChannelStripShell';
import { Fader } from '#/components/daw/Fader';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { setMasterGain, defaultTransportState } from '#/modules/Transport/useCases';
import { FADER_MAX_GAIN, formatGainDb } from '#/utils/audioLevelLaw';
import { cn } from '#/utils/Styles/cn';

import { MixerLevelReadout } from './MixerLevelReadout';

type MasterChannelStripProps = {
    widthClass: string;
};

export const MasterChannelStrip = ({ widthClass }: MasterChannelStripProps): ReactElement => {
    const masterGain = useStore(transportStore, defaultTransportState).masterGain;
    // Mid-gesture fader value, in 0–1 fader units, held only for the duration of
    // a drag — same precedent as `useChannelStripActions`'s `gestureGain`. The
    // engine moves on every transient sample but `transportStore` does not, so
    // without this the cap would freeze under the pointer while the level kept
    // changing underneath it. Held until the settled dispatch below resolves,
    // not cleared the moment the gesture ends, or the cap would snap back to
    // the pre-gesture store value for as long as the commit takes to land.
    const [gestureGain, setGestureGain] = useState<number | null>(null);
    /**
     * The store percent from before this gesture moved anything, captured at
     * its first transient sample. `expectedPercent` on the settled dispatch
     * has to name that pre-gesture value, not whatever `transportStore` holds
     * once the drag settles, or a conflict from something else moving the
     * master fader mid-gesture could never be detected. A gesture with no
     * transient sample (a keyboard commit or the double-click reset) settles
     * straight from the current store value instead.
     */
    const gestureStartPercent = useRef<number | null>(null);

    /**
     * Put the engine back on project truth after a settle that never moved
     * the store — a conflict `executeUserAppAction` folded into a toast, an
     * admission refusal, or a throw.
     *
     * `executeUserAppAction` swallows `AppActionConflictError` (the store
     * moved mid-gesture) into a notification and resolves, so a conflicted
     * settle runs only this `finally` with nothing else to restore the
     * engine from the value the gesture released. On the written path
     * `afterCommit` already reconciles the engine, so the extra transient
     * write here is idempotent — nothing branches on outcome. Same
     * precedent as `useChannelStripActions`'s `restoreEngineFromProjectTruth`.
     */
    const restoreEngineFromProjectTruth = (): void => {
        const storeMasterGain = transportStore.value?.masterGain;
        if (storeMasterGain === undefined) {
            return;
        }
        setMasterGain(storeMasterGain, true);
    };

    const commitMasterGain = (value: number, expectedPercent: number): void => {
        void (async () => {
            try {
                await executeUserAppAction({
                    type: 'setMasterGain',
                    payload: { gain: value, expectedPercent },
                });
            } catch (error) {
                logger.error(
                    new Error('Master channel strip commit failed for action: setMasterGain', { cause: error })
                );
            } finally {
                restoreEngineFromProjectTruth();
                setGestureGain(null);
            }
        })();
    };

    const handleFaderChange = (value: number, isTransient?: boolean): void => {
        if (isTransient === true) {
            if (gestureStartPercent.current === null) {
                gestureStartPercent.current = masterGain;
            }
            setGestureGain(value);
            setMasterGain(value * 100, true);
            return;
        }
        setGestureGain(value);
        const expectedPercent = gestureStartPercent.current ?? masterGain;
        gestureStartPercent.current = null;
        commitMasterGain(value, expectedPercent);
    };

    const displayGain = gestureGain ?? masterGain / 100;

    return (
        <DawChannelStripShell
            className={cn('ml-2', widthClass)}
            aria-label="Master channel"
            data-testid="channel-master"
        >
            <div className="h-1 w-full rounded-full bg-border-active" />
            <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider">Master</span>
            <MixerLevelReadout
                trackId={null}
                clusterClassName="mt-1"
                control={
                    <div className="shrink-0" data-testid="master-gain">
                        <Fader
                            value={displayGain}
                            onChange={handleFaderChange}
                            min={0}
                            max={FADER_MAX_GAIN}
                            step={0.01}
                            fineStep={0.001}
                            defaultValue={defaultTransportState.masterGain / 100}
                            height={100}
                            aria-label="Master gain"
                        />
                    </div>
                }
                value={`${formatGainDb(displayGain)} dB`}
            />
        </DawChannelStripShell>
    );
};
