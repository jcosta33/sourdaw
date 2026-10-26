import { type ReactElement, useEffect, useRef, useState } from 'react';

import { DawChannelStripShell } from '#/components/daw/DawChannelStripShell';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { undoHistoryStore } from '#/modules/Command/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { setMasterGain, defaultTransportState } from '#/modules/Transport/useCases';
import { FADER_MAX_GAIN, formatGainDb } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { cn } from '#/utils/Styles/cn';

import { MasterGainControl } from './MasterGainControl';
import { MixerLevelReadout } from './MixerLevelReadout';

type MasterChannelStripProps = {
    widthClass: string;
};

type MasterChannelSurfaceProps = MasterChannelStripProps & {
    displayGain: number;
    onChange: (value: number, isTransient?: boolean) => void;
    onEnterValue: (value: number) => void;
    onResetToDefault: () => void;
    onCopyValue: () => void;
    onPasteValue: () => void;
    onInvalidatePendingValue: () => void;
};

type ProjectTransitionAuthority = ReturnType<typeof captureProjectTransitionAuthority>;

type PendingMasterGainCommit = {
    expectedPercent?: number;
    targetPercent: number;
    committed: boolean;
};

type MasterGainEntry = {
    authority: ProjectTransitionAuthority;
    expectedPercent: number;
    predecessors: PendingMasterGainCommit[];
};

function useMasterGainCommitQueue() {
    const pending = useRef<PendingMasterGainCommit[]>([]);
    const queue = useRef<Promise<void>>(Promise.resolve());
    const mounted = useRef(false);
    const latestIntent = useRef(0);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            pending.current = [];
        };
    }, []);
    const captureEntry = (): MasterGainEntry | null => {
        const expectedPercent = transportStore.value?.masterGain;
        if (expectedPercent === undefined) {
            return null;
        }
        const authority = captureProjectTransitionAuthority();
        const intent = ++latestIntent.current;
        return {
            authority: {
                ...authority,
                isCurrent: () => mounted.current && latestIntent.current === intent && authority.isCurrent(),
            },
            expectedPercent,
            predecessors: pending.current.filter((commit) => !commit.committed),
        };
    };
    const enqueue = (value: number, commit: (record: PendingMasterGainCommit) => Promise<void>): void => {
        const record: PendingMasterGainCommit = { targetPercent: value * 100, committed: false };
        pending.current.push(record);
        queue.current = queue.current
            .then(() => commit(record))
            .finally(() => {
                pending.current = pending.current.filter((candidate) => candidate !== record);
            });
    };
    const invalidateIntent = (): void => {
        latestIntent.current += 1;
    };
    return { captureEntry, enqueue, invalidateIntent };
}

function resolveEntryExpectedPercent(entry: MasterGainEntry): number | null {
    // Only the captured queue's own committed writes may advance this entry's CAS.
    let expectedPercent = entry.expectedPercent;
    for (const predecessor of entry.predecessors) {
        if (!predecessor.committed) {
            continue;
        }
        if (predecessor.expectedPercent !== expectedPercent) {
            return null;
        }
        expectedPercent = predecessor.targetPercent;
    }
    return expectedPercent;
}

function restoreEngineFromProjectTruth(): void {
    const storeMasterGain = transportStore.value?.masterGain;
    if (storeMasterGain === undefined) {
        return;
    }
    setMasterGain(storeMasterGain, true);
}

async function dispatchMasterGainAction(
    action: AppAction,
    record: PendingMasterGainCommit,
    coalesceWithPrevious?: boolean,
    entry?: MasterGainEntry
): Promise<void> {
    const onCommitted = (): void => {
        // A later effect failure cannot undo this witness; a resolved refusal cannot supply it.
        record.committed = true;
    };
    // Command rechecks this authority after waiting for snapshot ownership.
    if (entry) {
        await executeUserAppAction(action, {
            coalesceWithPrevious: coalesceWithPrevious === true,
            shouldExecute: entry.authority.isCurrent,
            onCommitted,
        });
        return;
    }
    if (coalesceWithPrevious) {
        await executeUserAppAction(action, { coalesceWithPrevious: true, onCommitted });
        return;
    }
    await executeUserAppAction(action, { onCommitted });
}

async function dispatchCurrentMasterGainAction(
    value: number,
    coalesceWithPrevious: boolean,
    record: PendingMasterGainCommit,
    entry?: MasterGainEntry
): Promise<AppAction | null> {
    if (entry && !entry.authority.isCurrent()) {
        return null;
    }
    const expectedPercent = entry ? resolveEntryExpectedPercent(entry) : transportStore.value?.masterGain;
    if (expectedPercent === undefined || expectedPercent === null) {
        return null;
    }
    const action: AppAction = { type: 'setMasterGain', payload: { gain: value, expectedPercent } };
    record.expectedPercent = expectedPercent;
    await dispatchMasterGainAction(action, record, coalesceWithPrevious, entry);
    return action;
}

