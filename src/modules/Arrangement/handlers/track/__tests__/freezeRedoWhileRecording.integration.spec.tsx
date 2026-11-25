import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    commitUndoEntry,
    createUndoEntry,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { recordingStartStore } from '#/modules/Transport/stores';
import {
    setNotificationEventBus,
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { captureFreezeStateSnapshot } from '../../../useCases/freezeBounce/freezeStateSnapshot';
import { activeFreezeTasks } from '../../../useCases/freezeBounce/freezeTrack';
import { type renderTrackOffline } from '../../../useCases/freezeBounce/renderOffline';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const render = vi.hoisted(() => vi.fn<typeof renderTrackOffline>());
vi.mock('../../../useCases/freezeBounce/renderOffline', () => ({ renderTrackOffline: render }));

const WARNING = 'Freeze is unavailable while this track is recording.';

function buffer(): AudioBuffer {
    const samples = new Float32Array(128).fill(0.5);
    return {
        duration: samples.length / 48000,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 48000,
        getChannelData: () => samples,
        copyFromChannel: (destination) => {
            destination.set(samples.subarray(0, destination.length));
        },
        copyToChannel: (source) => {
            samples.set(source.subarray(0, samples.length));
        },
    };
}

function freezeStatus(): string | undefined {
    return trackStore.value?.tracks[0]?.freezeState.status;
}

const FREEZE_TRACK = { type: 'freezeTrack', payload: { trackId: 'freeze-track' } } as const;
const UNFREEZE_TRACK = { type: 'unfreezeTrack', payload: { trackId: 'freeze-track' } } as const;

function staleTake() {
    return {
        frozen: true,
        frozenBufferId: 'old-take',
        freezeState: {
            status: 'stale' as const,
            freezeId: 'old-freeze',
            frozenBufferId: 'old-take',
            sourceContentHash: 'old-hash',
            compensationSeconds: 0.02,
        },
    };
}

function trackGain(): number | undefined {
    return trackStore.value?.tracks[0]?.gain;
}

describe('Freeze history replay while a recording starts', () => {
    let notices: NotifyPayload[];

    function seedArmedTrack(overrides: Parameters<typeof TrackDummy.create>[0] = {}): void {
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'freeze-track', armed: true, ...overrides })],
            selectedTrackId: 'freeze-track',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
    }

    function warnings(): string[] {
        return notices.filter((notice) => notice.level === 'warning').map((notice) => notice.message);
    }

    beforeEach(() => {
        notices = [];
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        bus.on('ui.notify', (notice) => {
            notices.push(notice);
        });
        setNotificationEventBus(bus);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Freeze redo while recording');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        activeFreezeTasks.clear();
        actionHistoryStore.set({ entries: [] });
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
        seedArmedTrack();
        render.mockReset();
        render.mockResolvedValue(buffer());
        recordingStartStore.set(false);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        recordingStartStore.set(false);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearHandlerRegistry();
        activeFreezeTasks.clear();
    });

    it('refuses the redo of a freeze during count-in, keeps the entry redoable, and redoes it once recording stops', async () => {
        await executeAppAction(FREEZE_TRACK);
        await undo();
        expect(freezeStatus()).toBe('unfrozen');
        recordingStartStore.set(true);

        await redo();

        expect(freezeStatus()).toBe('unfrozen');
        expect(warnings()).toEqual([WARNING]);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        recordingStartStore.set(false);
        await redo();

        expect(freezeStatus()).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('refuses the undo of an unfreeze during count-in, keeps the entry undoable, and undoes it once recording stops', async () => {
        await executeAppAction(FREEZE_TRACK);
        await executeAppAction(UNFREEZE_TRACK);
        expect(freezeStatus()).toBe('unfrozen');
        expect(undoStore.value?.past).toHaveLength(2);
        recordingStartStore.set(true);

        await undo();

        expect(freezeStatus()).toBe('unfrozen');
        expect(warnings()).toEqual([WARNING]);
        expect(undoStore.value?.past).toHaveLength(2);
        expect(undoStore.value?.future).toHaveLength(0);

        recordingStartStore.set(false);
        await undo();

        expect(freezeStatus()).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it('still undoes a freeze during count-in, since unfreezing is always allowed', async () => {
        await executeAppAction(FREEZE_TRACK);
        recordingStartStore.set(true);

        await undo();

        expect(freezeStatus()).toBe('unfrozen');
        expect(warnings()).toEqual([]);
    });

    it('refuses the undo of a freeze of a stale take during count-in, since the restored take is frozen', async () => {
        seedArmedTrack(staleTake());
        await executeAppAction(FREEZE_TRACK);
        expect(freezeStatus()).toBe('frozen');
        recordingStartStore.set(true);

        await undo();

        expect(freezeStatus()).toBe('frozen');
        expect(warnings()).toEqual([WARNING]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('refuses the undo of an unfreeze of a stale take during count-in', async () => {
        seedArmedTrack(staleTake());
        await executeAppAction(UNFREEZE_TRACK);
        expect(freezeStatus()).toBe('unfrozen');
        recordingStartStore.set(true);

        await undo();

        expect(freezeStatus()).toBe('unfrozen');
        expect(trackStore.value?.tracks[0]?.frozen).toBe(false);
        expect(warnings()).toEqual([WARNING]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    describe('with a conflict-reporting entry beneath', () => {
        const setGain = (gain: number, expectedGain: number) =>
            ({ type: 'setTrackGain', payload: { trackId: 'freeze-track', gain, expectedGain } }) as const;

        it('refuses the undo of an unfreeze without reverting the gain change beneath it', async () => {
            const original = trackGain() ?? 0;
            await executeAppAction(FREEZE_TRACK);
            await executeAppAction(setGain(0.3, original));
            await executeAppAction(UNFREEZE_TRACK);
            expect(undoStore.value?.past).toHaveLength(3);
            recordingStartStore.set(true);
            notices.length = 0;

            await undo();

            expect(trackGain()).toBeCloseTo(0.3);
            expect(freezeStatus()).toBe('unfrozen');
            expect(undoStore.value?.past).toHaveLength(3);
            expect(undoStore.value?.future).toHaveLength(0);
            expect(warnings()).toEqual([WARNING]);
        });

        it('refuses the redo of a freeze without redoing the gain change behind it', async () => {
            const original = trackGain() ?? 0;
            await executeAppAction(FREEZE_TRACK);
            await executeAppAction(setGain(0.3, original));
            await executeAppAction(UNFREEZE_TRACK);
            await undo();
            await undo();
            await undo();
            expect(trackGain()).toBeCloseTo(original);
            expect(undoStore.value?.future).toHaveLength(3);
            recordingStartStore.set(true);
            notices.length = 0;

            await redo();

            expect(trackGain()).toBeCloseTo(original);
            expect(freezeStatus()).toBe('unfrozen');
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(3);
            expect(warnings()).toEqual([WARNING]);
        });

        describe('when the freeze entry is a one-entry action group, as an AI batch records it', () => {
            // Freeze and unfreeze run as singleton batches, so only a lone group can hold one. The
            // write runs without history and the grouped entry is committed by hand, in the shape
            // `freezeTrack` and `unfreezeTrack` describe.
            async function writeGroupedFreezeEntry(direction: 'freeze' | 'unfreeze'): Promise<void> {
                const before = captureFreezeStateSnapshot(trackStore.value!.tracks[0]!);
                const action = direction === 'freeze' ? FREEZE_TRACK : UNFREEZE_TRACK;
                await executeAppAction(action, { skipUndo: true });
                const after = captureFreezeStateSnapshot(trackStore.value!.tracks[0]!);
                const restore = (expected: typeof before, replacement: typeof before) =>
                    ({
                        type: 'restoreFreezeState',
                        payload: { trackId: 'freeze-track', expected, replacement },
                    }) as const;
                const entry = createUndoEntry(
                    'Grouped freeze change',
                    action,
                    restore(after, before),
                    'ai',
                    restore(before, after)
                );
                entry.groupId = 'group-a';
                commitUndoEntry(entry);
            }

            it('refuses the undo of a grouped unfreeze without reverting the gain change beneath it', async () => {
                const original = trackGain() ?? 0;
                await executeAppAction(FREEZE_TRACK);
                await executeAppAction(setGain(0.3, original));
                await writeGroupedFreezeEntry('unfreeze');
                expect(freezeStatus()).toBe('unfrozen');
                expect(undoStore.value?.past).toHaveLength(3);
                recordingStartStore.set(true);
                notices.length = 0;

                await undo();

                expect(trackGain()).toBeCloseTo(0.3);
                expect(freezeStatus()).toBe('unfrozen');
                expect(undoStore.value?.past).toHaveLength(3);
                expect(undoStore.value?.future).toHaveLength(0);
                expect(warnings()).toEqual([WARNING]);
            });

            it('refuses the redo of a grouped freeze without redoing the gain change behind it', async () => {
                const original = trackGain() ?? 0;
                await writeGroupedFreezeEntry('freeze');
                await executeAppAction(setGain(0.3, original));
                await undo();
                await undo();
                expect(freezeStatus()).toBe('unfrozen');
                expect(undoStore.value?.future).toHaveLength(2);
                recordingStartStore.set(true);
                notices.length = 0;

                await redo();

                expect(trackGain()).toBeCloseTo(original);
                expect(freezeStatus()).toBe('unfrozen');
                expect(undoStore.value?.past).toHaveLength(0);
                expect(undoStore.value?.future).toHaveLength(2);
                expect(warnings()).toEqual([WARNING]);
            });
        });
    });
});
