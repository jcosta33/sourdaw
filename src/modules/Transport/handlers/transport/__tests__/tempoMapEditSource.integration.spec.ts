import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { type Clip, type Track, gainEnvelopeStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import {
    getArrangementHandlers,
    isTempoAudioSourceTransition,
    prepareAudioSourcesForTempoChange,
    resolveClipsWithComping,
} from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import {
    createAutomationLane,
    getAutomationHandlers,
    getAutomationLanes,
    restoreAutomationLanes,
    restoreAutomationSnapshot,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeAppAction,
    executeAppActionBatch,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    serializeVersionedCommandEnvelope,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    hasCrdtDoc,
    loadCrdtProject,
    mutateCrdtDoc,
    persistCrdtProject,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    sessionUndoWitnessStampPort,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { initProjectDirtyTracking } from '#/modules/Project/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { getYeastHandlers } from '#/modules/Yeast/useCases';

import { tempoMapStore } from '../../../stores/tempoMapStore';
import { tempoProjectRevisionStore } from '../../../stores/tempoProjectRevisionStore';
import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../../useCases/getTransportHandlers';
import { tempoSourceDependencies } from '../../../useCases/tempoSourceDependencies';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const legacyClip: Clip = {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Legacy source',
    startBeat: 8,
    endBeat: 12,
    type: 'audio',
    audioBufferId: 'source-buffer',
    audioOffsetBeats: 2,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#000',
    locked: false,
    muted: false,
};

const track: Track = {
    id: 'track-1',
    name: 'Audio',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: '#000',
    clips: [legacyClip],
    devices: [],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 80,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    midiFx: [],
};

function registerProductionHandlers(): void {
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

describe('tempo map edit preserves canonical audio source', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('tempo map source integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        sessionStorage.removeItem('sourdaw-undo-session');
        registerHandlerMap(getTransportHandlers());
        tempoSourceDependencies.set({
            prepare: prepareAudioSourcesForTempoChange,
            isTransition: isTempoAudioSourceTransition,
        });
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        trackStore.set({ tracks: [structuredClone(track)], selectedTrackId: 'track-1', ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        gainEnvelopeStore.set({ envelopes: {} });
        restoreAutomationSnapshot({ lanes: [] });
        midiStore.set(structuredClone(defaultMidiStoreState));
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        tempoSourceDependencies.set(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('adds an event before a legacy clip without changing its media entry, then restores exact absence', async () => {
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        flushAutomergeStorageWrites();
        expect(tempoMapStore.value?.changes).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(
            getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.clips[0]?.audioOffsetSeconds
        ).toBe(1);
        expect(undoHistoryStore.value?.past).toHaveLength(1);

        await undo();
        expect(tempoMapStore.value?.changes).toEqual([]);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        await redo();
        expect(tempoMapStore.value?.changes[0]?.id).toBeTruthy();
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
    });

    it('replays a saved tempo then trim group from its committed prefix with exact legacy absence', async () => {
        clearHandlerRegistry();
        registerProductionHandlers();
        trackStore.set({
            ...trackStore.value!,
            tracks: [
                {
                    ...trackStore.value!.tracks[0]!,
                    alternatives: [
                        {
                            id: 'inactive-alt',
                            name: 'Inactive',
                            clips: [{ ...legacyClip, id: 'inactive', audioOffsetBeats: 4 }],
                        },
                    ],
                },
            ],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'clip-1',
                            name: 'Take',
                            startBeat: 8,
                            endBeat: 12,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [],
                },
            ],
        });
        flushAutomergeStorageWrites();
        const before = structuredClone(trackStore.value);
        const beforeTakes = structuredClone(takeLaneStore.value);
        const result = await executeAppActionBatch(
            [
                { type: 'setTempo', payload: { bpm: 60 } },
                { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 9 } },
            ],
            { source: 'manual', groupId: 'tempo-trim-prefix' }
        );
        expect(result.status).toBe('committed');
        expect(transportStore.value?.tempo).toBe(60);
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({ startBeat: 9, audioOffsetSeconds: 2 });
        const after = structuredClone(trackStore.value);
        const afterTakes = structuredClone(takeLaneStore.value);
        expect(after?.tracks[0]?.alternatives[0]?.clips[0]?.audioOffsetSeconds).toBe(2);
        expect(afterTakes?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(1);
        const assertRaw = () => {
            const raw = getCrdtDoc<{
                tracks: NonNullable<typeof trackStore.value>;
                transport: NonNullable<typeof transportStore.value>;
                takeLanes: NonNullable<typeof takeLaneStore.value>;
            }>('root');
            expect(raw?.tracks.tracks[0]?.clips).toEqual(trackStore.value?.tracks[0]?.clips);
            expect(raw?.transport.tempo).toBe(transportStore.value?.tempo);
            expect(raw?.tracks.tracks[0]?.alternatives[0]?.clips).toEqual(
                trackStore.value?.tracks[0]?.alternatives[0]?.clips
            );
            expect(raw?.takeLanes).toEqual(takeLaneStore.value);
        };
        assertRaw();
        await vi.waitFor(() => {
            const saved: unknown = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}');
            expect(saved).toMatchObject({ past: [expect.anything(), expect.anything()] });
        });
        clearHandlerRegistry();
        registerProductionHandlers();
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        for (const cycle of [1, 2]) {
            expect((await undo()).headConsumed, `Undo cycle ${cycle}`).toBe(true);
            expect(transportStore.value?.tempo).toBe(120);
            expect(trackStore.value).toEqual(before);
            expect(takeLaneStore.value).toEqual(beforeTakes);
            expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
            expect(undoHistoryStore.value?.past).toHaveLength(0);
            expect(undoHistoryStore.value?.future).toHaveLength(2);
            assertRaw();
            await redo();
            expect(transportStore.value?.tempo).toBe(60);
            expect(trackStore.value).toEqual(after);
            expect(takeLaneStore.value).toEqual(afterTakes);
            expect(undoHistoryStore.value?.past).toHaveLength(2);
            expect(undoHistoryStore.value?.future).toHaveLength(0);
            assertRaw();
        }
    });

    it.each([
        { route: 'sequential', source: 'legacy', ripple: false },
        { route: 'atomic', source: 'legacy', ripple: false },
        { route: 'atomic', source: 'legacy', ripple: true },
        { route: 'atomic', source: 'zero', ripple: false },
        { route: 'atomic', source: 'signed', ripple: false },
        { route: 'reverse', source: 'legacy', ripple: false },
        { route: 'reverse', source: 'zero', ripple: false },
        { route: 'reverse', source: 'signed', ripple: false },
        { route: 'reverse', source: 'legacy', ripple: true },
    ] as const)(
        'reloads $route tempo and removal history with $source source, ripple=$ripple, preserving peers',
        async ({ route, source, ripple }) => {
            const indexedDb = installTransactionalIndexedDb();
            sessionUndoWitnessStampPort.setProvider(stampSessionUndoWitness);
            try {
                clearHandlerRegistry();
                registerProductionHandlers();
                const projectId = `tempo-removal-reload-${route}-${source}-${String(ripple)}`;
                const sourceClip = structuredClone(legacyClip);
                let capturedSeconds = 1;
                if (source === 'zero') {
                    sourceClip.audioOffsetBeats = 0;
                    sourceClip.audioOffsetSeconds = 0;
                    capturedSeconds = 0;
                } else if (source === 'signed') {
                    sourceClip.audioOffsetBeats = -4;
                    sourceClip.audioOffsetSeconds = -2;
                    capturedSeconds = -2;
                }
                workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: ripple });
                const follower: Clip = {
                    ...legacyClip,
                    id: 'follower',
                    startBeat: 16,
                    endBeat: 20,
                    audioOffsetBeats: 0,
                    audioOffsetSeconds: 0,
                };
                if (route === 'reverse' && ripple) {
                    follower.audioOffsetBeats = 4;
                    delete follower.audioOffsetSeconds;
                }
                const clips = [sourceClip];
                if (ripple) {
                    clips.push(follower);
                }
                reconcileSessionUndoForProject({ projectId, captureWitness: captureDurableDocumentWitness });
                trackStore.set({
                    ...trackStore.value!,
                    tracks: [
                        {
                            ...trackStore.value!.tracks[0]!,
                            clips,
                            alternatives: [
                                {
                                    id: 'inactive-alt',
                                    name: 'Inactive',
                                    clips: [{ ...legacyClip, id: 'inactive', audioOffsetBeats: -4 }],
                                },
                                {
                                    id: 'zero-alt',
                                    name: 'Canonical zero',
                                    clips: [
                                        {
                                            ...legacyClip,
                                            id: 'zero-source',
                                            audioOffsetBeats: 0,
                                            audioOffsetSeconds: 0,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                });
                takeLaneStore.set({
                    lanes: [
                        {
                            id: 'lane-zero',
                            trackId: 'track-1',
                            takes: [
                                {
                                    id: 'take-zero',
                                    clipId: 'clip-1',
                                    name: 'Canonical zero take',
                                    startBeat: 8,
                                    endBeat: 12,
                                    selected: true,
                                    sourceOffsetBeats: 0,
                                    sourceOffsetSeconds: 0,
                                },
                            ],
                            activeCompRegions: [],
                        },
                    ],
                });
                const envelope = {
                    clipId: 'clip-1',
                    enabled: true,
                    points: [{ id: 'source-gain-point', beatOffset: 1, gainDb: -6 }],
                };
                gainEnvelopeStore.set({ envelopes: { 'clip-1': envelope } });
                const sourceNotes = [{ id: 'source-note', pitch: 60, startBeat: 1, duration: 2, velocity: 100 }];
                midiStore.set({
                    ...defaultMidiStoreState,
                    notesByClipId: { 'clip-1': sourceNotes },
                    ccByClipId: { 'clip-1': [{ id: 'source-cc', controller: 64, value: 127, beat: 3, channel: 1 }] },
                    pitchBendByClipId: { 'clip-1': [{ id: 'source-pb', value: 200, beat: 3, channel: 1 }] },
                });
                if (ripple) {
                    restoreAutomationLanes([
                        {
                            ...createAutomationLane('track-1', 'gain', 'Gain', 0, 1, 'follower'),
                            id: 'follower-automation',
                            points: [{ beat: 17, value: 0.5, curve: 'linear', tension: 0 }],
                        },
                        {
                            ...createAutomationLane('track-1', 'gain', 'Gain', 0, 1, 'clip-1'),
                            id: 'removed-automation',
                            points: [{ beat: 9, value: 0.5, curve: 'linear', tension: 0 }],
                        },
                    ]);
                }
                flushAutomergeStorageWrites();
                const beforeAutomation = structuredClone(getAutomationLanes());
                const beforeMidi = structuredClone(midiStore.value);
                const before = structuredClone(trackStore.value);
                const beforeTakes = structuredClone(takeLaneStore.value);
                const groupId = `${route}-tempo-remove-prefix`;
                if (route !== 'sequential') {
                    const actions: Parameters<typeof executeAppActionBatch>[0][number][] = [
                        { type: 'setTempo', payload: { bpm: 60 } },
                        { type: 'removeClip', payload: { clipId: 'clip-1' } },
                    ];
                    if (route === 'reverse') {
                        actions.reverse();
                    }
                    const result = await executeAppActionBatch(actions, { source: 'manual', groupId });
                    expect(result.status).toBe('committed');
                } else {
                    await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { source: 'manual', groupId });
                    expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(capturedSeconds);
                    await executeAppAction(
                        { type: 'removeClip', payload: { clipId: 'clip-1' } },
                        { source: 'manual', groupId }
                    );
                }
                flushAutomergeStorageWrites();
                expect(transportStore.value?.tempo).toBe(60);
                expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.id === 'clip-1')).toBe(false);
                expect(trackStore.value?.tracks[0]?.alternatives[0]?.clips[0]?.audioOffsetSeconds).toBe(-2);
                expect(takeLaneStore.value?.lanes).toEqual([]);
                expect(gainEnvelopeStore.value?.envelopes['clip-1']).toBeUndefined();
                expect(midiStore.value?.notesByClipId['clip-1']).toBeUndefined();
                const removedClips = structuredClone(trackStore.value!.tracks[0]!.clips);
                if (ripple) {
                    const expectedFollower = { ...follower, startBeat: 12, endBeat: 16 };
                    if (route === 'reverse') {
                        expectedFollower.audioOffsetSeconds = 2;
                    }
                    expect(removedClips).toEqual([expectedFollower]);
                    expect(getAutomationLanes()).toEqual([
                        { ...beforeAutomation[0], points: [{ beat: 13, value: 0.5, curve: 'linear', tension: 0 }] },
                    ]);
                }
                const peerClip: Clip = {
                    ...legacyClip,
                    id: 'peer-clip',
                    name: 'Later peer',
                    startBeat: 0,
                    endBeat: 2,
                    audioOffsetBeats: 0,
                    audioOffsetSeconds: 0,
                };
                const peerEnvelope = {
                    clipId: peerClip.id,
                    enabled: true,
                    points: [{ id: 'peer-gain-point', beatOffset: 0.5, gainDb: -3 }],
                };
                const peerNotes = [{ id: 'peer-note', pitch: 64, startBeat: 0, duration: 1, velocity: 80 }];
                mutateCrdtDoc<{
                    tracks: { tracks: Track[] };
                    gainEnvelopes: NonNullable<typeof gainEnvelopeStore.value>;
                    midi: NonNullable<typeof midiStore.value>;
                }>({
                    id: 'root',
                    changeFn: (project) => {
                        project.tracks.tracks[0]!.clips.push(peerClip);
                        project.gainEnvelopes.envelopes[peerClip.id] = peerEnvelope;
                        project.midi.notesByClipId[peerClip.id] = peerNotes;
                    },
                });
                projectCrdtToStores();
                const assertRaw = () => {
                    const raw = getCrdtDoc<{
                        tracks: NonNullable<typeof trackStore.value>;
                        transport: NonNullable<typeof transportStore.value>;
                        takeLanes: NonNullable<typeof takeLaneStore.value>;
                        gainEnvelopes: NonNullable<typeof gainEnvelopeStore.value>;
                        midi: NonNullable<typeof midiStore.value>;
                        automation: { lanes: ReturnType<typeof getAutomationLanes> };
                    }>('root');
                    expect(raw?.tracks.tracks).toEqual(trackStore.value?.tracks);
                    expect(raw?.transport.tempo).toBe(transportStore.value?.tempo);
                    expect(raw?.takeLanes).toEqual(takeLaneStore.value);
                    expect(raw?.gainEnvelopes).toEqual(gainEnvelopeStore.value);
                    expect(raw?.midi).toEqual(midiStore.value);
                    expect(raw?.automation.lanes).toEqual(getAutomationLanes());
                    expect(gainEnvelopeStore.value?.envelopes[peerClip.id]).toEqual(peerEnvelope);
                    expect(midiStore.value?.notesByClipId[peerClip.id]).toEqual(peerNotes);
                };
                await vi.waitFor(() => {
                    const saved: unknown = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}');
                    const expectedActions = [
                        { action: { type: 'setTempo' } },
                        { action: { type: 'removeClip' }, inverseAction: { type: 'restoreClip' } },
                    ];
                    if (route === 'reverse') {
                        expectedActions.reverse();
                    }
                    expect(saved).toMatchObject({ past: expectedActions });
                });
                const liveEntries = undoHistoryStore.value!.past;
                await persistCrdtProject();
                const persistedWitness = captureDurableDocumentWitness();
                const persistedRoot = structuredClone(getCrdtDoc('root'));
                removeCrdtDoc('root');
                expect(hasCrdtDoc('root')).toBe(false);
                createCrdtDoc('root');
                expect(getCrdtDoc('root')).not.toEqual(persistedRoot);
                await expect(loadCrdtProject()).resolves.toBe(true);
                projectCrdtToStores({ resetProjections: true });
                expect(getCrdtDoc('root')).toEqual(persistedRoot);
                expect(captureDurableDocumentWitness()).toBe(persistedWitness);
                clearHandlerRegistry();
                registerProductionHandlers();
                reconcileSessionUndoForProject({ projectId, captureWitness: captureDurableDocumentWitness });
                expect(undoHistoryStore.value?.past).toHaveLength(2);
                expect(undoHistoryStore.value?.past[0]).not.toBe(liveEntries[0]);
                expect(undoHistoryStore.value?.past[1]).not.toBe(liveEntries[1]);
                expect(trackStore.value?.tracks[0]?.clips).toEqual([...removedClips, peerClip]);
                const removal = undoHistoryStore.value?.past[route === 'reverse' ? 0 : 1];
                expect.soft(removal).toMatchObject({
                    inverseAction: {
                        type: 'restoreClip',
                        payload: {
                            clipSnapshot: route === 'reverse' ? sourceClip : { audioOffsetSeconds: capturedSeconds },
                            ripplePlan: {
                                removedClips: [
                                    route === 'reverse' ? sourceClip : { audioOffsetSeconds: capturedSeconds },
                                ],
                            },
                            midiNotesSnapshot: sourceNotes,
                        },
                    },
                });
                if (route === 'reverse' && source === 'legacy') {
                    if (removal?.kind !== 'action' || removal.inverseAction?.type !== 'restoreClip') {
                        throw new Error('Expected real reverse removal inverse');
                    }
                    expect(removal.inverseAction.payload.clipSnapshot).not.toHaveProperty('audioOffsetSeconds');
                }
                if (route === 'reverse' && ripple) {
                    const tempo = undoHistoryStore.value?.past[1];
                    expect(tempo).toMatchObject({
                        redoAction: {
                            type: 'setTempo',
                            payload: {
                                sourceTransition: {
                                    clips: expect.arrayContaining([
                                        {
                                            trackId: 'track-1',
                                            alternativeId: null,
                                            clipId: 'follower',
                                            audioBufferId: 'source-buffer',
                                            fileId: null,
                                            assetHash: null,
                                            startBeat: 12,
                                            endBeat: 16,
                                            audioOffsetBeats: 4,
                                            originalTempo: 120,
                                            audioOffsetSeconds: 2,
                                        },
                                    ]),
                                },
                            },
                        },
                    });
                }
                assertRaw();

                const peerAfterUndo: Clip = { ...peerClip, id: 'peer-after-undo', startBeat: 3, endBeat: 5 };
                const peerTake = {
                    id: 'peer-take',
                    clipId: 'clip-1',
                    name: 'Later peer pass',
                    startBeat: 8,
                    endBeat: 12,
                    selected: false,
                    sourceOffsetBeats: 0,
                    sourceOffsetSeconds: 0,
                    passAnchorSeconds: -2,
                    passDepthSeconds: 2,
                };
                for (const cycle of [1, 2]) {
                    expect((await undo()).headConsumed, `Undo cycle ${cycle}`).toBe(true);
                    expect(transportStore.value?.tempo).toBe(120);
                    let expectedClips = [
                        ...before!.tracks[0]!.clips.filter((clip) => clip.id !== 'clip-1'),
                        peerClip,
                        sourceClip,
                    ];
                    if (cycle === 2) {
                        expectedClips = [
                            ...before!.tracks[0]!.clips.filter((clip) => clip.id !== 'clip-1'),
                            peerClip,
                            peerAfterUndo,
                            sourceClip,
                        ];
                    }
                    expect(trackStore.value?.tracks[0]?.clips).toEqual(expectedClips);
                    if (source === 'legacy') {
                        expect(
                            trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === 'clip-1')
                        ).not.toHaveProperty('audioOffsetSeconds');
                    }
                    expect(getAutomationLanes()).toEqual(beforeAutomation);
                    expect(gainEnvelopeStore.value?.envelopes['clip-1']).toEqual(envelope);
                    expect(midiStore.value?.notesByClipId['clip-1']).toEqual(beforeMidi?.notesByClipId['clip-1']);
                    expect(midiStore.value?.ccByClipId['clip-1']).toEqual(beforeMidi?.ccByClipId['clip-1']);
                    expect(midiStore.value?.pitchBendByClipId['clip-1']).toEqual(
                        beforeMidi?.pitchBendByClipId['clip-1']
                    );
                    expect(trackStore.value?.tracks[0]?.alternatives).toEqual(before?.tracks[0]?.alternatives);
                    const expectedTakes = structuredClone(beforeTakes);
                    if (cycle === 2) {
                        expectedTakes?.lanes[0]?.takes.push(peerTake);
                    }
                    expect(takeLaneStore.value).toEqual(expectedTakes);
                    expect(undoHistoryStore.value?.past).toHaveLength(0);
                    expect(undoHistoryStore.value?.future).toHaveLength(2);
                    assertRaw();
                    if (cycle === 1) {
                        mutateCrdtDoc<{
                            tracks: { tracks: Track[] };
                            takeLanes: NonNullable<typeof takeLaneStore.value>;
                        }>({
                            id: 'root',
                            changeFn: (project) => {
                                project.tracks.tracks[0]!.clips.push(peerAfterUndo);
                                project.takeLanes.lanes[0]!.takes.push(peerTake);
                            },
                        });
                        projectCrdtToStores();
                    }
                    await redo();
                    expect(transportStore.value?.tempo).toBe(60);
                    expect(trackStore.value?.tracks[0]?.clips).toEqual([...removedClips, peerClip, peerAfterUndo]);
                    if (ripple) {
                        expect(getAutomationLanes()).toEqual([
                            { ...beforeAutomation[0], points: [{ beat: 13, value: 0.5, curve: 'linear', tension: 0 }] },
                        ]);
                    }
                    expect(trackStore.value?.tracks[0]?.alternatives[0]?.clips[0]?.audioOffsetSeconds).toBe(-2);
                    expect(trackStore.value?.tracks[0]?.alternatives[1]?.clips[0]?.audioOffsetSeconds).toBe(0);
                    expect(takeLaneStore.value?.lanes).toEqual([]);
                    expect(gainEnvelopeStore.value?.envelopes['clip-1']).toBeUndefined();
                    expect(midiStore.value?.notesByClipId['clip-1']).toBeUndefined();
                    expect(undoHistoryStore.value?.past).toHaveLength(2);
                    expect(undoHistoryStore.value?.future).toHaveLength(0);
                    assertRaw();
                }
            } finally {
                sessionUndoWitnessStampPort.setProvider(null);
                await indexedDb.dispose();
            }
        }
    );

    it.each([
        ['sequential', 'undo'],
        ['sequential', 'redo'],
        ['atomic', 'undo'],
        ['atomic', 'redo'],
        ['reverse', 'undo'],
        ['reverse', 'redo'],
    ] as const)(
        'refuses %s tempo and removal replay atomically after a peer source change before %s',
        async (route, leg) => {
            clearHandlerRegistry();
            registerProductionHandlers();
            const groupId = `${route}-tempo-remove-conflict`;
            if (route !== 'sequential') {
                const actions: Parameters<typeof executeAppActionBatch>[0][number][] = [
                    { type: 'setTempo', payload: { bpm: 60 } },
                    { type: 'removeClip', payload: { clipId: 'clip-1' } },
                ];
                if (route === 'reverse') {
                    actions.reverse();
                }
                const result = await executeAppActionBatch(actions, { source: 'manual', groupId });
                expect(result.status).toBe('committed');
            } else {
                await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { source: 'manual', groupId });
                await executeAppAction(
                    { type: 'removeClip', payload: { clipId: 'clip-1' } },
                    { source: 'manual', groupId }
                );
            }
            if (leg === 'redo') {
                expect((await undo()).headConsumed).toBe(true);
            }
            mutateCrdtDoc<{ tracks: { tracks: Track[] } }>({
                id: 'root',
                changeFn: (project) => {
                    if (leg === 'undo' || route === 'reverse') {
                        // New legacy membership was never captured by the tempo command.
                        project.tracks.tracks[0]!.clips.push({ ...legacyClip, id: 'peer-legacy' });
                    } else {
                        // Redo must guard the restored target's source before removal.
                        project.tracks.tracks[0]!.clips[0]!.audioOffsetBeats = 7;
                    }
                },
            });
            projectCrdtToStores();
            const raw = structuredClone(getCrdtDoc('root'));
            const owners = structuredClone({
                tracks: trackStore.value,
                transport: transportStore.value,
                takes: takeLaneStore.value,
            });
            const history = undoHistoryStore.value;
            const writes = [
                vi.spyOn(trackStore, 'set'),
                vi.spyOn(transportStore, 'set'),
                vi.spyOn(takeLaneStore, 'set'),
            ];
            try {
                if (leg === 'undo') {
                    expect((await undo()).headConsumed).toBe(false);
                } else {
                    await redo();
                }
                expect(getCrdtDoc('root')).toEqual(raw);
                expect({
                    tracks: trackStore.value,
                    transport: transportStore.value,
                    takes: takeLaneStore.value,
                }).toEqual(owners);
                expect(undoHistoryStore.value).toBe(history);
                for (const write of writes) {
                    expect(write).not.toHaveBeenCalled();
                }
            } finally {
                for (const write of writes) {
                    write.mockRestore();
                }
            }
        }
    );

    it('keeps a refused initial batch atomic before admitting the same removal in a valid prefix', async () => {
        clearHandlerRegistry();
        registerProductionHandlers();
        const tempo = { type: 'setTempo' as const, payload: { bpm: 60 } };
        const removal = { type: 'removeClip' as const, payload: { clipId: 'clip-1' } };
        const raw = structuredClone(getCrdtDoc('root'));
        const owners = structuredClone({ tracks: trackStore.value, transport: transportStore.value });
        const history = undoHistoryStore.value;
        const refused = await executeAppActionBatch([tempo, removal, removal], {
            source: 'manual',
            groupId: 'refused-remove-prefix',
        });
        expect(refused.status).toBe('conflicted');
        expect(getCrdtDoc('root')).toEqual(raw);
        expect({ tracks: trackStore.value, transport: transportStore.value }).toEqual(owners);
        expect(undoHistoryStore.value).toBe(history);
        const accepted = await executeAppActionBatch([tempo, removal], {
            source: 'manual',
            groupId: 'valid-remove-prefix',
        });
        expect(accepted.status).toBe('committed');
        expect(undoHistoryStore.value?.past[1]).toMatchObject({
            inverseAction: { payload: { clipSnapshot: { audioOffsetSeconds: 1 } } },
        });
        expect((await undo()).headConsumed).toBe(true);
        expect(trackStore.value?.tracks[0]?.clips).toEqual([legacyClip]);
    });

    it.each(['reverse-order', 'independent-removals', 'independent-ripple'] as const)(
        'replays the admitted %s atomic batch without inventing a canonical source',
        async (route) => {
            clearHandlerRegistry();
            registerProductionHandlers();
            const midiClip: Clip = { ...legacyClip, id: 'midi-clip', type: 'midi' };
            if (route === 'independent-ripple') {
                midiClip.startBeat = 16;
                midiClip.endBeat = 20;
                workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: true });
            }
            const originalClips = [legacyClip];
            if (route !== 'reverse-order') {
                originalClips.push(midiClip);
                trackStore.set({ ...trackStore.value!, tracks: [{ ...track, clips: structuredClone(originalClips) }] });
                midiStore.set({
                    ...defaultMidiStoreState,
                    notesByClipId: {
                        'midi-clip': [{ id: 'control-note', pitch: 60, startBeat: 0, duration: 1, velocity: 80 }],
                    },
                });
            }
            flushAutomergeStorageWrites();
            const beforeMidi = structuredClone(midiStore.value);
            const removal = { type: 'removeClip' as const, payload: { clipId: 'clip-1' } };
            const sibling = { type: 'setTempo' as const, payload: { bpm: 60 } };
            const independent = { type: 'removeClip' as const, payload: { clipId: 'midi-clip' } };
            const actions: Parameters<typeof executeAppActionBatch>[0][number][] = [removal, sibling];
            if (route !== 'reverse-order') {
                actions.splice(1, 1, independent);
            }
            const result = await executeAppActionBatch(actions, { source: 'manual', groupId: route });
            expect(result.status).toBe('committed');
            expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
            const captured = undoHistoryStore.value?.past[0];
            if (captured?.kind !== 'action' || captured.inverseAction?.type !== 'restoreClip') {
                throw new Error('Expected the production removal capture');
            }
            expect(captured.inverseAction.payload.clipSnapshot).not.toHaveProperty('audioOffsetSeconds');
            if (route === 'independent-ripple') {
                expect(undoHistoryStore.value?.past[1]).toMatchObject({
                    inverseAction: {
                        type: 'restoreClip',
                        payload: {
                            clipSnapshot: { id: midiClip.id, startBeat: 12, endBeat: 16 },
                            ripplePlan: { removedClips: [{ id: midiClip.id, startBeat: 12, endBeat: 16 }] },
                        },
                    },
                });
            }
            for (const cycle of [1, 2]) {
                expect((await undo()).headConsumed, `Undo ${cycle}`).toBe(true);
                expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id).sort()).toEqual(
                    originalClips.map((clip) => clip.id).sort()
                );
                expect(trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === 'clip-1')).toEqual(legacyClip);
                expect(midiStore.value).toEqual(beforeMidi);
                const raw = getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value>; midi: typeof midiStore.value }>(
                    'root'
                );
                expect(raw?.tracks.tracks).toEqual(trackStore.value?.tracks);
                expect(raw?.midi).toEqual(midiStore.value);
                await redo();
                expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
                expect(undoHistoryStore.value?.past).toHaveLength(2);
                expect(undoHistoryStore.value?.future).toHaveLength(0);
                expect(getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value> }>('root')?.tracks.tracks).toEqual(
                    trackStore.value?.tracks
                );
            }
        }
    );

    it('rejects an incomplete restored prefix before the tempo member or any owner writes', async () => {
        clearHandlerRegistry();
        registerProductionHandlers();
        const groupId = 'sequential-tempo-remove-malformed';
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { source: 'manual', groupId });
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-1' } }, { source: 'manual', groupId });
        const entries = undoHistoryStore.value!.past;
        const removal = entries[1];
        const tempo = entries[0];
        if (
            removal?.kind !== 'action' ||
            removal.inverseAction?.type !== 'restoreClip' ||
            tempo?.kind !== 'action' ||
            tempo.inverseAction?.type !== 'setTempo'
        ) {
            throw new Error('Expected the production tempo and removal inverses');
        }
        expect(tempo.inverseAction.payload.sourceTransition).toMatchObject({
            direction: 'restore',
            clips: [{ clipId: 'clip-1', audioOffsetSeconds: 1 }],
        });
        const snapshot = removal.inverseAction.payload.clipSnapshot;
        const raw = structuredClone(getCrdtDoc('root'));
        const owners = structuredClone({
            tracks: trackStore.value,
            transport: transportStore.value,
            takes: takeLaneStore.value,
        });
        const history = undoHistoryStore.value;
        const incompleteSnapshot = {
            id: snapshot.id,
            trackId: snapshot.trackId,
            startBeat: snapshot.startBeat,
            endBeat: snapshot.endBeat,
            type: 'audio' as const,
            audioOffsetBeats: 2,
            audioOffsetSeconds: 1,
        };
        const ripplePlan = removal.inverseAction.payload.ripplePlan;
        const restoredAction = {
            ...removal.inverseAction,
            payload: {
                ...removal.inverseAction.payload,
                clipSnapshot: incompleteSnapshot,
                ripplePlan: ripplePlan ? { ...ripplePlan, removedClips: [incompleteSnapshot] } : null,
            },
        };
        expect(
            prepareAudioSourcesForTempoChange({
                nextTempoAtBeat: () => 120,
                replay: tempo.inverseAction.payload.sourceTransition,
                context: { actions: [restoredAction, tempo.inverseAction], actionIndex: 1 },
            })
        ).toBeNull();
        const result = await executeAppActionBatch([restoredAction, tempo.inverseAction], { skipUndo: true });
        expect(result.status).toBe('conflicted');
        expect(getCrdtDoc('root')).toEqual(raw);
        expect({ tracks: trackStore.value, transport: transportStore.value, takes: takeLaneStore.value }).toEqual(
            owners
        );
        expect(undoHistoryStore.value).toBe(history);
    });

    it.each(['undo', 'redo'] as const)(
        'refuses the tempo then trim group atomically after a peer source edit before %s',
        async (leg) => {
            registerHandlerMap(getArrangementHandlers());
            const result = await executeAppActionBatch(
                [
                    { type: 'setTempo', payload: { bpm: 60 } },
                    { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 9 } },
                ],
                { source: 'manual', groupId: 'tempo-trim-conflict' }
            );
            expect(result.status).toBe('committed');
            if (leg === 'redo') {
                expect((await undo()).headConsumed).toBe(true);
            }
            mutateCrdtDoc<{ tracks: { tracks: Track[] } }>({
                id: 'root',
                changeFn: (project) => {
                    project.tracks.tracks[0]!.clips[0]!.audioOffsetSeconds = 99;
                },
            });
            projectCrdtToStores();
            const raw = structuredClone(getCrdtDoc('root'));
            const owners = structuredClone({
                tracks: trackStore.value,
                transport: transportStore.value,
                takes: takeLaneStore.value,
            });
            const history = undoHistoryStore.value;
            const writes = [
                vi.spyOn(trackStore, 'set'),
                vi.spyOn(transportStore, 'set'),
                vi.spyOn(takeLaneStore, 'set'),
                vi.spyOn(undoHistoryStore, 'set'),
            ];
            try {
                if (leg === 'undo') {
                    expect((await undo()).headConsumed).toBe(false);
                } else {
                    await redo();
                }
                expect(getCrdtDoc('root')).toEqual(raw);
                expect({
                    tracks: trackStore.value,
                    transport: transportStore.value,
                    takes: takeLaneStore.value,
                }).toEqual(owners);
                expect(undoHistoryStore.value).toBe(history);
                for (const write of writes) {
                    expect(write).not.toHaveBeenCalled();
                }
            } finally {
                for (const write of writes) {
                    write.mockRestore();
                }
            }
        }
    );

    it('hydrates the saved add replay and retains its materialized event identity', async () => {
        clearHandlerRegistry();
        registerProductionHandlers();
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'linear' } });
        flushAutomergeStorageWrites();
        const changeId = tempoMapStore.value!.changes[0]!.id;
        await vi.waitFor(() => {
            const saved = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}') as { past?: unknown[] };
            expect(saved.past).toHaveLength(1);
        });
        clearHandlerRegistry();
        registerProductionHandlers();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        await undo();
        expect(tempoMapStore.value?.changes).toEqual([]);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        await redo();
        expect(tempoMapStore.value?.changes).toEqual([{ id: changeId, beat: 4, tempo: 60, curve: 'linear' }]);
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        const raw = getCrdtDoc<{ tracks: { tracks: Track[] }; tempoMap: NonNullable<typeof tempoMapStore.value> }>(
            'root'
        );
        expect(raw?.tracks.tracks[0]?.clips).toEqual(trackStore.value?.tracks[0]?.clips);
        expect(raw?.tempoMap).toEqual(tempoMapStore.value);
    });

    it.each(['update', 'remove'] as const)('hydrates the saved %s replay with exact source absence', async (kind) => {
        clearHandlerRegistry();
        registerProductionHandlers();
        const original = [
            { id: 'first', beat: 0, tempo: 120, curve: 'instant' as const },
            { id: 'target', beat: 4, tempo: kind === 'remove' ? 60 : 120, curve: 'instant' as const },
        ];
        tempoMapStore.set({ changes: original });
        flushAutomergeStorageWrites();
        if (kind === 'remove') {
            await executeAppAction({ type: 'removeTempoMapChange', payload: { changeId: 'target' } });
        } else {
            await executeAppAction({ type: 'updateTempoMapChange', payload: { changeId: 'target', tempo: 60 } });
        }
        flushAutomergeStorageWrites();
        const expectedSource = kind === 'remove' ? 2 : 1;
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(expectedSource);
        await vi.waitFor(() => {
            const saved = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}') as { past?: unknown[] };
            expect(saved.past).toHaveLength(1);
        });
        clearHandlerRegistry();
        registerProductionHandlers();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        await undo();
        expect(tempoMapStore.value?.changes).toEqual(original);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        await redo();
        expect(tempoMapStore.value?.changes.map((change) => change.id)).toEqual(
            kind === 'remove' ? ['first'] : ['first', 'target']
        );
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(expectedSource);
        const raw = getCrdtDoc<{ tracks: { tracks: Track[] }; tempoMap: NonNullable<typeof tempoMapStore.value> }>(
            'root'
        );
        expect(raw?.tracks.tracks[0]?.clips).toEqual(trackStore.value?.tracks[0]?.clips);
        expect(raw?.tempoMap).toEqual(tempoMapStore.value);
    });

    it('replaces a same-beat event within epsilon, preserving ID and old source seconds', async () => {
        tempoMapStore.set({ changes: [{ id: 'seam', beat: 4, tempo: 120, curve: 'instant' }] });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4 + 5e-7, tempo: 60, curve: 'linear' } });
        expect(tempoMapStore.value?.changes).toEqual([{ id: 'seam', beat: 4, tempo: 60, curve: 'linear' }]);
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        await undo();
        expect(tempoMapStore.value?.changes).toEqual([{ id: 'seam', beat: 4, tempo: 120, curve: 'instant' }]);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        await redo();
        expect(tempoMapStore.value?.changes[0]?.id).toBe('seam');
    });

    it('updates and removes a named event without replacing unrelated peer map events', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'first', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'middle', beat: 4, tempo: 120, curve: 'instant' },
                { id: 'last', beat: 16, tempo: 90, curve: 'instant' },
            ],
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'updateTempoMapChange', payload: { changeId: 'middle', tempo: 60 } });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(tempoMapStore.value?.changes.map((change) => change.id)).toEqual(['first', 'middle', 'last']);
        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        await redo();
        await executeAppAction({ type: 'removeTempoMapChange', payload: { changeId: 'middle' } });
        expect(tempoMapStore.value?.changes.map((change) => change.id)).toEqual(['first', 'last']);
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        await undo();
        expect(tempoMapStore.value?.changes[1]?.id).toBe('middle');
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        await redo();
        expect(tempoMapStore.value?.changes.map((change) => change.id)).toEqual(['first', 'last']);
    });

    it('captures the old interior tempo of a ramp at the clip start', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'ramp', beat: 0, tempo: 120, curve: 'linear' },
                { id: 'tail', beat: 16, tempo: 60, curve: 'instant' },
            ],
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'updateTempoMapChange', payload: { changeId: 'ramp', tempo: 80 } });
        // Beat 8 is halfway through the old 120→60 ramp: 90 BPM at clip start.
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe((2 * 60) / 90);
        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        await redo();
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe((2 * 60) / 90);
    });

    it('keeps canonical zero and signed pre-roll authoritative over stale beat aliases', async () => {
        trackStore.set({
            ...trackStore.value!,
            tracks: [
                {
                    ...trackStore.value!.tracks[0]!,
                    clips: [
                        { ...legacyClip, id: 'zero', audioOffsetBeats: 99, audioOffsetSeconds: 0 },
                        { ...legacyClip, id: 'pre-roll', audioOffsetBeats: 99, audioOffsetSeconds: -1 },
                    ],
                },
            ],
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.audioOffsetSeconds)).toEqual([0, -1]);
        await undo();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.audioOffsetSeconds)).toEqual([0, -1]);
        await redo();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.audioOffsetSeconds)).toEqual([0, -1]);
    });

    it.each(['first', 'last', 'sole'] as const)(
        'restores %s removed event by its original identity',
        async (position) => {
            const first = { id: 'first', beat: 0, tempo: 120, curve: 'instant' as const };
            const last = { id: 'last', beat: 16, tempo: 90, curve: 'instant' as const };
            const changes = position === 'sole' ? [first] : [first, last];
            tempoMapStore.set({ changes });
            flushAutomergeStorageWrites();
            const target = position === 'last' ? last : first;
            await executeAppAction({ type: 'removeTempoMapChange', payload: { changeId: target.id } });
            expect(tempoMapStore.value?.changes.some((change) => change.id === target.id)).toBe(false);
            await undo();
            expect(tempoMapStore.value?.changes).toEqual(changes);
            await redo();
            expect(tempoMapStore.value?.changes.some((change) => change.id === target.id)).toBe(false);
        }
    );

    it('makes equal, missing and invalid requests zero-write operations', async () => {
        tempoMapStore.set({ changes: [{ id: 'same', beat: 4, tempo: 120, curve: 'instant' }] });
        flushAutomergeStorageWrites();
        const raw = structuredClone(getCrdtDoc('root'));
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 120, curve: 'instant' } });
        await executeAppAction({ type: 'updateTempoMapChange', payload: { changeId: 'same', tempo: 120 } });
        await expect(
            executeAppAction({ type: 'removeTempoMapChange', payload: { changeId: 'missing' } })
        ).rejects.toThrow();
        await expect(
            executeAppAction({ type: 'addTempoMapChange', payload: { beat: -1, tempo: 60, curve: 'instant' } })
        ).rejects.toThrow();
        await expect(
            executeAppAction({ type: 'updateTempoMapChange', payload: { changeId: 'same', tempo: 1000 } })
        ).rejects.toThrow();
        expect(getCrdtDoc('root')).toEqual(raw);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(undoHistoryStore.value?.past).toHaveLength(0);
    });

    it('notifies project dirty and tempo revision only after committed map edits and replay', async () => {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
            dirty: false,
        });
        const dispose = initProjectDirtyTracking();
        try {
            const initialRevision = tempoProjectRevisionStore.value ?? 0;
            await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
            expect(projectStore.value?.dirty).toBe(true);
            expect(tempoProjectRevisionStore.value).toBe(initialRevision + 1);
            projectStore.set({ ...projectStore.value!, dirty: false });
            await undo();
            expect(projectStore.value?.dirty).toBe(true);
            expect(tempoProjectRevisionStore.value).toBe(initialRevision + 2);
            projectStore.set({ ...projectStore.value!, dirty: false });
            await redo();
            expect(projectStore.value?.dirty).toBe(true);
            expect(tempoProjectRevisionStore.value).toBe(initialRevision + 3);

            projectStore.set({ ...projectStore.value!, dirty: false });
            const raw = structuredClone(getCrdtDoc('root'));
            await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
            await expect(
                executeAppAction({ type: 'removeTempoMapChange', payload: { changeId: 'missing' } })
            ).rejects.toThrow();
            expect(projectStore.value?.dirty).toBe(false);
            expect(tempoProjectRevisionStore.value).toBe(initialRevision + 3);
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
        } finally {
            dispose();
        }
    });

    it('rejects a public versioned map preview before touching live project or history', () => {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
            dirty: false,
        });
        const revision = tempoProjectRevisionStore.value;
        const raw = structuredClone(getCrdtDoc('root'));
        const source = structuredClone(trackStore.value);
        const map = structuredClone(tempoMapStore.value);
        const history = undoHistoryStore.value;
        const command = createVersionedCommandEnvelope({
            action: {
                type: 'addTempoMapChange',
                payload: { beat: 4, tempo: 60, curve: 'instant', changeId: 'preview-id' },
            },
            availableDeviceVersions: {},
            expectedEffect: 'Add tempo change at beat 4',
            normalizedProjectRevision: captureProjectRevision(),
            objectReferences: [],
            parameterUnits: [],
            reason: 'Preview a tempo map edit',
            time: [],
        });
        expect(() =>
            compileVersionedCommandBatchEnvelope({
                baseRevision: captureProjectRevision(),
                batchId: 'map-preview-batch',
                commands: [serializeVersionedCommandEnvelope(command)],
                intent: 'Preview map edit',
                mode: 'preview',
                projectId: 'map-preview',
                runId: 'map-preview-run',
            })
        ).toThrow(/not allowlisted|not deterministic/i);
        expect(getCrdtDoc('root')).toEqual(raw);
        expect(trackStore.value).toEqual(source);
        expect(tempoMapStore.value).toEqual(map);
        expect(undoHistoryStore.value).toBe(history);
        expect(projectStore.value?.dirty).toBe(false);
        expect(tempoProjectRevisionStore.value).toBe(revision);
    });

    it('preserves a legacy comp take and inactive alternative at the old governing tempo', async () => {
        const active = trackStore.value!.tracks[0]!.clips[0]!;
        const inactive = { ...active, id: 'inactive', audioOffsetBeats: 4 };
        trackStore.set({
            ...trackStore.value!,
            tracks: [
                { ...trackStore.value!.tracks[0]!, alternatives: [{ id: 'alt-2', name: 'Other', clips: [inactive] }] },
            ],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: active.id,
                            name: 'Take',
                            startBeat: 8,
                            endBeat: 12,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: 'take-1' }],
                },
            ],
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(trackStore.value?.tracks[0]?.alternatives[0]?.clips[0]?.audioOffsetSeconds).toBe(2);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(1);
        expect(resolveClipsWithComping('track-1', trackStore.value!.tracks[0]!.clips)[0]?.audioOffsetSeconds).toBe(2);
        const raw = getCrdtDoc<{ tracks: { tracks: Track[] }; takeLanes: NonNullable<typeof takeLaneStore.value> }>(
            'root'
        );
        expect(raw?.tracks.tracks[0]?.clips).toEqual(trackStore.value?.tracks[0]?.clips);
        expect(raw?.tracks.tracks[0]?.alternatives[0]?.clips).toEqual(
            trackStore.value?.tracks[0]?.alternatives[0]?.clips
        );
        expect(raw?.takeLanes).toEqual(takeLaneStore.value);
        await undo();
        expect(trackStore.value?.tracks[0]?.alternatives[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(takeLaneStore.value?.lanes[0]?.takes[0]).not.toHaveProperty('sourceOffsetSeconds');
        await redo();
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(1);
    });

    it('refuses undo after an inbound peer edit to the targeted event', async () => {
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        const stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        try {
            mutateCrdtDoc<{ tempoMap: NonNullable<typeof tempoMapStore.value> }>({
                id: 'root',
                changeFn: (project) => {
                    project.tempoMap.changes[0]!.tempo = 80;
                },
            });
            const raw = structuredClone(getCrdtDoc('root'));
            const projected = structuredClone(tempoMapStore.value);
            const sources = structuredClone(trackStore.value);
            const history = undoHistoryStore.value;
            expect(tempoMapStore.value?.changes[0]?.tempo).toBe(80);
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(tempoMapStore.value).toEqual(projected);
            expect(trackStore.value).toEqual(sources);
            expect(undoHistoryStore.value).toBe(history);
        } finally {
            stopBridge();
        }
    });

    it('preserves an unrelated inbound peer event while undoing a targeted edit', async () => {
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        const originalId = tempoMapStore.value!.changes[0]!.id;
        const stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        try {
            mutateCrdtDoc<{ tempoMap: NonNullable<typeof tempoMapStore.value> }>({
                id: 'root',
                changeFn: (project) => {
                    project.tempoMap.changes.unshift({ id: 'peer-before', beat: 0, tempo: 120, curve: 'instant' });
                },
            });
            expect(tempoMapStore.value?.changes.map((change) => change.id)).toContain('peer-before');
            expect((await undo()).headConsumed).toBe(true);
            expect(tempoMapStore.value?.changes).toEqual([
                { id: 'peer-before', beat: 0, tempo: 120, curve: 'instant' },
            ]);
            expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
            await redo();
            expect(tempoMapStore.value?.changes.map((change) => change.id)).toEqual(['peer-before', originalId]);
            expect(getCrdtDoc<{ tempoMap: NonNullable<typeof tempoMapStore.value> }>('root')?.tempoMap).toEqual(
                tempoMapStore.value
            );
        } finally {
            stopBridge();
        }
    });

    it('refuses redo when a peer inserts a different event within the original beat tolerance', async () => {
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        await undo();
        const stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        try {
            mutateCrdtDoc<{ tempoMap: NonNullable<typeof tempoMapStore.value> }>({
                id: 'root',
                changeFn: (project) => {
                    project.tempoMap.changes.push({
                        id: 'peer-collision',
                        beat: 4 + 5e-7,
                        tempo: 90,
                        curve: 'instant',
                    });
                },
            });
            const raw = structuredClone(getCrdtDoc('root'));
            const map = structuredClone(tempoMapStore.value);
            const source = structuredClone(trackStore.value);
            const history = undoHistoryStore.value;
            expect(tempoMapStore.value?.changes[0]?.id).toBe('peer-collision');
            await redo();
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(tempoMapStore.value).toEqual(map);
            expect(trackStore.value).toEqual(source);
            expect(undoHistoryStore.value).toBe(history);
        } finally {
            stopBridge();
        }
    });

    it('refuses undo after an inbound peer canonical source edit', async () => {
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        const stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        try {
            mutateCrdtDoc<{ tracks: { tracks: Track[] } }>({
                id: 'root',
                changeFn: (project) => {
                    project.tracks.tracks[0]!.clips[0]!.audioOffsetSeconds = 7;
                },
            });
            const raw = structuredClone(getCrdtDoc('root'));
            const projected = structuredClone(trackStore.value);
            const history = undoHistoryStore.value;
            expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(7);
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(trackStore.value).toEqual(projected);
            expect(undoHistoryStore.value).toBe(history);
        } finally {
            stopBridge();
        }
    });

    it('refuses undo when a peer adds an affected legacy source', async () => {
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        const stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        try {
            mutateCrdtDoc<{ tracks: { tracks: Track[] } }>({
                id: 'root',
                changeFn: (project) => {
                    const { audioOffsetSeconds: _canonical, ...source } = project.tracks.tracks[0]!.clips[0]!;
                    project.tracks.tracks[0]!.clips.push({ ...source, id: 'peer-legacy', audioOffsetBeats: 4 });
                },
            });
            const raw = structuredClone(getCrdtDoc('root'));
            const projected = structuredClone(trackStore.value);
            const history = undoHistoryStore.value;
            expect(trackStore.value?.tracks[0]?.clips[1]).not.toHaveProperty('audioOffsetSeconds');
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(trackStore.value).toEqual(projected);
            expect(undoHistoryStore.value).toBe(history);
        } finally {
            stopBridge();
        }
    });

    it('refuses undo when a peer adds an affected legacy comp take', async () => {
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'original',
                            clipId: 'clip-1',
                            name: 'Original',
                            startBeat: 8,
                            endBeat: 12,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: 'original' }],
                },
            ],
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        const stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        try {
            mutateCrdtDoc<{ takeLanes: NonNullable<typeof takeLaneStore.value> }>({
                id: 'root',
                changeFn: (project) => {
                    project.takeLanes.lanes[0]!.takes.push({
                        id: 'peer',
                        clipId: 'clip-1',
                        name: 'Peer',
                        startBeat: 8,
                        endBeat: 12,
                        selected: false,
                        sourceOffsetBeats: 4,
                    });
                },
            });
            const raw = structuredClone(getCrdtDoc('root'));
            const projected = structuredClone(takeLaneStore.value);
            const history = undoHistoryStore.value;
            expect(takeLaneStore.value?.lanes[0]?.takes[1]).not.toHaveProperty('sourceOffsetSeconds');
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(takeLaneStore.value).toEqual(projected);
            expect(undoHistoryStore.value).toBe(history);
        } finally {
            stopBridge();
        }
    });

    it('drops a malformed saved replay before changing source, map or history', async () => {
        clearHandlerRegistry();
        registerProductionHandlers();
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        flushAutomergeStorageWrites();
        await vi.waitFor(() => expect(sessionStorage.getItem('sourdaw-undo-session')).not.toBeNull());
        const saved = JSON.parse(sessionStorage.getItem('sourdaw-undo-session')!) as {
            past: { inverseAction: { payload: { sourceTransition: { clips: { audioOffsetSeconds: unknown }[] } } } }[];
        };
        expect(saved.past).toHaveLength(1);
        saved.past[0]!.inverseAction.payload.sourceTransition.clips[0]!.audioOffsetSeconds = 'bad';
        sessionStorage.setItem('sourdaw-undo-session', JSON.stringify(saved));
        const raw = structuredClone(getCrdtDoc('root'));
        const projected = structuredClone(trackStore.value);
        const map = structuredClone(tempoMapStore.value);
        clearHandlerRegistry();
        registerProductionHandlers();
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(getCrdtDoc('root')).toEqual(raw);
        expect(trackStore.value).toEqual(projected);
        expect(tempoMapStore.value).toEqual(map);
    });

    it('drops a saved entry whose inverse and redo disagree about the targeted event', async () => {
        clearHandlerRegistry();
        registerProductionHandlers();
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 4, tempo: 60, curve: 'instant' } });
        flushAutomergeStorageWrites();
        await vi.waitFor(() => expect(sessionStorage.getItem('sourdaw-undo-session')).not.toBeNull());
        const saved = JSON.parse(sessionStorage.getItem('sourdaw-undo-session')!) as {
            past: { redoAction: { payload: { replacement: { tempo: number } } } }[];
        };
        saved.past[0]!.redoAction.payload.replacement.tempo = 80;
        sessionStorage.setItem('sourdaw-undo-session', JSON.stringify(saved));
        const raw = structuredClone(getCrdtDoc('root'));
        const projected = structuredClone(trackStore.value);
        const map = structuredClone(tempoMapStore.value);
        clearHandlerRegistry();
        registerProductionHandlers();
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(getCrdtDoc('root')).toEqual(raw);
        expect(trackStore.value).toEqual(projected);
        expect(tempoMapStore.value).toEqual(map);
    });
});
