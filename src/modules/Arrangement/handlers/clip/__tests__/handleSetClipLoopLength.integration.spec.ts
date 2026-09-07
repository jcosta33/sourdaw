import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commitActionUndoEntry,
    executeAppAction,
    executeAppActionBatch,
    getMacroHandlers,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trimClipEnd } from '../../../useCases/clipEditing/trimClipEnd';
import { restoreClipLoopLength } from '../../../useCases/clipLoop/restoreClipLoopLength';
import { setClipLoopLength } from '../../../useCases/clipLoop/setClipLoopLength';
import { handleRestoreClipLoopLength } from '../handleRestoreClipLoopLength';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const dormantLoopLengthLabel =
    'Set clip loop length to 2 beats; clip looping is disabled, so the stored length is dormant until enabled';

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

function expectWarningNotification(index: number, message: string): void {
    expect(notifications).toHaveLength(index + 1);
    expect(notifications[index]).toEqual({ message, level: 'warning' });
}

function currentClip() {
    const clip = trackStore.value?.tracks[0]?.clips[0];
    if (!clip) {
        throw new Error('Expected clip fixture');
    }
    return clip;
}

function seedClipFixture(): void {
    const clip = ClipDummy.create({ id: 'clip-1', endBeat: 8, loopEnabled: false });
    const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
}

