import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { prepareAutomationTimeOperation, prepareAutomationTimeStateRestore } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore as undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { prepareMidiGlobalTimeTransaction, prepareMidiTimeStateRestore } from '#/modules/MIDI/useCases';
import { prepareTimelineMapStateRestore, prepareTimelineMapTimeOperation } from '#/modules/Transport/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type Take, type TakeLane } from '../../../models/TakeLane';
import { gainEnvelopeStore } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore, type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { trackStore, type TrackStoreState } from '../../../stores/trackStore';
import { deleteTimeRange } from '../../../useCases/clipEditing/deleteTimeRange';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';
import { setTimeOperationDependencies } from '../../../useCases/timeOperations/timeOperationDependencies';
import { validateTakeLaneTransitionPlan } from '../../../useCases/timeOperations/validateTakeLaneTransitionPlan';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Project = {
    tracks: TrackStoreState;
    takeLanes: TakeLaneStoreState;
    midi: NonNullable<typeof midiStore.value>;
    automation: NonNullable<typeof automationStore.value>;
    gainEnvelopes: NonNullable<typeof gainEnvelopeStore.value>;
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

let stopProjectionBridge: () => void;

function lane(): TakeLane {
    const current = takeLaneStore.value?.lanes[0];
    if (!current) {
        throw new Error('Expected the comp lane');
    }
    return current;
}

function clips() {
    return trackStore.value?.tracks[0]?.clips ?? [];
}

function arrangeComp(startBeat: number, endBeat: number): Take {
    const clip = ClipDummy.create({
        id: 'source',
        trackId: 'track-1',
        type: 'audio',
        startBeat,
        endBeat,
        audioBufferId: 'source-buffer',
    });
    const take = createTake(clip.id, 'Original', startBeat, endBeat);
    trackStore.set({
        tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [clip] })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    takeLaneStore.set({
        lanes: [
            {
                ...createTakeLane('track-1'),
                takes: [take],
                activeCompRegions: [{ startBeat, endBeat, takeId: take.id }],
            },
        ],
    });
    flushAutomergeStorageWrites();
    return take;
}

function expectAuthority(): void {
    flushAutomergeStorageWrites();
    const project = getCrdtDoc<Project>('root');
    expect(project?.tracks.tracks[0]?.clips).toEqual(clips());
    expect(project?.takeLanes.lanes).toEqual(takeLaneStore.value?.lanes);
}

function coverage(): number[][] {
    return resolveClipsWithComping('track-1', clips()).map((clip) => [clip.startBeat, clip.endBeat]);
}

function arrangeJoinedOwners(): void {
    arrangeComp(0, 10);
    mutateCrdtDoc<Project>({
        id: 'root',
        changeFn: (project) => {
            project.midi = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
            project.automation = { lanes: [] };
            project.gainEnvelopes = { envelopes: {} };
            project.tracks.tracks[0]!.clips.push(
                ClipDummy.create({ id: 'gone', trackId: 'track-1', startBeat: 3, endBeat: 5 }),
                ClipDummy.create({ id: 'untouched', trackId: 'track-1', startBeat: 12, endBeat: 14 })
            );
            project.tracks.tracks.push(
                TrackDummy.create({
                    id: 'midi-track',
                    kind: 'midi',
                    clips: [
                        ClipDummy.create({
                            id: 'midi-source',
                            trackId: 'midi-track',
                            type: 'midi',
                            startBeat: 0,
                            endBeat: 10,
                        }),
                    ],
                })
            );
            project.midi.notesByClipId['midi-source'] = [
                { id: 'left', pitch: 60, startBeat: 1, duration: 0.5, velocity: 90 },
                { id: 'right', pitch: 64, startBeat: 8, duration: 0.5, velocity: 90 },
            ];
            project.automation.lanes.push({
                id: 'auto-gone',
                trackId: 'track-1',
                clipId: 'gone',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [{ beat: 1, value: 1, curve: 'linear', tension: 0 }],
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 2,
            });
            project.gainEnvelopes.envelopes.gone = { clipId: 'gone', points: [], enabled: true };
        },
    });
}

async function removeTime(route: 'global' | 'selected', startBeat: number, endBeat: number): Promise<void> {
    if (route === 'global') {
        await executeAppAction({ type: 'deleteTime', payload: { startBeat, endBeat } });
    } else {
        // This is the selected-range UI entry; its callbacks replay through Command undo/redo.
        deleteTimeRange(startBeat, endBeat, ['track-1']);
        flushAutomergeStorageWrites();
    }
    expect(undoStore.value?.past).toHaveLength(1);
}

async function peerComp(take: Take, startBeat: number, endBeat: number): Promise<void> {
    const history = undoStore.value;
    // Inbound document edits have no local undo entry, and the projection bridge
    // must expose the new take before the real comp handler captures its patch.
    mutateCrdtDoc<Project>({
        id: 'root',
        changeFn: (project) => {
            project.takeLanes.lanes[0]!.takes.push(take);
        },
    });
    expect(lane().takes).toContainEqual(take);
    await executeAppAction(
        { type: 'setCompRegion', payload: { trackId: 'track-1', takeId: take.id, startBeat, endBeat } },
        { skipUndo: true }
    );
    expectAuthority();
    expect(undoStore.value).toEqual(history);
}

describe('Delete Time take ownership through Command and CRDT', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('delete time comp integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setTimeOperationDependencies({
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore,
            prepareTimelineMapTimeOperation,
            prepareTimelineMapStateRestore,
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        setTimeOperationDependencies(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('still rejects a transition with a real overlap smaller than one fractional rounding step', () => {
        const take = arrangeComp(0.3, 4.3);
        const overlapping = [
            { startBeat: 0.3, endBeat: 0.4, takeId: take.id },
            { startBeat: 0.3999999999999999, endBeat: 2.4, takeId: take.id },
        ];
        expect(
            validateTakeLaneTransitionPlan({
                version: 1,
                appliedEffect: 'restore',
                removedClipIds: [],
                retiredLanes: [],
                reKeyedLanes: [
                    {
                        laneId: lane().id,
                        trackId: 'track-1',
                        takesBefore: [take],
                        takesAfter: [take],
                        regionsBefore: overlapping,
                        regionsAfter: overlapping,
                    },
                ],
            })
        ).toBeNull();
        expectAuthority();
    });

    it.each(['global', 'selected'] as const)(
        '%s undo removes peer facets on the removed fragment and preserves surviving peer choices',
        async (route) => {
            const original = arrangeComp(0, 10);
            await removeTime(route, 2, 6);
            const right = clips().find((clip) => clip.id !== 'source');
            if (!right) {
                throw new Error('Expected the minted right fragment');
            }
            const orphan = createTake(right.id, 'Peer right fragment', right.startBeat, right.endBeat);
            await peerComp(orphan, right.startBeat + 1, right.endBeat - 1);
            const survivor = { ...createTake('source', 'Peer surviving clip', 0, 2), selected: true };
            await peerComp(survivor, 0.5, 1.5);
            mutateCrdtDoc<Project>({
                id: 'root',
                changeFn: (project) => {
                    project.takeLanes.lanes[0]!.takes.find((take) => take.id === original.id)!.selected = true;
                },
            });

            await undo();

            expect(undoStore.value?.past).toEqual([]);
            expect(undoStore.value?.future).toHaveLength(1);
            expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['source', 0, 10]]);
            expect(lane().takes).toEqual([{ ...original, selected: true }, survivor]);
            expect(lane().activeCompRegions).toContainEqual({ startBeat: 0.5, endBeat: 1.5, takeId: survivor.id });
            expect(lane().activeCompRegions.every((region) => region.takeId !== orphan.id)).toBe(true);
            expect(coverage()).toEqual([
                [0, 0.5],
                [0.5, 1.5],
                [1.5, 2],
                [2, 10],
            ]);
            expectAuthority();

            const afterUndo = createTake('source', 'Peer after undo', 0, 2);
            await peerComp(afterUndo, 1.6, 1.8);
            await redo();
            expect(lane().takes).toContainEqual(survivor);
            expect(lane().takes).toContainEqual(afterUndo);
            expect(lane().activeCompRegions).toContainEqual({ startBeat: 1.6, endBeat: 1.8, takeId: afterUndo.id });
            expect(lane().takes.find((take) => take.id === original.id)?.selected).toBe(true);
            expect(lane().takes.some((take) => take.id === orphan.id)).toBe(false);
            expectAuthority();
        }
    );

    it.each(['global', 'selected'] as const)(
        '%s keeps exact fractional fragment edges through undo and redo',
        async (route) => {
            const original = arrangeComp(0.3, 4.3);

            await removeTime(route, 0.4, 2.3);

            const afterClips = structuredClone(clips());
            const afterLane = structuredClone(lane());
            const edges = afterClips.map((clip) => [clip.startBeat, clip.endBeat]);
            expect(edges[0]).toEqual([0.3, 0.4]);
            expect(edges[1]?.[0]).toBe(route === 'global' ? 0.4 : 2.3);
            expect(lane().takes.map((take) => [take.startBeat, take.endBeat])).toEqual(edges);
            expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat])).toEqual(edges);
            expect(lane().activeCompRegions[0]!.endBeat).toBeLessThanOrEqual(lane().activeCompRegions[1]!.startBeat);
            expect(coverage()).toEqual(edges);
            expectAuthority();

            await undo();
            expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['source', 0.3, 4.3]]);
            expect(lane().takes).toEqual([original]);
            expect(lane().activeCompRegions).toEqual([{ startBeat: 0.3, endBeat: 4.3, takeId: original.id }]);
            expect(coverage()).toEqual([[0.3, 4.3]]);
            expectAuthority();

            await redo();
            expect(clips()).toEqual(afterClips);
            expect(lane()).toEqual(afterLane);
            expect(coverage()).toEqual(edges);
            expectAuthority();
        }
    );

    it('selected keeps exact fractional fragment edges through its UI entry', async () => {
        arrangeComp(0.3, 4.3);
        await removeTime('selected', 0.4, 2.3);
        const edges = clips().map((clip) => [clip.startBeat, clip.endBeat]);
        expect(edges).toEqual([
            [0.3, 0.4],
            [2.3, 4.3],
        ]);
        expect(lane().takes.map((take) => [take.startBeat, take.endBeat])).toEqual(edges);
        expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat])).toEqual(edges);
        expect(coverage()).toEqual(edges);
        expectAuthority();
    });

    it('selected undo survives no-peer CRDT settlement and retains its history and buffer metadata', async () => {
        arrangeComp(0, 10);
        const originalClips = structuredClone(clips());
        const originalLane = structuredClone(lane());
        const writes = vi.spyOn(trackStore, 'set');
        await removeTime('selected', 2, 6);
        const published = writes.mock.calls[0]?.[0];
        expect(published?.tracks).toEqual(trackStore.value?.tracks);
        expect(trackStore.value).not.toBe(published);
        const entry = undoStore.value?.past[0];
        const deletedClips = structuredClone(clips());
        const deletedLane = structuredClone(lane());
        await undo();
        expect(entry?.kind).toBe('callback');
        if (entry?.kind !== 'callback') {
            throw new Error('Expected callback history');
        }
        expect(entry.restoresBufferIds).toEqual(['source-buffer']);
        expect(clips()).toEqual(originalClips);
        expect(lane()).toEqual(originalLane);
        expect(coverage()).toEqual([[0, 10]]);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toEqual([entry]);
        expectAuthority();
        await redo();
        expect(clips()).toEqual(deletedClips);
        expect(lane()).toEqual(deletedLane);
        expect(undoStore.value?.past).toEqual([entry]);
        expect(undoStore.value?.future).toEqual([]);
        expectAuthority();
    });

    it('selected undo refuses changed clip geometry without touching authority or history', async () => {
        arrangeComp(0, 10);
        await removeTime('selected', 2, 6);
        mutateCrdtDoc<Project>({
            id: 'root',
            changeFn: (project) => {
                project.tracks.tracks[0]!.clips[0]!.endBeat = 1.75;
            },
        });
        const before = structuredClone(getCrdtDoc<Project>('root'));
        const history = undoStore.value;
        await expect(undo()).rejects.toThrow();
        expect(getCrdtDoc<Project>('root')).toEqual(before);
        expect(undoStore.value).toBe(history);
        expectAuthority();
    });

    it.each(['global', 'selected'] as const)(
        '%s undo retires later fragment facets when the initial lane was empty',
        async (route) => {
            arrangeComp(0, 10);
            takeLaneStore.set({ lanes: [{ ...lane(), takes: [], activeCompRegions: [] }] });
            flushAutomergeStorageWrites();
            await removeTime(route, 2, 6);
            const right = clips().find((clip) => clip.id !== 'source');
            if (!right) {
                throw new Error('Expected the minted right fragment');
            }
            const orphan = createTake(right.id, 'Peer fragment', right.startBeat, right.endBeat);
            await peerComp(orphan, right.startBeat + 1, right.endBeat - 1);
            const survivor = { ...createTake('source', 'Peer survivor', 0, 2), selected: true };
            await peerComp(survivor, 0.5, 1.5);
            const deletedClips = structuredClone(clips());
            await undo();
            expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['source', 0, 10]]);
            expect(lane().takes).toEqual([survivor]);
            expect(lane().activeCompRegions).toEqual([{ startBeat: 0.5, endBeat: 1.5, takeId: survivor.id }]);
            expect(coverage()).toEqual([
                [0, 0.5],
                [0.5, 1.5],
                [1.5, 10],
            ]);
            expectAuthority();
            await redo();
            expect(clips()).toEqual(deletedClips);
            expect(lane().takes).toEqual([survivor]);
            expect(lane().activeCompRegions).toEqual([{ startBeat: 0.5, endBeat: 1.5, takeId: survivor.id }]);
            expectAuthority();
        }
    );

    it.each([
        ['global', false],
        ['selected', false],
        ['global', true],
        ['selected', true],
    ] as const)(
        '%s compensates live-facet retirement after Arrangement publication fails (published=%s)',
        async (route, publishBeforeThrow) => {
            arrangeComp(0, 10);
            takeLaneStore.set({ lanes: [{ ...lane(), takes: [], activeCompRegions: [] }] });
            flushAutomergeStorageWrites();
            await removeTime(route, 2, 6);
            const right = clips().find((clip) => clip.id !== 'source');
            if (!right) {
                throw new Error('Expected the minted right fragment');
            }
            await peerComp(
                createTake(right.id, 'Peer fragment', right.startBeat, right.endBeat),
                right.startBeat + 1,
                right.endBeat - 1
            );
            const survivor = { ...createTake('source', 'Peer survivor', 0, 2), selected: true };
            await peerComp(survivor, 0.5, 1.5);
            const before = structuredClone(getCrdtDoc<Project>('root'));
            const beforeClips = structuredClone(clips());
            const beforeLane = structuredClone(lane());
            const history = undoStore.value;
            const takeWrites = vi.spyOn(takeLaneStore, 'set');
            const publishTrack = trackStore.set.bind(trackStore);
            vi.spyOn(trackStore, 'set').mockImplementationOnce((state) => {
                if (publishBeforeThrow) {
                    publishTrack(state);
                    throw new Error('Injected failure after Arrangement publication');
                }
            });
            await expect(undo()).rejects.toThrow();
            expect(takeWrites.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(takeWrites.mock.calls[0]?.[0]?.lanes[0]?.takes).toEqual([survivor]);
            expect(clips()).toEqual(beforeClips);
            expect(lane()).toEqual(beforeLane);
            expect(undoStore.value).toBe(history);
            expectAuthority();
            expect(getCrdtDoc<Project>('root')).toEqual(before);
        }
    );

    it('selected settled replay joins real MIDI, Automation and satellites while preserving unrelated satellites', async () => {
        arrangeJoinedOwners();
        const originalTracks = structuredClone(trackStore.value);
        const originalMidi = structuredClone(midiStore.value);
        const originalAutomation = structuredClone(automationStore.value);
        deleteTimeRange(2, 6, ['track-1', 'midi-track']);
        flushAutomergeStorageWrites();
        expect(midiStore.value).not.toEqual(originalMidi);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(gainEnvelopeStore.value?.envelopes.gone).toBeUndefined();
        const deletedTracks = structuredClone(trackStore.value);
        const deletedMidi = structuredClone(midiStore.value);
        const peerEnvelope = {
            clipId: 'untouched',
            points: [{ id: 'peer-point', beatOffset: 1, gainDb: -3 }],
            enabled: true,
        };
        mutateCrdtDoc<Project>({
            id: 'root',
            changeFn: (project) => {
                project.gainEnvelopes.envelopes.untouched = peerEnvelope;
            },
        });
        await undo();
        expect(trackStore.value).toEqual(originalTracks);
        expect(midiStore.value).toEqual(originalMidi);
        expect(automationStore.value).toEqual(originalAutomation);
        expect(gainEnvelopeStore.value?.envelopes.gone).toEqual({ clipId: 'gone', points: [], enabled: true });
        expect(gainEnvelopeStore.value?.envelopes.untouched).toEqual(peerEnvelope);
        expectAuthority();
        expect(getCrdtDoc<Project>('root')?.midi).toEqual(midiStore.value);
        expect(getCrdtDoc<Project>('root')?.automation).toEqual(automationStore.value);
        expect(getCrdtDoc<Project>('root')?.gainEnvelopes).toEqual(gainEnvelopeStore.value);
        await redo();
        expect(trackStore.value).toEqual(deletedTracks);
        expect(midiStore.value).toEqual(deletedMidi);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(gainEnvelopeStore.value?.envelopes.gone).toBeUndefined();
        expect(gainEnvelopeStore.value?.envelopes.untouched).toEqual(peerEnvelope);
        expectAuthority();
        expect(getCrdtDoc<Project>('root')?.midi).toEqual(midiStore.value);
        expect(getCrdtDoc<Project>('root')?.automation).toEqual(automationStore.value);
    });

    it.each(['midi', 'automation'] as const)(
        'selected refuses a changed %s owner without overwriting peer truth',
        async (owner) => {
            arrangeJoinedOwners();
            deleteTimeRange(2, 6, ['track-1', 'midi-track']);
            flushAutomergeStorageWrites();
            mutateCrdtDoc<Project>({
                id: 'root',
                changeFn: (project) => {
                    if (owner === 'midi') {
                        project.midi.notesByClipId['midi-source']![0]!.velocity = 75;
                    } else {
                        project.automation.lanes.push({
                            id: 'peer',
                            trackId: 'track-1',
                            parameterId: 'pan',
                            parameterName: 'Pan',
                            points: [],
                            objects: [],
                            visible: true,
                            enabled: true,
                            collapsed: false,
                            minValue: -1,
                            maxValue: 1,
                        });
                    }
                },
            });
            const before = structuredClone(getCrdtDoc<Project>('root'));
            const history = undoStore.value;
            await expect(undo()).rejects.toThrow('Delete Time Range undo was not applied');
            expectAuthority();
            expect(getCrdtDoc<Project>('root')).toEqual(before);
            expect(undoStore.value).toBe(history);
        }
    );
});