function consumeRecordedGrooveWindow(
    stamp: { current: number | null },
    wasGestureSettle: boolean,
    allowPriorCoalesce: boolean
): boolean {
    if (!allowPriorCoalesce) {
        stamp.current = null;
        return false;
    }
    const recordedAt = stamp.current;
    if (wasGestureSettle || recordedAt === null || performance.now() - recordedAt > 500) {
        return false;
    }
    stamp.current = null;
    return true;
}

const MasterChannelSurface = ({
    widthClass,
    displayGain,
    onChange,
    onEnterValue,
    onResetToDefault,
    onCopyValue,
    onPasteValue,
    onInvalidatePendingValue,
}: MasterChannelSurfaceProps): ReactElement => (
    <DawChannelStripShell className={cn('ml-2', widthClass)} aria-label="Master channel" data-testid="channel-master">
        <div className="h-1 w-full rounded-full bg-border-active" />
        <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider">Master</span>
        <MixerLevelReadout
            trackId={null}
            clusterClassName="mt-1"
            control={
                <MasterGainControl
                    value={displayGain}
                    onChange={onChange}
                    onEnterValue={onEnterValue}
                    onResetToDefault={onResetToDefault}
                    onCopyValue={onCopyValue}
                    onPasteValue={onPasteValue}
                    onInvalidatePendingValue={onInvalidatePendingValue}
                />
            }
            value={`${formatGainDb(displayGain)} dB`}
        />
    </DawChannelStripShell>
);

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
     * Identifies which settle owns the display and the engine once its
     * dispatch resolves. A settle's dispatch awaits the Automerge snapshot
     * transaction, which a persistence barrier can hold for real time —
     * long enough for the pointer to be grabbed again, or another settle to
     * land, before this one's commit resolves. That commit's continuation
     * must not clobber whatever now owns the display just because it
     * resolves late; the token is how it tells old from current. Advances
     * at the first transient sample of a new gesture and again at every
     * settle — including a keyboard or double-click settle that never
     * opened one — so each settle captures a token no later gesture or
     * settle shares.
     */
    const gestureToken = useRef(0);
    // Whether a drag gesture is currently open, between its first transient
    // sample and its settle. Keyboard and double-click settles never open
    // one. This — not `displayedValue`, which a settle also writes — is
    // what `handleFaderChange` checks to decide whether a transient sample
    // starts a new gesture (and advances `gestureToken`) or continues one
    // already open.
    const gestureOpen = useRef(false);
    /**
     * What the fader and dB readout show for the open-or-pending gesture:
     * written at every transient sample and at every settle, so it always
     * holds the newest one, and cleared only when the settle that currently
     * owns the token lands. A settle whose continuation has lost that
     * ownership — because a newer gesture or settle claimed the token
     * first — reads this to re-send the *current* display value to the
     * engine instead of reasserting its own, now-stale, gain.
     */
    const displayedValue = useRef<number | null>(null);
    const commitQueue = useMasterGainCommitQueue();
    // Recency stamp arming the double-click reset's coalescing. Only a
    // gesture settle's own recording arms it, and only when its commit
    // actually recorded an undo entry: a jittered first click re-committing
    // the unchanged gain records nothing, so the reset must be its own undo
    // step rather than join the stack top (#4616). A discrete commit never
    // re-arms it — see `commitMasterGain`.
    const lastGrooveSettleTime = useRef<number | null>(null);

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
    const settleContinuation = (token: number): void => {
        if (gestureToken.current === token) {
            restoreEngineFromProjectTruth();
            setGestureGain(null);
            displayedValue.current = null;
            return;
        }
        if (displayedValue.current !== null) {
            setMasterGain(displayedValue.current * 100, true);
        }
    };

    const commitMasterGain = async (
        value: number,
        token: number,
        wasGestureSettle: boolean,
        allowPriorCoalesce: boolean,
        record: PendingMasterGainCommit,
        entry?: MasterGainEntry
    ): Promise<void> => {
        const coalesceWithPrevious = consumeRecordedGrooveWindow(
            lastGrooveSettleTime,
            wasGestureSettle,
            allowPriorCoalesce
        );
        try {
            const action = await dispatchCurrentMasterGainAction(value, coalesceWithPrevious, record, entry);
            // Only a gesture settle's own recording arms the window; a
            // discrete commit never re-arms. A keyboard nudge records too,
            // but letting it re-arm would chain the next burst of nudges into
            // one undo group and take away stepping back a single nudge. And
            // the stack top must be the entry THIS dispatch recorded — for
            // this action class the undo entry stores the dispatched action
            // object by reference — so a foreign recording landing inside the
            // held-open await (the persistence barrier can hold it for real
            // time) must not arm the reset.
            const stackTop = undoHistoryStore.value?.past.at(-1);
            if (action && wasGestureSettle && stackTop?.kind === 'action' && stackTop.action === action) {
                lastGrooveSettleTime.current = performance.now();
            }
        } catch (error) {
            logger.error(new Error('Master channel strip commit failed for action: setMasterGain', { cause: error }));
        } finally {
            settleContinuation(token);
        }
    };

    const settleMasterGain = (
        value: number,
        wasGestureSettle: boolean,
        allowPriorCoalesce: boolean,
        entry?: MasterGainEntry
    ): void => {
        gestureToken.current += 1;
        const token = gestureToken.current;
        displayedValue.current = value;
        setGestureGain(value);
        setMasterGain(value * 100, true);

        commitQueue.enqueue(value, (record) =>
            commitMasterGain(value, token, wasGestureSettle, allowPriorCoalesce, record, entry)
        );
    };

    const handleFaderChange = (value: number, isTransient?: boolean): void => {
        commitQueue.invalidateIntent();
        if (isTransient === true) {
            if (!gestureOpen.current) {
                gestureToken.current += 1;
            }
            gestureOpen.current = true;
            displayedValue.current = value;
            setGestureGain(value);
            setMasterGain(value * 100, true);
            return;
        }
        const wasOpen = gestureOpen.current;
        gestureOpen.current = false;
        settleMasterGain(value, wasOpen, true);
    };

    const enterGain = (value: number): void => {
        const entry = commitQueue.captureEntry();
        if (!entry) {
            return;
        }
        gestureOpen.current = false;
        lastGrooveSettleTime.current = null;
        settleMasterGain(value, false, false, entry);
    };

    const resetMasterGainFromMenu = (): void => {
        commitQueue.invalidateIntent();
        gestureOpen.current = false;
        lastGrooveSettleTime.current = null;
        settleMasterGain(defaultTransportState.masterGain / 100, false, false);
    };

    const invalidatePendingMasterGain = (): void => {
        commitQueue.invalidateIntent();
    };

    const copyMasterGain = (): void => {
        const entry = commitQueue.captureEntry();
        if (!entry) {
            return;
        }
        const encoded = `gain:${String(entry.expectedPercent / 100)}`;
        void (async () => {
            try {
                if (!navigator.clipboard?.writeText) {
                    throw new Error('Clipboard unavailable');
                }
                await navigator.clipboard.writeText(encoded);
            } catch {
                if (entry.authority.isCurrent()) {
                    notifyUser('Could not copy master gain to the clipboard.', 'error');
                }
            }
        })();
    };

    const pasteMasterGain = (): void => {
        const entry = commitQueue.captureEntry();
        if (!entry) {
            return;
        }
        void (async () => {
            let text: string;
            try {
                if (!navigator.clipboard?.readText) {
                    throw new Error('Clipboard unavailable');
                }
                text = await navigator.clipboard.readText();
            } catch {
                if (entry.authority.isCurrent()) {
                    notifyUser('Could not read master gain from the clipboard.', 'error');
                }
                return;
            }
            if (!entry.authority.isCurrent()) {
                return;
            }
            const encoded = text.startsWith('gain:') ? text.slice(5) : '';
            const gain = Number(encoded);
            if (!encoded || String(gain) !== encoded || !Number.isFinite(gain) || gain < 0 || gain > FADER_MAX_GAIN) {
                notifyUser('Clipboard does not contain a valid master gain value.', 'error');
                return;
            }

            gestureOpen.current = false;
            lastGrooveSettleTime.current = null;
            gestureToken.current += 1;
            const token = gestureToken.current;
            commitQueue.enqueue(gain, async (record) => {
                try {
                    await dispatchCurrentMasterGainAction(gain, false, record, entry);
                } catch (error) {
                    logger.error(
                        new Error('Master channel strip commit failed for action: setMasterGain', { cause: error })
                    );
                } finally {
                    settleContinuation(token);
                }
            });
        })();
    };

    const displayGain = gestureGain ?? masterGain / 100;

    return (
        <MasterChannelSurface
            widthClass={widthClass}
            displayGain={displayGain}
            onChange={handleFaderChange}
            onEnterValue={enterGain}
            onResetToDefault={resetMasterGainFromMenu}
            onCopyValue={copyMasterGain}
            onPasteValue={pasteMasterGain}
            onInvalidatePendingValue={invalidatePendingMasterGain}
        />
    );
};
