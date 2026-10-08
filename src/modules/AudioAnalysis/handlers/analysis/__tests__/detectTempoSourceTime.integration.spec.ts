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
} from '#/modules/Arrangement/useCases';
import { getAnalysisHandlers } from '#/modules/AudioAnalysis/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { macroStore, clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    productionBriefAdmissionPort,
    redo,
    registerProductionCommandHandlers,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers, tempoSourceDependencies } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function clip(id: string, trackId: string, type: Clip['type'], startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId,
        name: id,
        startBeat,
        endBeat,
        type,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
    };
}

function track(id: string, kind: Track['kind'], clips: Clip[]): Track {
    return {
        id,
        name: id,
        kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#000',
        clips,
        devices: [],
        sends: [],
        midiFx: [],
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
    };
}

function arrangeStaggeredMidiAndLegacyAudio(withTempoMap = false): void {
    const legacy = { ...clip('legacy', 'audio', 'audio', 2, 8), audioBufferId: 'source', audioOffsetBeats: 2 };
    trackStore.set({
        tracks: [
            track('midi', 'midi', [clip('midi-a', 'midi', 'midi', 0, 8), clip('midi-b', 'midi', 'midi', 0.5, 8.5)]),
            track('audio', 'audio', [legacy]),
        ],
        selectedTrackId: 'midi',
        ghostClips: [],
    });
    takeLaneStore.set({
        lanes: [
            {
                id: 'lane',
                trackId: 'audio',
                takes: [
                    {
                        id: 'take',
                        clipId: 'legacy',
                        name: 'Take',
                        startBeat: 2,
                        endBeat: 8,
                        selected: true,
                        sourceOffsetBeats: 2,
                    },
                ],
                activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'take' }],
            },
        ],
    });
    tempoMapStore.set({
        changes: withTempoMap ? [{ id: 'later', beat: 12, tempo: 90, curve: 'instant' }] : [],
    });
    flushAutomergeStorageWrites();
}

function registerHandlers(): void {
    registerProductionCommandHandlers([
        getArrangementHandlers(),
        getAnalysisHandlers(),
        getAudioRenderingHandlers(),
        getAutomationHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
        getMidiNoteTransformHandlers(),
        getTransportHandlers(),
        getYeastHandlers(),
    ]);
}

function rawProject(): unknown {
    return structuredClone(getCrdtDoc('root'));
}

function expectNoProjectWrite(before: unknown): void {
    flushAutomergeStorageWrites();
    expect(rawProject()).toEqual(before);
    expect(undoHistoryStore.value?.past).toHaveLength(0);
    expect(macroStore.value?.currentRecording).toEqual([]);
}

