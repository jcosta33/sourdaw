import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, type Track, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import {
    getArrangementHandlers,
    isTempoAudioSourceTransition,
    prepareAudioSourcesForTempoChange,
    resolveClipsWithComping,
} from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore as undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    commandProjectRevisionPort,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeAppAction,
    executeVersionedCommandBatchEnvelope,
    redo,
    registerProductionCommandHandlers,
    serializeVersionedCommandEnvelope,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCommandPreviewWorkspace,
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
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { initProjectDirtyTracking } from '#/modules/Project/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';

import { tempoMapStore } from '../../../stores/tempoMapStore';
import { tempoProjectRevisionStore } from '../../../stores/tempoProjectRevisionStore';
import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../../useCases/getTransportHandlers';
import { setTempo } from '../../../useCases/setTempo';
import { tempoSourceDependencies } from '../../../useCases/tempoSourceDependencies';
import { updateTransportState } from '../../../useCases/transportQueries/updateTransportState';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function reset_dirty_state(): void {
    const project = projectStore.value;
    if (!project) {
        throw new Error('Expected initialized project');
    }
    projectStore.set({ ...project, dirty: false });
}

function arrangeLegacyAudio(): void {
    const clip: Clip = {
        id: 'legacy-clip',
        trackId: 'audio-track',
        name: 'Legacy audio',
        startBeat: 2,
        endBeat: 8,
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
        id: 'audio-track',
        name: 'Audio',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#000',
        clips: [clip],
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
    trackStore.set({ tracks: [track], selectedTrackId: 'audio-track', ghostClips: [] });
    flushAutomergeStorageWrites();
    reset_dirty_state();
}

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

describe('setTempo project dirty integration', () => {
    let disposeDirtyTracking: (() => void) | undefined;
    let initialTempoRevision: number | null;

    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('set tempo project dirty integration');
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
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
            dirty: false,
        });
        transportStore.set({ ...defaultTransportState, tempo: 120, playheadPosition: 0 });
        tempoMapStore.set({ changes: [] });
        flushAutomergeStorageWrites();
        initialTempoRevision = tempoProjectRevisionStore.value;
        disposeDirtyTracking = initProjectDirtyTracking();
    });

    afterEach(() => {
        disposeDirtyTracking?.();
        commandBatchPreflightPort.setProvider(null);
        commandBatchPreviewPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        clearUndoHistory();
        clearHandlerRegistry();
        tempoSourceDependencies.set(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('keeps the initialized project clean when the requested base tempo is already current', async () => {
        arrangeLegacyAudio();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });

        expect(transportStore.value?.tempo).toBe(120);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(projectStore.value?.dirty).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
    });

    it('commits a base-tempo edit, one targeted inverse, and dirty state through undo and redo', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 133 } });

        expect(transportStore.value?.tempo).toBe(133);
        expect(getCrdtDoc('root')).toMatchObject({ transport: { tempo: 133 } });
        expect(projectStore.value?.dirty).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Set tempo to 133 BPM');
        expect(tempoProjectRevisionStore.value).toBe((initialTempoRevision ?? 0) + 1);

        tempoMapStore.set({ changes: [{ id: 'later-change', beat: 12, tempo: 96, curve: 'instant' }] });
        reset_dirty_state();
        await undo();
        expect(transportStore.value?.tempo).toBe(120);
        expect(tempoMapStore.value?.changes[0]?.tempo).toBe(96);
        expect(projectStore.value?.dirty).toBe(true);

        reset_dirty_state();
        await redo();
        expect(transportStore.value?.tempo).toBe(133);
        expect(tempoMapStore.value?.changes).toEqual([{ id: 'later-change', beat: 12, tempo: 96, curve: 'instant' }]);
        expect(projectStore.value?.dirty).toBe(true);
    });

    it('keeps a legacy audio source at its recorded media entry through a base-tempo edit and Undo/Redo', async () => {
        arrangeLegacyAudio();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } });

        const current = trackStore.value?.tracks[0]?.clips[0];
        expect(current?.audioOffsetSeconds).toBe(1);
        expect(getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.clips[0]).toEqual(current);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.inverseAction).toMatchObject({
            type: 'setTempo',
            payload: { sourceTransition: { version: 1, direction: 'restore', clips: [{ audioOffsetSeconds: 1 }] } },
        });

        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(transportStore.value?.tempo).toBe(120);
        await redo();
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(transportStore.value?.tempo).toBe(60);
    });

    it('preserves signed clip entry and authoritative zero while leaving a canonical take untouched', async () => {
        arrangeLegacyAudio();
        const track = trackStore.value!.tracks[0]!;
        trackStore.set({
            ...trackStore.value!,
            tracks: [
                {
                    ...track,
                    clips: [
                        { ...track.clips[0]!, audioOffsetBeats: -2 },
                        { ...track.clips[0]!, id: 'canonical-zero', audioOffsetBeats: 99, audioOffsetSeconds: 0 },
                    ],
                },
            ],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-zero',
                    trackId: 'audio-track',
                    takes: [
                        {
                            id: 'take-zero',
                            clipId: 'canonical-zero',
                            name: 'Zero',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 99,
                            sourceOffsetSeconds: 0,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'take-zero' }],
                },
            ],
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(-1);
        expect(trackStore.value?.tracks[0]?.clips[1]?.audioOffsetSeconds).toBe(0);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(0);
        expect(getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.clips).toEqual(
            trackStore.value?.tracks[0]?.clips
        );
        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(trackStore.value?.tracks[0]?.clips[1]?.audioOffsetSeconds).toBe(0);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(0);
        await redo();
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(-1);
        expect(trackStore.value?.tracks[0]?.clips[1]?.audioOffsetSeconds).toBe(0);
    });

    it('hydrates a production tempo source capture and replays exact source absence', async () => {
        clearHandlerRegistry();
        registerProductionHandlers();
        arrangeLegacyAudio();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } });
        flushAutomergeStorageWrites();
        await vi.waitFor(() => {
            const saved = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}') as {
                past?: { inverseAction?: { payload?: { sourceTransition?: { clips?: unknown[] } } } }[];
            };
            expect(saved.past).toHaveLength(1);
            expect(saved.past?.[0]?.inverseAction?.payload?.sourceTransition?.clips).toHaveLength(1);
        });
        clearHandlerRegistry();
        registerProductionHandlers();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.clips[0]).not.toHaveProperty(
            'audioOffsetSeconds'
        );
        await redo();
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(
            getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.clips[0]?.audioOffsetSeconds
        ).toBe(1);
    });

    it('keeps audio source time intact when saved replay pairs omit an already materialized source', async () => {
        clearHandlerRegistry();
        registerProductionHandlers();
        arrangeLegacyAudio();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } });
        flushAutomergeStorageWrites();
        await vi.waitFor(() => expect(sessionStorage.getItem('sourdaw-undo-session')).not.toBeNull());
        const saved = JSON.parse(sessionStorage.getItem('sourdaw-undo-session')!) as {
            past: {
                inverseAction: { payload: { sourceTransition: { clips: unknown[] } } };
                redoAction: { payload: { sourceTransition: { clips: unknown[] } } };
            }[];
        };
        expect(saved.past).toHaveLength(1);
        saved.past[0]!.inverseAction.payload.sourceTransition.clips = [];
        saved.past[0]!.redoAction.payload.sourceTransition.clips = [];
        sessionStorage.setItem('sourdaw-undo-session', JSON.stringify(saved));
        clearHandlerRegistry();
        registerProductionHandlers();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(transportStore.value?.tempo).toBe(120);
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(
            getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.clips[0]?.audioOffsetSeconds
        ).toBe(1);
    });

    it('drops a saved replay with malformed canonical source seconds before any project write', async () => {
        clearHandlerRegistry();
        registerProductionHandlers();
        arrangeLegacyAudio();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } });
        flushAutomergeStorageWrites();
        await vi.waitFor(() => expect(sessionStorage.getItem('sourdaw-undo-session')).not.toBeNull());
        const saved = JSON.parse(sessionStorage.getItem('sourdaw-undo-session')!) as {
            past: { inverseAction: { payload: { sourceTransition: { clips: { audioOffsetSeconds: unknown }[] } } } }[];
        };
        expect(saved.past).toHaveLength(1);
        saved.past[0]!.inverseAction.payload.sourceTransition.clips[0]!.audioOffsetSeconds = 'invalid';
        sessionStorage.setItem('sourdaw-undo-session', JSON.stringify(saved));
        const raw = structuredClone(getCrdtDoc('root'));
        const projected = structuredClone(trackStore.value);
        clearHandlerRegistry();
        registerProductionHandlers();
        expect(undoStore.value?.past).toHaveLength(0);
        expect(getCrdtDoc('root')).toEqual(raw);
        expect(trackStore.value).toEqual(projected);
    });

    it('retains a legacy comp take and an inactive alternative when a named tempo event changes', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        arrangeLegacyAudio();
        const track = trackStore.value!.tracks[0]!;
        const active = { ...track.clips[0]!, startBeat: 6, endBeat: 10 };
        const inactive = { ...active, id: 'inactive-clip', audioOffsetBeats: 4 };
        trackStore.set({
            ...trackStore.value!,
            tracks: [
                {
                    ...track,
                    clips: [active],
                    alternatives: [
                        { id: 'alt-1', name: 'Alternative 1', clips: [] },
                        { id: 'alt-2', name: 'Alternative 2', clips: [inactive] },
                    ],
                },
            ],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'audio-track',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: active.id,
                            name: 'Take',
                            startBeat: 6,
                            endBeat: 10,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 6, endBeat: 10, takeId: 'take-1' }],
                },
            ],
        });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'setTempo', payload: { bpm: 120, tempoChangeId: 'slow' } });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(2);
        expect(trackStore.value?.tracks[0]?.alternatives[1]?.clips[0]?.audioOffsetSeconds).toBe(4);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(2);
        expect(resolveClipsWithComping('audio-track', trackStore.value!.tracks[0]!.clips)[0]?.audioOffsetSeconds).toBe(
            4
        );
        const raw = getCrdtDoc<{
            tracks: { tracks: Track[] };
            takeLanes: NonNullable<typeof takeLaneStore.value>;
        }>('root');
        expect(raw?.tracks.tracks).toEqual(trackStore.value?.tracks);
        expect(raw?.takeLanes).toEqual(takeLaneStore.value);

        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(trackStore.value?.tracks[0]?.alternatives[1]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(takeLaneStore.value?.lanes[0]?.takes[0]).not.toHaveProperty('sourceOffsetSeconds');
        await redo();
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(2);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(2);

        registerHandlerMap(getArrangementHandlers());
        await executeAppAction({
            type: 'switchTrackAlternative',
            payload: { trackId: 'audio-track', alternativeId: 'alt-2' },
        });
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({ id: 'inactive-clip', audioOffsetSeconds: 4 });
    });

    it('refuses Undo after an inbound peer source edit without changing tempo, raw truth or history', async () => {
        arrangeLegacyAudio();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } });
        const stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        try {
            mutateCrdtDoc<{ tracks: { tracks: Track[] } }>({
                id: 'root',
                changeFn: (project) => {
                    project.tracks.tracks[0]!.clips[0]!.audioOffsetSeconds = 7;
                },
            });
            expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(7);
            const raw = structuredClone(getCrdtDoc('root'));
            const projected = structuredClone(trackStore.value);
            const history = undoStore.value;
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(trackStore.value).toEqual(projected);
            expect(transportStore.value?.tempo).toBe(60);
            expect(undoStore.value).toBe(history);
        } finally {
            stopBridge();
        }
    });

    it('refuses Undo when a peer adds affected legacy audio to an inactive alternative', async () => {
        arrangeLegacyAudio();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } });
        const stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        try {
            mutateCrdtDoc<{ tracks: { tracks: Track[] } }>({
                id: 'root',
                changeFn: (project) => {
                    const peer = {
                        ...project.tracks.tracks[0]!.clips[0]!,
                        id: 'peer-legacy',
                        audioOffsetBeats: 4,
                    };
                    delete peer.audioOffsetSeconds;
                    project.tracks.tracks[0]!.alternatives[0]!.clips.push(peer);
                },
            });
            const raw = structuredClone(getCrdtDoc('root'));
            const projected = structuredClone(trackStore.value);
            const history = undoStore.value;
            expect(trackStore.value?.tracks[0]?.alternatives[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(trackStore.value).toEqual(projected);
            expect(transportStore.value?.tempo).toBe(60);
            expect(undoStore.value).toBe(history);
        } finally {
            stopBridge();
        }
    });

    it('refuses Undo when a peer adds an affected legacy comp take', async () => {
        arrangeLegacyAudio();
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'audio-track',
                    takes: [
                        {
                            id: 'original-take',
                            clipId: 'legacy-clip',
                            name: 'Original',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'original-take' }],
                },
            ],
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } });
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(1);
        const stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        try {
            mutateCrdtDoc<{ takeLanes: NonNullable<typeof takeLaneStore.value> }>({
                id: 'root',
                changeFn: (project) => {
                    project.takeLanes.lanes[0]!.takes.push({
                        id: 'peer-take',
                        clipId: 'legacy-clip',
                        name: 'Peer',
                        startBeat: 2,
                        endBeat: 8,
                        selected: false,
                        sourceOffsetBeats: 4,
                    });
                },
            });
            const raw = structuredClone(getCrdtDoc('root'));
            const projected = structuredClone(takeLaneStore.value);
            const history = undoStore.value;
            expect(takeLaneStore.value?.lanes[0]?.takes[1]).not.toHaveProperty('sourceOffsetSeconds');
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(takeLaneStore.value).toEqual(projected);
            expect(transportStore.value?.tempo).toBe(60);
            expect(undoStore.value).toBe(history);
        } finally {
            stopBridge();
        }
    });

    it('commits a named tempo-map edit and keeps its inverse targeted through undo and redo', async () => {
        tempoMapStore.set({ changes: [{ id: 'tempo-0', beat: 0, tempo: 96, curve: 'instant' }] });

        await executeAppAction({ type: 'setTempo', payload: { bpm: 133, tempoChangeId: 'tempo-0' } });

        expect(tempoMapStore.value?.changes).toEqual([{ id: 'tempo-0', beat: 0, tempo: 133, curve: 'instant' }]);
        expect(projectStore.value?.dirty).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Set tempo to 133 BPM');

        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 133, curve: 'instant' },
                { id: 'later-change', beat: 12, tempo: 144, curve: 'instant' },
            ],
        });
        transportStore.set({ ...transportStore.value!, playheadPosition: 12 });
        reset_dirty_state();
        await undo();
        expect(tempoMapStore.value?.changes[0]?.tempo).toBe(96);
        expect(tempoMapStore.value?.changes[1]?.tempo).toBe(144);
        expect(projectStore.value?.dirty).toBe(true);

        reset_dirty_state();
        await redo();
        expect(tempoMapStore.value?.changes[0]?.tempo).toBe(133);
        expect(tempoMapStore.value?.changes[1]).toEqual({ id: 'later-change', beat: 12, tempo: 144, curve: 'instant' });
        expect(projectStore.value?.dirty).toBe(true);
    });

    it('emits no committed notification for a missing tempo target', async () => {
        arrangeLegacyAudio();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 133, tempoChangeId: 'missing' } });

        expect(transportStore.value?.tempo).toBe(120);
        expect(projectStore.value?.dirty).toBe(false);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
    });

    it('keeps a refused ramp edit clean without publishing a committed notification', async () => {
        arrangeLegacyAudio();
        const changes = [
            { id: 'ramp-start', beat: 0, tempo: 100, curve: 'linear' as const },
            { id: 'ramp-end', beat: 8, tempo: 140, curve: 'instant' as const },
        ];
        tempoMapStore.set({ changes });
        updateTransportState({ playheadPosition: 4 });

        await expect(executeAppAction({ type: 'setTempo', payload: { bpm: 133 } })).rejects.toThrow(/tempo ramp/i);

        expect(tempoMapStore.value?.changes).toEqual(changes);
        expect(projectStore.value?.dirty).toBe(false);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
    });

    it('keeps a conflicting guarded edit clean without publishing a committed notification', async () => {
        arrangeLegacyAudio();
        await expect(
            executeAppAction({ type: 'setTempo', payload: { bpm: 133, expectedBpm: 110, tempoChangeId: null } })
        ).rejects.toThrow(/conflict/i);

        expect(transportStore.value?.tempo).toBe(120);
        expect(projectStore.value?.dirty).toBe(false);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
    });

    it('does not report hydration or runtime transport writes as committed tempo edits', () => {
        setTempo({ bpm: 105 });
        updateTransportState({ isPlaying: true, playheadPosition: 12 });

        expect(transportStore.value).toMatchObject({ tempo: 105, isPlaying: true, playheadPosition: 12 });
        expect(projectStore.value?.dirty).toBe(false);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('suppresses dirty state while loading even when a committed tempo notification arrives', async () => {
        projectStore.set({ ...projectStore.value!, loading: true });

        await executeAppAction({ type: 'setTempo', payload: { bpm: 133 } });

        expect(transportStore.value?.tempo).toBe(133);
        expect(tempoProjectRevisionStore.value).toBe((initialTempoRevision ?? 0) + 1);
        expect(projectStore.value?.dirty).toBe(false);
        projectStore.set({ ...projectStore.value!, loading: false });
        expect(projectStore.value?.dirty).toBe(false);
    });

    it('previews the real tempo command without a live dirty or commit notification', async () => {
        arrangeLegacyAudio();
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'tempo-preview',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 133 } },
            availableDeviceVersions: {},
            expectedEffect: 'Tempo becomes 133 BPM.',
            normalizedProjectRevision: revision,
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Preview a tempo edit.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'tempo-preview-batch',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview tempo edit',
            mode: 'preview',
            projectId: 'tempo-preview',
            runId: 'tempo-preview-run',
        });
        const preview = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });
        expect(preview).toMatchObject({ status: 'previewed', projectDocument: { transport: { tempo: 133 } } });
        expect(preview).toMatchObject({
            projectDocument: { tracks: { tracks: [{ clips: [{ audioOffsetSeconds: 1 }] }] } },
        });
        if (preview.status !== 'previewed') {
            throw new Error('Expected an isolated tempo preview');
        }
        try {
            expect(transportStore.value?.tempo).toBe(120);
            expect(getCrdtDoc('root')).toMatchObject({ transport: { tempo: 120 } });
            expect(projectStore.value?.dirty).toBe(false);
            expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        } finally {
            preview.resource.release();
        }
    });
});
