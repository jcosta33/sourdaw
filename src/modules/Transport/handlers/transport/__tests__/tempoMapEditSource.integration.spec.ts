import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeAppAction,
    redo,
    registerProductionCommandHandlers,
    serializeVersionedCommandEnvelope,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { initProjectDirtyTracking } from '#/modules/Project/useCases';
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