describe('handleSetClipLoopLength atomic integration', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('clip loop length atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getMacroHandlers());
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: false, isRecording: false });
        seedClipFixture();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        unsubscribeFromNotifications();
        Container.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('round-trips optional loop length without changing geometry or enabled state', async () => {
        const action = { type: 'setClipLoopLength' as const, payload: { clipId: 'clip-1', loopLength: 2 } };

        const result = await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });

        expect(result.status).toBe('committed');
        expect(currentClip()).toMatchObject({ startBeat: 0, endBeat: 8, loopEnabled: false, loopLength: 2 });

        await undo();
        expect(currentClip()).toMatchObject({ startBeat: 0, endBeat: 8, loopEnabled: false });
        expect(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);

        await redo();
        expect(currentClip()).toMatchObject({ startBeat: 0, endBeat: 8, loopEnabled: false, loopLength: 2 });
    });

    it('retains stale undo and redo entries until the expected state or replacement is present', async () => {
        const action = { type: 'setClipLoopLength' as const, payload: { clipId: 'clip-1', loopLength: 2 } };
        await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });

        setClipLoopLength('clip-1', 3);
        const firstUndoNotification = notifications.length;
        await undo();
        expectWarningNotification(
            firstUndoNotification,
            `Cannot undo "${dormantLoopLengthLabel}": project state has changed`
        );
        expect(currentClip().loopLength).toBe(3);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);

        restoreClipLoopLength('clip-1', undefined);
        await undo();
        expect(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        setClipLoopLength('clip-1', 3);
        const firstRedoNotification = notifications.length;
        await redo();
        expectWarningNotification(
            firstRedoNotification,
            `Cannot redo "${dormantLoopLengthLabel}": project state has changed`
        );
        expect(currentClip().loopLength).toBe(3);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        setClipLoopLength('clip-1', 2);
        await redo();
        expect(currentClip().loopLength).toBe(2);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('retains undo until a present replacement is safe for collaborator-adjusted geometry', async () => {
        setClipLoopLength('clip-1', 1);
        await executeAppActionBatch([{ type: 'setClipLoopLength', payload: { clipId: 'clip-1', loopLength: 2 } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        trimClipEnd('clip-1', 10_000);

        const staleUndoNotification = notifications.length;
        await undo();
        expectWarningNotification(
            staleUndoNotification,
            `Cannot undo "${dormantLoopLengthLabel}": project state has changed`
        );
        expect(currentClip()).toMatchObject({ endBeat: 10_000, loopLength: 2 });
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);

        trimClipEnd('clip-1', 8);
        await undo();
        expect(currentClip()).toMatchObject({ endBeat: 8, loopLength: 1 });
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it('retains redo until a present replacement is safe for collaborator-adjusted geometry', async () => {
        await executeAppActionBatch([{ type: 'setClipLoopLength', payload: { clipId: 'clip-1', loopLength: 2 } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        await undo();
        trimClipEnd('clip-1', 10_000);

        const staleRedoNotification = notifications.length;
        await redo();
        expectWarningNotification(
            staleRedoNotification,
            `Cannot redo "${dormantLoopLengthLabel}": project state has changed`
        );
        expect(currentClip().endBeat).toBe(10_000);
        expect(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        trimClipEnd('clip-1', 8);
        await redo();
        expect(currentClip()).toMatchObject({ endBeat: 8, loopLength: 2 });
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('advances undo when an unsafe present replacement is already achieved without writing', async () => {
        setClipLoopLength('clip-1', 1);
        await executeAppActionBatch([{ type: 'setClipLoopLength', payload: { clipId: 'clip-1', loopLength: 2 } }]);
        trimClipEnd('clip-1', 10_000);
        setClipLoopLength('clip-1', 1);

        await undo();

        expect(currentClip()).toMatchObject({ endBeat: 10_000, loopLength: 1 });
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it('reports no-write before safety validation when an unsafe replacement is already achieved', () => {
        trimClipEnd('clip-1', 10_000);
        setClipLoopLength('clip-1', 1);

        expect(
            handleRestoreClipLoopLength.execute({
                type: 'restoreClipLoopLength',
                payload: {
                    clipId: 'clip-1',
                    expected: { present: true, value: 2 },
                    replacement: { present: true, value: 1 },
                },
            })
        ).toEqual({ status: 'no-write' });
    });

    it('advances redo when an unsafe present replacement is already achieved without writing', async () => {
        await executeAppActionBatch([{ type: 'setClipLoopLength', payload: { clipId: 'clip-1', loopLength: 2 } }]);
        await undo();
        trimClipEnd('clip-1', 10_000);
        setClipLoopLength('clip-1', 2);

        await redo();

        expect(currentClip()).toMatchObject({ endBeat: 10_000, loopLength: 2 });
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('rejects geometry, stretch, lifecycle, and loop companions in both batch orders before any write', async () => {
        type BatchAction = Parameters<typeof executeAppActionBatch>[0][number];
        const loopLengthAction = {
            type: 'setClipLoopLength',
            payload: { clipId: 'clip-1', loopLength: 2 },
        } satisfies BatchAction;
        const companions = [
            { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 6 } },
            { type: 'setClipStretchRatio', payload: { clipId: 'clip-1', ratio: 2 } },
            { type: 'removeClip', payload: { clipId: 'clip-1' } },
            { type: 'setClipLoop', payload: { clipId: 'clip-1', enabled: true } },
        ] satisfies BatchAction[];

        for (const companion of companions) {
            for (const actions of [
                [loopLengthAction, companion],
                [companion, loopLengthAction],
            ]) {
                const result = await executeAppActionBatch(actions);
                expect.soft(result).toMatchObject({
                    status: 'rejected',
                    reason: 'Action must execute as a singleton batch: setClipLoopLength',
                });
                expect.soft(currentClip()).toMatchObject({ startBeat: 0, endBeat: 8, loopEnabled: false });
                expect.soft(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);
                expect.soft(undoStore.value?.past).toHaveLength(0);
            }
        }
    });

    it('rejects internal loop-length restore with geometry in both batch orders before any write', async () => {
        const restoreAction = {
            type: 'restoreClipLoopLength' as const,
            payload: {
                clipId: 'clip-1',
                expected: { present: true, value: 2 },
                replacement: { present: false, value: 0 },
            },
        };
        const geometryAction = {
            type: 'trimClipEnd' as const,
            payload: { clipId: 'clip-1', newEndBeat: 6 },
        };

        for (const actions of [
            [restoreAction, geometryAction],
            [geometryAction, restoreAction],
        ]) {
            seedClipFixture();
            setClipLoopLength('clip-1', 2);
            clearUndoHistory();

            const result = await executeAppActionBatch(actions);

            expect.soft(result).toMatchObject({
                status: 'rejected',
                reason: 'Action must execute as a singleton batch: restoreClipLoopLength',
            });
            expect.soft(currentClip()).toMatchObject({ startBeat: 0, endBeat: 8, loopLength: 2 });
            expect.soft(undoStore.value?.past).toHaveLength(0);
            expect.soft(undoStore.value?.future).toHaveLength(0);
        }
    });

    it('plays singleton loop-length macro companions as individually dispatched, individually undoable actions', async () => {
        // The macro replay deliberately dropped its singleton-companion refusal:
        // the draw and move gestures became action-recordable, so macros can now
        // contain singleton actions and must still play. Singleton handlers
        // replay through the same sequential per-action dispatch as every other
        // action — each as its own undo unit, because the kernel drops the group
        // id for them — and the composition hazard the refusal guarded against
        // (batch co-execution) never arises in a per-action loop.
        type BatchAction = Parameters<typeof executeAppActionBatch>[0][number];
        const loopLengthAction = {
            type: 'setClipLoopLength',
            payload: { clipId: 'clip-1', loopLength: 2 },
        } satisfies BatchAction;
        const companions = [
            {
                action: { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 6 } },
                expectLoopFirst: () => expect(currentClip()).toMatchObject({ endBeat: 6, loopLength: 2 }),
                expectCompanionFirst: () => expect(currentClip()).toMatchObject({ endBeat: 6, loopLength: 2 }),
            },
            {
                action: { type: 'setClipStretchRatio', payload: { clipId: 'clip-1', ratio: 2 } },
                expectLoopFirst: () => expect(currentClip()).toMatchObject({ stretchRatio: 2, loopLength: 2 }),
                expectCompanionFirst: () => expect(currentClip()).toMatchObject({ stretchRatio: 2, loopLength: 2 }),
            },
            {
                action: { type: 'removeClip', payload: { clipId: 'clip-1' } },
                expectLoopFirst: () => expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0),
                // Loop length last conflicts on the removed clip, and a per-action
                // loop has no batch to half-apply: the remove stays committed as
                // its own undo unit and the conflicting action lands nowhere.
                expectCompanionFirst: () => expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0),
                companionFirstRejects: 'Action conflicts with current project state: setClipLoopLength',
                companionFirstPastLength: 1,
            },
            {
                action: { type: 'setClipLoop', payload: { clipId: 'clip-1', enabled: true } },
                expectLoopFirst: () => expect(currentClip()).toMatchObject({ loopEnabled: true, loopLength: 2 }),
                expectCompanionFirst: () => expect(currentClip()).toMatchObject({ loopEnabled: true, loopLength: 2 }),
            },
        ] satisfies {
            action: BatchAction;
            expectLoopFirst: () => void;
            expectCompanionFirst: () => void;
            companionFirstRejects?: string;
            companionFirstPastLength?: number;
        }[];

        for (const { action: companion, expectLoopFirst } of companions) {
            seedClipFixture();
            clearUndoHistory();
            macroStore.set({
                macros: [
                    {
                        id: 'macro-1',
                        name: 'Loop then companion',
                        actions: [loopLengthAction, companion],
                        createdAt: 0,
                    },
                ],
                recording: false,
                currentRecording: [],
            });

            await expect(
                executeAppAction({ type: 'playMacro', payload: { macroId: 'macro-1' } })
            ).resolves.toBeUndefined();
            expectLoopFirst();
            // Both writes landed, each as its own undo entry.
            expect(undoStore.value?.past).toHaveLength(2);
        }

        for (const {
            action: companion,
            expectCompanionFirst,
            companionFirstRejects,
            companionFirstPastLength,
        } of companions) {
            seedClipFixture();
            clearUndoHistory();
            macroStore.set({
                macros: [
                    {
                        id: 'macro-1',
                        name: 'Companion then loop',
                        actions: [companion, loopLengthAction],
                        createdAt: 0,
                    },
                ],
                recording: false,
                currentRecording: [],
            });

            if (companionFirstRejects) {
                await expect(executeAppAction({ type: 'playMacro', payload: { macroId: 'macro-1' } })).rejects.toThrow(
                    companionFirstRejects
                );
            } else {
                await expect(
                    executeAppAction({ type: 'playMacro', payload: { macroId: 'macro-1' } })
                ).resolves.toBeUndefined();
            }
            expectCompanionFirst();
            expect(undoStore.value?.past).toHaveLength(companionFirstPastLength ?? 2);
        }

        // Individually undoable: with both entries on the stack, one undo
        // reverts only the newest action (the trim) and leaves the recorded
        // loop length — the loop-length entry is its own unit, not a batch.
        seedClipFixture();
        clearUndoHistory();
        macroStore.set({
            macros: [
                {
                    id: 'macro-1',
                    name: 'Loop then trim',
                    actions: [loopLengthAction, { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 6 } }],
                    createdAt: 0,
                },
            ],
            recording: false,
            currentRecording: [],
        });
        await executeAppAction({ type: 'playMacro', payload: { macroId: 'macro-1' } });
        await undo();

        expect(currentClip()).toMatchObject({ endBeat: 8, loopLength: 2 });
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it('does not attach singleton loop-length history to a caller-supplied group', async () => {
        await executeAppAction(
            { type: 'setClipLoopLength', payload: { clipId: 'clip-1', loopLength: 2 } },
            { groupId: 'group-1', groupLabel: 'Unsafe group' }
        );
        await executeAppAction(
            { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 6 } },
            { groupId: 'group-1', groupLabel: 'Unsafe group' }
        );

        await undo();

        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(1);
        expect(currentClip()).toMatchObject({ endBeat: 8, loopLength: 2 });
    });

    it('de-groups legacy singleton history and replays both action orders without wedging', async () => {
        type BatchAction = Parameters<typeof executeAppActionBatch>[0][number];
        const loopLengthAction = {
            type: 'setClipLoopLength' as const,
            payload: { clipId: 'clip-1', loopLength: 2 },
        };
        const geometryAction = {
            type: 'trimClipEnd' as const,
            payload: { clipId: 'clip-1', newEndBeat: 6 },
        };

        for (const actions of [
            [loopLengthAction, geometryAction],
            [geometryAction, loopLengthAction],
        ]) {
            seedClipFixture();
            clearUndoHistory();
            for (const action of actions) {
                await executeAppAction(action, { skipUndo: true });
                let inverseAction: BatchAction;
                if (action.type === 'setClipLoopLength') {
                    inverseAction = {
                        type: 'restoreClipLoopLength',
                        payload: {
                            clipId: 'clip-1',
                            expected: { present: true, value: 2 },
                            replacement: { present: false, value: 0 },
                        },
                    };
                } else {
                    inverseAction = {
                        type: 'trimClipEnd',
                        payload: { clipId: 'clip-1', newEndBeat: 8 },
                    };
                }
                commitActionUndoEntry({
                    action,
                    inverseAction,
                    label: action.type,
                    groupId: 'legacy-mixed-singleton',
                    groupLabel: 'Legacy mixed singleton',
                });
            }

            await undo();
            expect.soft(undoStore.value?.past).toHaveLength(1);
            expect.soft(undoStore.value?.future).toHaveLength(1);
            await undo();
            expect.soft(currentClip()).toMatchObject({ startBeat: 0, endBeat: 8, loopEnabled: false });
            expect.soft(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);
            expect.soft(undoStore.value?.past).toHaveLength(0);
            expect.soft(undoStore.value?.future).toHaveLength(2);

            await redo();
            await redo();
            expect.soft(currentClip()).toMatchObject({ startBeat: 0, endBeat: 6, loopLength: 2 });
            expect.soft(undoStore.value?.past).toHaveLength(2);
            expect.soft(undoStore.value?.future).toHaveLength(0);
        }
    });

    it('rejects writes while playback or recording is active without creating history', async () => {
        const action = { type: 'setClipLoopLength' as const, payload: { clipId: 'clip-1', loopLength: 2 } };

        transportStore.set({ ...defaultTransportState, isPlaying: true });
        const playing = await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });
        expect(playing.status).toBe('conflicted');

        transportStore.set({ ...defaultTransportState, isRecording: true });
        const recording = await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });
        expect(recording.status).toBe('conflicted');
        expect(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('refuses to undo a committed length while playback is active, and keeps the entry undoable', async () => {
        const committed = await executeAppActionBatch(
            [{ type: 'setClipLoopLength', payload: { clipId: 'clip-1', loopLength: 2 } }],
            { source: 'prompt', requireCompensation: true }
        );
        expect(committed.status).toBe('committed');
        expect(currentClip()).toMatchObject({ loopLength: 2 });

        transportStore.set({ ...defaultTransportState, isPlaying: true });
        const busyUndoNotification = notifications.length;
        await undo();
        expectWarningNotification(
            busyUndoNotification,
            `Cannot undo "${dormantLoopLengthLabel}": project state has changed`
        );

        expect.soft(currentClip()).toMatchObject({ loopLength: 2 });
        expect.soft(undoStore.value?.past).toHaveLength(1);
        expect.soft(undoStore.value?.future).toHaveLength(0);

        transportStore.set({ ...defaultTransportState });
        await undo();

        expect(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('rejects a length that would exceed the shared loop-iteration bound at the action boundary', async () => {
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 100, loopEnabled: true });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });

        const result = await executeAppActionBatch(
            [{ type: 'setClipLoopLength', payload: { clipId: 'clip-1', loopLength: 1 / 480 } }],
            { source: 'prompt', requireCompensation: true }
        );

        expect(result.status).toBe('conflicted');
        expect(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
    });
});
