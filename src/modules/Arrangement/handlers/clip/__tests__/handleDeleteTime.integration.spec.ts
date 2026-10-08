import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    getAutomationHandlers,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore as undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
    registerProductionCommandHandlers,
    isExecutableAppActionType,
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
    getDrumPreviewBranchHandlers,
} from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import {
    getMidiNoteTransformHandlers,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
} from '#/modules/MIDI/useCases';
import { tempoMapStore } from '#/modules/Transport/stores';
import {
    getTransportHandlers,
    prepareTimelineMapStateRestore,
    prepareTimelineMapTimeOperation,
} from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';

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
import { isDeleteTimeSessionEntry, isRestoreTimeOperationSessionPayload } from '../validateClipEditSessionEntries';

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
            project.midi = {
                probabilitySeed: defaultMidiStoreState.probabilitySeed,
                notesByClipId: {},
                ccByClipId: {},
                pitchBendByClipId: {},
            };
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

describe('Time operation take ownership through Command and CRDT', () => {
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

    it('persists a real Delete Time entry across production hydration and replays it', async () => {
        expect(isExecutableAppActionType('deleteTime')).toBe(false);
        clearHandlerRegistry();
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
        arrangeComp(0, 10);
        await executeAppAction({ type: 'deleteTime', payload: { startBeat: 2, endBeat: 6 } });
        expect(isDeleteTimeSessionEntry(undoStore.value?.past[0] as HandlerSessionActionEntry)).toBe(true);
        const liveEntry = undoStore.value?.past[0] as HandlerSessionActionEntry;
        expect(isRestoreTimeOperationSessionPayload(liveEntry.inverseAction?.payload)).toBe(true);
        expect(isRestoreTimeOperationSessionPayload(liveEntry.redoAction?.payload)).toBe(true);
        await vi.waitFor(() => {
            const raw = sessionStorage.getItem('sourdaw-undo-session');
            expect(raw).not.toBeNull();
            const stored = JSON.parse(raw!) as { past: { inverseAction: { type: string } }[] };
            expect(stored.past).toHaveLength(1);
            expect(stored.past[0]?.inverseAction.type).toBe('restoreTimeOperationState');
        });
        clearHandlerRegistry();
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clips().map((clip) => [clip.startBeat, clip.endBeat])).toEqual([[0, 10]]);
        await redo();
        expect(clips().map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [0, 2],
            [2, 6],
        ]);
        expectAuthority();
    });

    it.each(['global', 'selected'] as const)(
        '%s preserves a legacy take media depth through a tempo seam, settled Undo and Redo',
        async (route) => {
            tempoMapStore.set({
                changes: [
                    { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
                ],
            });
            flushAutomergeStorageWrites();
            if (route === 'global') {
                clearHandlerRegistry();
                registerProductionCommandHandlers([
                    getArrangementHandlers(),
                    getAudioRenderingHandlers(),
                    getAutomationHandlers(),
                    getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
                    getMidiNoteTransformHandlers(),
                    getTransportHandlers(),
                    getYeastHandlers(),
                ]);
            }
            const original = arrangeComp(0, 10);
            const legacy = { ...original, sourceOffsetBeats: 2 };
            takeLaneStore.set({ lanes: [{ ...lane(), takes: [legacy] }] });
            flushAutomergeStorageWrites();

            await removeTime(route, 2, 6);
            const right = clips().find((clip) => clip.id !== 'source');
            const rightTake = lane().takes.find((take) => take.clipId === right?.id);
            expect(rightTake).toMatchObject({ sourceOffsetSeconds: 1, sourceOffsetBeats: 2 });
            expect(
                resolveClipsWithComping('track-1', clips()).find((clip) => clip.id === right?.id)?.audioOffsetSeconds
            ).toBe(5);
            expectAuthority();

            if (route === 'global') {
                await vi.waitFor(() => {
                    expect(JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}').past).toHaveLength(1);
                });
                clearHandlerRegistry();
                registerProductionCommandHandlers([
                    getArrangementHandlers(),
                    getAudioRenderingHandlers(),
                    getAutomationHandlers(),
                    getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
                    getMidiNoteTransformHandlers(),
                    getTransportHandlers(),
                    getYeastHandlers(),
                ]);
            }
            await undo();
            expect(lane().takes).toEqual([legacy]);
            expect(lane().takes[0]).not.toHaveProperty('sourceOffsetSeconds');
            expectAuthority();
            await redo();
            expect(lane().takes.find((take) => take.clipId === right?.id)).toEqual(rightTake);
            expectAuthority();
        }
    );

    it.each(['global', 'selected'] as const)(
        '%s Undo preserves a peer source-depth edit on a surviving take',
        async (route) => {
            if (route === 'global') {
                clearHandlerRegistry();
                registerProductionCommandHandlers([
                    getArrangementHandlers(),
                    getAudioRenderingHandlers(),
                    getAutomationHandlers(),
                    getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
                    getMidiNoteTransformHandlers(),
                    getTransportHandlers(),
                    getYeastHandlers(),
                ]);
            }
            const original = arrangeComp(0, 10);
            takeLaneStore.set({ lanes: [{ ...lane(), takes: [{ ...original, sourceOffsetBeats: 2 }] }] });
            flushAutomergeStorageWrites();
            await removeTime(route, 2, 6);
            expect(lane().takes.find((take) => take.id === original.id)?.sourceOffsetSeconds).toBe(1);

            mutateCrdtDoc<Project>({
                id: 'root',
                changeFn: (project) => {
                    project.takeLanes.lanes[0]!.takes.find((take) => take.id === original.id)!.sourceOffsetSeconds = 7;
                },
            });
            expect(lane().takes.find((take) => take.id === original.id)?.sourceOffsetSeconds).toBe(7);
            expect(
                getCrdtDoc<Project>('root')?.takeLanes.lanes[0]?.takes.find((take) => take.id === original.id)
                    ?.sourceOffsetSeconds
            ).toBe(7);
            await undo();
            expect(lane().takes.find((take) => take.id === original.id)).toMatchObject({ sourceOffsetSeconds: 7 });
            expect(
                getCrdtDoc<Project>('root')?.takeLanes.lanes[0]?.takes.find((take) => take.id === original.id)
                    ?.sourceOffsetSeconds
            ).toBe(7);
            expectAuthority();
            await redo();
            expect(lane().takes.find((take) => take.id === original.id)).toMatchObject({ sourceOffsetSeconds: 7 });
            expect(
                getCrdtDoc<Project>('root')?.takeLanes.lanes[0]?.takes.find((take) => take.id === original.id)
                    ?.sourceOffsetSeconds
            ).toBe(7);
            expectAuthority();
        }
    );

    it.each([
        {
            name: 'insert',
            action: { type: 'insertTime' as const, payload: { atBeat: 1, durationBeats: 4 } },
            targetBeat: 6,
        },
        {
            name: 'duplicate',
            action: { type: 'duplicateTimeRange' as const, payload: { startBeat: 2, endBeat: 4 } },
            targetBeat: 4,
        },
    ])(
        '$name saves a moved comp with its original media depth and replays it after hydration',
        async ({ action, targetBeat }) => {
            tempoMapStore.set({
                changes: [
                    { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
                ],
            });
            flushAutomergeStorageWrites();
            clearHandlerRegistry();
            registerProductionCommandHandlers([
                getArrangementHandlers(),
                getAudioRenderingHandlers(),
                getAutomationHandlers(),
                getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
                getMidiNoteTransformHandlers(),
                getTransportHandlers(),
                getYeastHandlers(),
            ]);
            const original = arrangeComp(2, 4);
            const legacy = { ...original, sourceOffsetBeats: 2 };
            takeLaneStore.set({ lanes: [{ ...lane(), takes: [legacy] }] });
            flushAutomergeStorageWrites();

            await executeAppAction(action);
            const target = clips().find((clip) => clip.startBeat === targetBeat);
            const targetTake = lane().takes.find((take) => take.clipId === target?.id && take.startBeat === targetBeat);
            expect(targetTake).toMatchObject({ sourceOffsetSeconds: 1, sourceOffsetBeats: 2 });
            expect(lane().activeCompRegions).toContainEqual({
                startBeat: targetBeat,
                endBeat: targetBeat + 2,
                takeId: targetTake?.id,
            });
            expect(
                resolveClipsWithComping('track-1', clips()).find((clip) => clip.startBeat === targetBeat)
                    ?.audioOffsetSeconds
            ).toBe(1);
            expectAuthority();
            expect(undoStore.value?.past).toHaveLength(1);
            const liveEntry = undoStore.value?.past[0] as HandlerSessionActionEntry;
            expect(isRestoreTimeOperationSessionPayload(liveEntry.inverseAction?.payload)).toBe(true);
            expect(isRestoreTimeOperationSessionPayload(liveEntry.redoAction?.payload)).toBe(true);
            await vi.waitFor(() => {
                expect(JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}').past).toHaveLength(1);
            });
            clearHandlerRegistry();
            registerProductionCommandHandlers([
                getArrangementHandlers(),
                getAudioRenderingHandlers(),
                getAutomationHandlers(),
                getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
                getMidiNoteTransformHandlers(),
                getTransportHandlers(),
                getYeastHandlers(),
            ]);
            await undo();
            expect(lane().takes).toEqual([legacy]);
            expect(lane().takes[0]).not.toHaveProperty('sourceOffsetSeconds');
            expectAuthority();
            await redo();
            expect(lane().takes.find((take) => take.clipId === target?.id && take.startBeat === targetBeat)).toEqual(
                targetTake
            );
            expectAuthority();

            mutateCrdtDoc<Project>({
                id: 'root',
                changeFn: (project) => {
                    project.tracks.tracks[0]!.clips.find((clip) => clip.id === target?.id)!.endBeat -= 0.25;
                },
            });
            const peerRaw = structuredClone(getCrdtDoc<Project>('root'));
            const peerTracks = structuredClone(trackStore.value);
            const peerLanes = structuredClone(takeLaneStore.value);
            const history = undoStore.value;
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc<Project>('root')).toEqual(peerRaw);
            expect(trackStore.value).toEqual(peerTracks);
            expect(takeLaneStore.value).toEqual(peerLanes);
            expect(undoStore.value).toBe(history);
        }
    );

    it.each([
        { name: 'insert', action: { type: 'insertTime' as const, payload: { atBeat: 1, durationBeats: 4 } } },
        { name: 'duplicate', action: { type: 'duplicateTimeRange' as const, payload: { startBeat: 2, endBeat: 4 } } },
    ])('$name drops malformed saved global-time captures without project writes', async ({ action }) => {
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
        const original = arrangeComp(2, 4);
        takeLaneStore.set({ lanes: [{ ...lane(), takes: [{ ...original, sourceOffsetBeats: 2 }] }] });
        flushAutomergeStorageWrites();
        await executeAppAction(action);
        expectAuthority();
        await vi.waitFor(() => {
            expect(JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}').past).toHaveLength(1);
        });
        const saved = sessionStorage.getItem('sourdaw-undo-session');
        if (!saved) {
            throw new Error('Expected a saved producer entry');
        }
        for (const corruption of ['scope', 'reverse', 'nested-source', 'forward'] as const) {
            const stored = JSON.parse(saved) as {
                past: {
                    action: { payload: { atBeat?: number; startBeat?: number; endBeat?: number } };
                    inverseAction: {
                        payload: {
                            plan: {
                                scope: string;
                                local: { expected: { trackState: unknown } };
                                takeLanes: { reKeyedLanes: { takesAfter: Take[] }[] };
                            };
                        };
                    };
                    redoAction: { payload: { plan: { local: { expected: { trackState: unknown } } } } };
                }[];
            };
            const entry = stored.past[0]!;
            if (corruption === 'scope') {
                entry.inverseAction.payload.plan.scope = 'selected-range';
            } else if (corruption === 'reverse') {
                entry.redoAction.payload.plan.local.expected.trackState = structuredClone(
                    entry.inverseAction.payload.plan.local.expected.trackState
                );
            } else if (corruption === 'nested-source') {
                const source = entry.inverseAction.payload.plan.takeLanes.reKeyedLanes[0]!.takesAfter.find((take) =>
                    Object.hasOwn(take, 'sourceOffsetSeconds')
                );
                if (!source) {
                    throw new Error('Expected the captured canonical take source');
                }
                Object.assign(source, { sourceOffsetSeconds: 'malformed' });
            } else if (action.type === 'insertTime') {
                entry.action.payload.atBeat = -1;
            } else {
                entry.action.payload.endBeat = entry.action.payload.startBeat;
            }
            sessionStorage.setItem('sourdaw-undo-session', JSON.stringify(stored));
            const beforeRaw = structuredClone(getCrdtDoc<Project>('root'));
            const beforeTracks = structuredClone(trackStore.value);
            const beforeLanes = structuredClone(takeLaneStore.value);
            clearHandlerRegistry();
            registerProductionCommandHandlers([
                getArrangementHandlers(),
                getAudioRenderingHandlers(),
                getAutomationHandlers(),
                getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
                getMidiNoteTransformHandlers(),
                getTransportHandlers(),
                getYeastHandlers(),
            ]);
            expect(undoStore.value?.past, corruption).toEqual([]);
            expect(undoStore.value?.future, corruption).toEqual([]);
            expect(getCrdtDoc<Project>('root'), corruption).toEqual(beforeRaw);
            expect(trackStore.value, corruption).toEqual(beforeTracks);
            expect(takeLaneStore.value, corruption).toEqual(beforeLanes);
            expectAuthority();
        }
    });

    it.each([
        { name: 'bogus inverse scope', leg: 'inverseAction', scope: 'other-scope' },
        { name: 'mismatched redo scope', leg: 'redoAction', scope: 'selected-range' },
    ])('drops a Delete Time entry with $name before a project write', async ({ leg, scope }) => {
        clearHandlerRegistry();
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
        arrangeComp(0, 10);
        await executeAppAction({ type: 'deleteTime', payload: { startBeat: 2, endBeat: 6 } });
        await vi.waitFor(() => {
            const raw = sessionStorage.getItem('sourdaw-undo-session');
            expect(raw).not.toBeNull();
            const stored = JSON.parse(raw!) as { past: unknown[] };
            expect(stored.past).toHaveLength(1);
        });
        const raw = sessionStorage.getItem('sourdaw-undo-session');
        const stored = JSON.parse(raw!) as {
            past: {
                inverseAction: { payload: { plan: { scope: string } } };
                redoAction: { payload: { plan: { scope: string } } };
            }[];
        };
        stored.past[0]![leg as 'inverseAction' | 'redoAction'].payload.plan.scope = scope;
        sessionStorage.setItem('sourdaw-undo-session', JSON.stringify(stored));
        const before = structuredClone(getCrdtDoc<Project>('root'));
        clearHandlerRegistry();
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
        expect(undoStore.value?.past).toEqual([]);
        expect(getCrdtDoc<Project>('root')).toEqual(before);
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

    it.each(['global', 'selected'] as const)(
        '%s undo retains an initially empty lane after retiring its sole peer fragment take',
        async (route) => {
            arrangeComp(0, 10);
            const emptyLane = { ...lane(), takes: [], activeCompRegions: [] };
            takeLaneStore.set({ lanes: [emptyLane] });
            flushAutomergeStorageWrites();
            const originalClips = structuredClone(clips());
            await removeTime(route, 2, 6);
            const right = clips().find((clip) => clip.id !== 'source');
            if (!right) {
                throw new Error('Expected the minted right fragment');
            }
            await peerComp(
                createTake(right.id, 'Only peer fragment take', right.startBeat, right.endBeat),
                right.startBeat + 1,
                right.endBeat - 1
            );
            const deletedClips = structuredClone(clips());
            const entry = undoStore.value?.past[0];

            await undo();
            expectAuthority();

            expect(clips()).toEqual(originalClips);
            expect(takeLaneStore.value?.lanes).toEqual([emptyLane]);
            expect(getCrdtDoc<Project>('root')?.takeLanes.lanes).toEqual([emptyLane]);
            expect(coverage()).toEqual([[0, 10]]);
            expect(undoStore.value?.past).toEqual([]);
            expect(undoStore.value?.future).toEqual([entry]);

            await redo();
            expectAuthority();

            expect(clips()).toEqual(deletedClips);
            expect(takeLaneStore.value?.lanes).toEqual([emptyLane]);
            expect(getCrdtDoc<Project>('root')?.takeLanes.lanes).toEqual([emptyLane]);
            let expectedCoverage = [
                [0, 2],
                [6, 10],
            ];
            if (route === 'global') {
                expectedCoverage = [
                    [0, 2],
                    [2, 6],
                ];
            }
            expect(coverage()).toEqual(expectedCoverage);
            expect(undoStore.value?.past).toEqual([entry]);
            expect(undoStore.value?.future).toEqual([]);
        }
    );

    it.each([
        ['global', false, false],
        ['selected', false, false],
        ['global', true, false],
        ['selected', true, false],
        ['global', false, true],
        ['selected', false, true],
        ['global', true, true],
        ['selected', true, true],
    ] as const)(
        '%s compensates live-facet retirement after Arrangement publication fails (published=%s, sole take=%s)',
        async (route, publishBeforeThrow, soleTake) => {
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
            if (!soleTake) {
                await peerComp(survivor, 0.5, 1.5);
            }
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
            expect(takeWrites.mock.calls[0]?.[0]?.lanes[0]).toEqual({
                ...beforeLane,
                takes: soleTake ? [] : [survivor],
                activeCompRegions: soleTake ? [] : [{ startBeat: 0.5, endBeat: 1.5, takeId: survivor.id }],
            });
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
