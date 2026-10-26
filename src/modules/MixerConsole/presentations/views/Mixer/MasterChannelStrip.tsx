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

function useMasterGainInteractionState() {
    return {
        gestureGain: useState<number | null>(null),
        gestureToken: useRef(0),
        gestureOpen: useRef(false),
        displayedValue: useRef<number | null>(null),
        commitQueue: useMasterGainCommitQueue(),
        lastGrooveSettleTime: useRef<number | null>(null),
    };
}

type MasterGainInteractionState = ReturnType<typeof useMasterGainInteractionState>;
type MasterGainCommitQueue = ReturnType<typeof useMasterGainCommitQueue>;

function enqueueDiscreteMasterGain(
    state: MasterGainInteractionState,
    value: number,
    entry: MasterGainEntry,
    settleContinuation: (token: number) => void
): void {
    const [, setGestureGain] = state.gestureGain;
    state.gestureOpen.current = false;
    state.lastGrooveSettleTime.current = null;
    state.gestureToken.current += 1;
    const token = state.gestureToken.current;
    state.commitQueue.enqueue(value, async (record) => {
        try {
            await dispatchCurrentMasterGainAction(value, false, record, entry);
        } catch (error) {
            logger.error(new Error('Master channel strip commit failed for action: setMasterGain', { cause: error }));
        } finally {
            settleContinuation(token);
        }
    });
}

function useMasterGainCommitHandlers(state: MasterGainInteractionState) {
    const [, setGestureGain] = state.gestureGain;
    const { gestureToken, displayedValue, commitQueue, lastGrooveSettleTime } = state;

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

    const commitPastedGain = (value: number, entry: MasterGainEntry): void => {
        enqueueDiscreteMasterGain(state, value, entry, settleContinuation);
    };
    return { settleMasterGain, commitPastedGain };
}

function useMasterGainControlHandlers(
    state: MasterGainInteractionState,
    commits: ReturnType<typeof useMasterGainCommitHandlers>
) {
    const [, setGestureGain] = state.gestureGain;
    const { gestureToken, gestureOpen, displayedValue, commitQueue, lastGrooveSettleTime } = state;
    const { settleMasterGain } = commits;

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
    const invalidatePendingMasterGain = (): void => commitQueue.invalidateIntent();
    return { handleFaderChange, enterGain, resetMasterGainFromMenu, invalidatePendingMasterGain };
}

function createMasterGainClipboardActions(
    commitQueue: MasterGainCommitQueue,
    commitPastedGain: (value: number, entry: MasterGainEntry) => void
) {
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
            commitPastedGain(gain, entry);
        })();
    };
    return { copyMasterGain, pasteMasterGain };
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
    const state = useMasterGainInteractionState();
    const commits = useMasterGainCommitHandlers(state);
    const handlers = useMasterGainControlHandlers(state, commits);
    const clipboard = createMasterGainClipboardActions(state.commitQueue, commits.commitPastedGain);
    const displayGain = state.gestureGain[0] ?? masterGain / 100;

    return (
        <MasterChannelSurface
            widthClass={widthClass}
            displayGain={displayGain}
            onChange={handlers.handleFaderChange}
            onEnterValue={handlers.enterGain}
            onResetToDefault={handlers.resetMasterGainFromMenu}
            onCopyValue={clipboard.copyMasterGain}
            onPasteValue={clipboard.pasteMasterGain}
            onInvalidatePendingValue={handlers.invalidatePendingMasterGain}
        />
    );
};
