import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

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
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('clip loop length atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getMacroHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: false, isRecording: false });
        seedClipFixture();
    });

    afterEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
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
        await undo();
        expect(currentClip().loopLength).toBe(3);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);

        restoreClipLoopLength('clip-1', undefined);
        await undo();
        expect(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        setClipLoopLength('clip-1', 3);
        await redo();
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

        await undo();
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

        await redo();
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

    it('rejects singleton loop-length macro companions in both orders before any action dispatches', async () => {
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
                seedClipFixture();
                clearUndoHistory();
                macroStore.set({
                    macros: [{ id: 'macro-1', name: 'Unsafe pair', actions, createdAt: 0 }],
                    recording: false,
                    currentRecording: [],
                });

                await expect(executeAppAction({ type: 'playMacro', payload: { macroId: 'macro-1' } })).rejects.toThrow(
                    'Action must execute as a singleton batch: setClipLoopLength'
                );
                expect.soft(currentClip()).toMatchObject({ startBeat: 0, endBeat: 8, loopEnabled: false });
                expect.soft(Object.hasOwn(currentClip(), 'loopLength')).toBe(false);
                expect.soft(undoStore.value?.past).toHaveLength(0);
            }
        }
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
        await undo();

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
