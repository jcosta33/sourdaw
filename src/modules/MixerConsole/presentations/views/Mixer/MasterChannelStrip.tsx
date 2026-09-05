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
     * Identifies which gesture owns the display and the engine. A settle's
     * dispatch awaits the Automerge snapshot transaction, which a
     * persistence barrier can hold for real time — long enough for the
     * pointer to be grabbed again before the first gesture's commit lands.
     * That commit's continuation must not clobber the newer gesture just
     * because it resolves late; the token is how it tells the two apart.
     * Incremented at the first transient sample after the previous gesture
     * settled (tracked by `liveGestureValue` going back to `null`).
     */
    const gestureToken = useRef(0);
    // The current gesture's most recent transient sample, `null` between
    // gestures. Doubles as the "is a gesture open" flag and, for a settle
    // whose continuation lands after a newer gesture has opened, as the
    // value that continuation re-sends to the engine on that gesture's
    // behalf.
    const liveGestureValue = useRef<number | null>(null);
    // Serialises settled dispatches: chaining each one onto the previous
    // gesture's settled dispatch — rather than firing them independently —
    // is what lets a later commit's `expectedPercent` read the store only
    // after an earlier, barrier-held commit has actually landed.
    const pendingCommit = useRef<Promise<void>>(Promise.resolve());

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

    /**
     * Runs once a settle's dispatch has landed, whichever gesture's token it
     * was issued under. If no newer gesture has opened since, this settle is
     * still the display and engine's owner and reconciles both from project
     * truth as before. Otherwise a newer gesture has already taken over —
     * restoring here would clobber it with this stale commit's outcome, so
     * this instead re-asserts the newer gesture's own live sample on the
     * engine (its own eventual settle reconciles the rest) and leaves the
     * display state untouched.
     */
    const settleContinuation = (token: number): void => {
        if (gestureToken.current === token) {
            restoreEngineFromProjectTruth();
            setGestureGain(null);
            return;
        }
        if (liveGestureValue.current !== null) {
            setMasterGain(liveGestureValue.current * 100, true);
        }
    };

    const commitMasterGain = async (value: number, token: number): Promise<void> => {
        try {
            const expectedPercent = transportStore.value?.masterGain;
            if (expectedPercent === undefined) {
                return;
            }
            await executeUserAppAction({
                type: 'setMasterGain',
                payload: { gain: value, expectedPercent },
            });
        } catch (error) {
            logger.error(new Error('Master channel strip commit failed for action: setMasterGain', { cause: error }));
        } finally {
            settleContinuation(token);
        }
    };

    const handleFaderChange = (value: number, isTransient?: boolean): void => {
        if (isTransient === true) {
            if (liveGestureValue.current === null) {
                gestureToken.current += 1;
            }
            liveGestureValue.current = value;
            setGestureGain(value);
            setMasterGain(value * 100, true);
            return;
        }
        const token = gestureToken.current;
        liveGestureValue.current = null;
        setGestureGain(value);
        pendingCommit.current = pendingCommit.current.then(() => commitMasterGain(value, token));
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