describe('detected tempo source-time write path', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('detected tempo source-time integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        sessionStorage.removeItem('sourdaw-undo-session');
        tempoSourceDependencies.set({
            prepare: prepareAudioSourcesForTempoChange,
            isTransition: isTempoAudioSourceTransition,
        });
        clearUndoHistory();
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        transportStore.set({ ...defaultTransportState, tempo: 120, playheadPosition: 0 });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        registerHandlers();
        vi.mocked(notifyUser).mockClear();
    });

    afterEach(() => {
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        clearUndoHistory();
        clearHandlerRegistry();
        tempoSourceDependencies.set(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('uses one real setTempo command to preserve source time, raw truth, history, and replay', async () => {
        arrangeStaggeredMidiAndLegacyAudio();

        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-a' } });

        expect(transportStore.value?.tempo).toBe(240);
        expect(tempoMapStore.value?.changes).toEqual([]);
        expect(trackStore.value?.tracks[1]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(1);
        const raw = getCrdtDoc<{
            transport: { tempo: number };
            tracks: { tracks: Track[] };
            takeLanes: NonNullable<typeof takeLaneStore.value>;
            tempoMap: NonNullable<typeof tempoMapStore.value>;
        }>('root');
        expect(raw?.transport.tempo).toBe(240);
        expect(raw?.tracks.tracks).toEqual(trackStore.value?.tracks);
        expect(raw?.takeLanes).toEqual(takeLaneStore.value);
        expect(raw?.tempoMap).toEqual(tempoMapStore.value);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.past[0]?.action.type).toBe('setTempo');
        expect(undoHistoryStore.value?.past[0]?.inverseAction).toMatchObject({
            type: 'setTempo',
            payload: {
                tempoChangeId: null,
                sourceTransition: {
                    direction: 'restore',
                    clips: [{ audioOffsetSeconds: 1 }],
                    takes: [{ sourceOffsetSeconds: 1 }],
                },
            },
        });
        expect(macroStore.value?.currentRecording.map((action) => action.type)).toEqual(['setTempo']);
        await vi.waitFor(() => {
            const saved = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}') as { past?: unknown[] };
            expect(saved.past).toHaveLength(1);
        });

        clearHandlerRegistry();
        registerHandlers();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        await undo();
        expect(transportStore.value?.tempo).toBe(120);
        expect(trackStore.value?.tracks[1]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(takeLaneStore.value?.lanes[0]?.takes[0]).not.toHaveProperty('sourceOffsetSeconds');
        expect(tempoMapStore.value?.changes).toEqual([]);
        await redo();
        expect(transportStore.value?.tempo).toBe(240);
        expect(trackStore.value?.tracks[1]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(1);
    });

    it('changes only the base when a tempo map governs even before its first event', async () => {
        arrangeStaggeredMidiAndLegacyAudio(true);
        const map = structuredClone(tempoMapStore.value?.changes);

        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-a' } });

        expect(transportStore.value?.tempo).toBe(240);
        expect(tempoMapStore.value?.changes).toEqual(map);
        expect(trackStore.value?.tracks[1]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(takeLaneStore.value?.lanes[0]?.takes[0]).not.toHaveProperty('sourceOffsetSeconds');
        const raw = getCrdtDoc<{
            transport: { tempo: number };
            tempoMap: NonNullable<typeof tempoMapStore.value>;
            tracks: { tracks: Track[] };
            takeLanes: NonNullable<typeof takeLaneStore.value>;
        }>('root');
        expect(raw?.transport.tempo).toBe(240);
        expect(raw?.tempoMap.changes).toEqual(map);
        expect(raw?.tracks.tracks).toEqual(trackStore.value?.tracks);
        expect(raw?.takeLanes).toEqual(takeLaneStore.value);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.past[0]?.inverseAction).toMatchObject({
            type: 'setTempo',
            payload: { tempoChangeId: null },
        });
        await undo();
        expect(transportStore.value?.tempo).toBe(120);
        expect(tempoMapStore.value?.changes).toEqual(map);
    });

    it('leaves project truth and history untouched for a matching detected tempo', async () => {
        trackStore.set({
            tracks: [track('midi', 'midi', [clip('midi-a', 'midi', 'midi', 0, 8)])],
            selectedTrackId: 'midi',
        });
        flushAutomergeStorageWrites();
        const before = rawProject();

        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-a' } });

        expectNoProjectWrite(before);
    });

    it('does not write when project onset evidence is insufficient', async () => {
        trackStore.set({
            tracks: [track('midi', 'midi', [clip('midi-a', 'midi', 'midi', 0, 1)])],
            selectedTrackId: 'midi',
        });
        flushAutomergeStorageWrites();
        const before = rawProject();

        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-a' } });

        expectNoProjectWrite(before);
        expect(notifyUser).toHaveBeenCalledWith(
            'Could not confidently detect tempo — add more content first',
            'warning'
        );
    });

    it('does not write when the project has no transport state', async () => {
        arrangeStaggeredMidiAndLegacyAudio();
        transportStore.set(null);
        flushAutomergeStorageWrites();
        const before = rawProject();

        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-a' } });

        expectNoProjectWrite(before);
    });

    it('keeps clip-specific detection informational', async () => {
        arrangeStaggeredMidiAndLegacyAudio();
        const before = rawProject();

        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'legacy' } });

        expectNoProjectWrite(before);
    });

    it('refuses a project tempo write when current production intent denies setTempo', async () => {
        arrangeStaggeredMidiAndLegacyAudio();
        const before = rawProject();
        const admitted: string[][] = [];
        productionBriefAdmissionPort.setGuard((actions) => {
            admitted.push(actions.map((action) => action.type));
            return { allowsCurrent: () => actions.every((action) => action.type !== 'setTempo') };
        });

        await expect(executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-a' } })).rejects.toThrow();

        expect(admitted).toContainEqual(['setTempo']);
        expectNoProjectWrite(before);
    });

    it('cancels before child admission and leaves no write or history', async () => {
        arrangeStaggeredMidiAndLegacyAudio();
        const before = rawProject();
        let releaseAdmission!: () => void;
        let enteredAdmission!: () => void;
        const admission = new Promise<void>((resolve) => (releaseAdmission = resolve));
        const reachedAdmission = new Promise<void>((resolve) => (enteredAdmission = resolve));
        configureAutomergeStoragePort({
            getDoc: (docId) => getCrdtDoc(docId),
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => getCrdtDoc(docId) !== undefined,
            mutateDoc: ({ docId, changeFn, message, snapshotTransaction, changedKeys }) => {
                mutateCrdtDoc({ id: docId, changeFn, message, snapshotTransaction, localSlots: changedKeys });
            },
            waitForSnapshotTransaction: () => {
                enteredAdmission();
                return admission;
            },
        });
        const controller = new AbortController();
        const execution = executeAppAction(
            { type: 'detectTempo', payload: { clipId: 'midi-a' } },
            { signal: controller.signal }
        );
        await reachedAdmission;
        controller.abort();
        releaseAdmission();
        await Promise.allSettled([execution]);

        expectNoProjectWrite(before);
        expect(notifyUser).not.toHaveBeenCalledWith(expect.stringContaining('Detected tempo'), 'success');
    });
});
