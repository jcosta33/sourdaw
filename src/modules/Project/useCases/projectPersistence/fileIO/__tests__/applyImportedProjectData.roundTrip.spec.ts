import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { CURRENT_PROJECT_VERSION, type ProjectData, type ProjectTrack } from '../../../../models/ProjectData';
import { arrangementStore, defaultArrangementStoreState } from '../../../../stores/arrangementStore';
import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { resetModuleStoresToDefault } from '../../helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from '../../helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../../projectIdentityTransitionDependencies';
import { applyImportedProjectData } from '../applyImportedProjectData';

// Capture the ids the owner restore use case is asked to load — the keystone consequence is
// that this list is NON-empty once the clip-shape mapping resolves bufferId.
// Declared via vi.hoisted so the hoisted vi.mock factory below can close over it.
type PrepareCachedAudioBuffersInput = {
    audioContext: object;
    bufferIds?: string[];
    shouldContinue?: () => boolean;
};

type ImportCachedAudioBuffersInput = {
    audioContext: object;
    buffers: Record<string, { sampleRate: number; numberOfChannels: number; channelData: string[] }>;
    cacheIds?: string[];
    shouldContinue?: () => boolean;
};

type PreparedAudioBuffers = { publish: () => number };
type PreparedImportedAudioBuffers = PreparedAudioBuffers & { persist: () => Promise<boolean> };

const {
    audioContext,
    compactProject,
    crdtAuthority,
    engineGraph,
    importCachedAudioBuffers,
    notifyUser,
    prepareCachedAudioBuffersFromIdb,
    persistCrdtProject,
    resetAudioGraph,
    resetCrdtProjectAuthority,
    resetMidiState,
    restoreOldAudioGraph,
    setSidechainRoutes,
    startCrdtAutoSave,
    stopAllScheduled,
    stopAudioRecording,
    stopRecording,
} = vi.hoisted(() => {
    function prepared(): PreparedImportedAudioBuffers {
        return { persist: () => Promise.resolve(true), publish: () => 0 };
    }
    const engineGraph = { value: 'old-project' };
    const crdtAuthority = { value: 'Old Project' };
    const resetAudioGraph = vi.fn(() => {
        engineGraph.value = 'empty';
    });
    const resetCrdtProjectAuthority = vi.fn((name: string) => {
        crdtAuthority.value = name;
    });
    const restoreOldAudioGraph = vi.fn(() => {
        engineGraph.value = 'old-project';
    });
    return {
        audioContext: {},
        compactProject: vi.fn().mockResolvedValue(undefined),
        crdtAuthority,
        engineGraph,
        importCachedAudioBuffers: vi
            .fn<(input: ImportCachedAudioBuffersInput) => Promise<PreparedImportedAudioBuffers | null>>()
            .mockResolvedValue(prepared()),
        notifyUser: vi.fn(),
        prepareCachedAudioBuffersFromIdb: vi
            .fn<(input: PrepareCachedAudioBuffersInput) => Promise<PreparedAudioBuffers | null>>()
            .mockResolvedValue(prepared()),
        persistCrdtProject: vi.fn().mockResolvedValue(undefined),
        resetAudioGraph,
        resetCrdtProjectAuthority,
        resetMidiState: vi.fn(),
        restoreOldAudioGraph,
        setSidechainRoutes: vi.fn(),
        startCrdtAutoSave: vi.fn(() => vi.fn()),
        stopAllScheduled: vi.fn(),
        stopAudioRecording: vi.fn(),
        stopRecording: vi.fn(),
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        cancelPendingAudioBufferImport: vi.fn(),
        getAudioContext: () => audioContext,
        getCachedAudioBuffer: () => null,
        importCachedAudioBuffers,
        prepareCachedAudioBuffersFromIdb,
        resetAudioGraph,
        stopAllScheduled,
        stopAudioRecording,
        cancelTrackAutomationRamps: vi.fn(),
    };
});
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    return { ...actual, resetMidiState };
});
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return { ...actual, stopRecording };
});
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
    executeAppAction: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    compactProject,
    persistCrdtProject,
    projectActionHistoryToStore: vi.fn(),
    resetCrdtProjectAuthority,
    startCrdtAutoSave,
}));
vi.mock('#/modules/Routing/useCases', () => ({ setSidechainRoutes }));
vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        ensureTrackStrips: restoreOldAudioGraph,
        restoreTimelineMapSnapshot: vi.fn(),
    };
});
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser }));
// The §13.1 device-store reset runs before hydration; its per-device resets are
// not what this round-trip asserts (it checks the hydrated track/transport/midi/
// arrangement values), so stub it out to avoid pulling in every device store.
vi.mock('../../helpers/resetModuleStoresToDefault', () => ({ resetModuleStoresToDefault: vi.fn() }));
vi.mock('../../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: vi.fn() }));
vi.mock('../../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: vi.fn() }));

function audioClip(id: string, bufferId: string): ProjectTrack['clips'][number] {
    return {
        id,
        trackId: 'track-audio',
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
        bufferId,
        sampleStartBeat: 1,
    };
}

function baseTrack(id: string, clips: ProjectTrack['clips']): ProjectTrack {
    return {
        id,
        name: id,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#fff',
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
        activeAlternativeId: `${id}-alt`,
        alternatives: [{ id: `${id}-alt`, name: 'Alt', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function makeProject(): ProjectData {
    const track = baseTrack('track-audio', [audioClip('clip-a', 'buf-1'), audioClip('clip-b', 'buf-2')]);
    track.frozen = true;
    track.frozenBufferId = 'buf-frozen';
    track.freezeState = { status: 'frozen', frozenBufferId: 'buf-frozen' };
    track.alternatives = [
        {
            id: 'track-audio-alt',
            name: 'Alternative',
            clips: [audioClip('clip-alt', 'buf-alt')],
        },
    ];
    return {
        version: CURRENT_PROJECT_VERSION,
        meta: {
            name: 'Round Trip',
            createdAt: 1,
            updatedAt: 2,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        transport: {
            tempo: 137,
            timeSignatureNumerator: 3,
            timeSignatureDenominator: 4,
            loopStart: 4,
            loopEnd: 12,
            isLooping: true,
            metronomeEnabled: true,
            metronomeVolume: 0.7,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 16,
            countInEnabled: false,
            countInBars: 1,
            preRollEnabled: false,
            preRollBars: 2,
            masterGain: 64,
        },
        arrangement: {
            tracks: [track],
        },
        automation: { lanes: [] },
        midi: {
            notesByClipId: {
                'clip-midi': [
                    {
                        id: 'note-1',
                        pitch: 72,
                        startBeat: 0,
                        duration: 2,
                        velocity: 110,
                        probability: 100,
                        pressure: 0,
                        slide: 0,
                        pitchBend: 0,
                    },
                ],
            },
            ccByClipId: {
                'clip-midi': [{ beat: 0, controller: 7, value: 90, channel: 0 }],
            },
            pitchBendByClipId: {},
        },
        mixer: { master: { gain: 1, pan: 0 }, buses: [] },
        markers: [],
        history: { checkpoints: [] },
    };
}

describe('applyImportedProjectData round-trip hydration', () => {
    beforeEach(() => {
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        engineGraph.value = 'old-project';
        crdtAuthority.value = 'Old Project';
        importCachedAudioBuffers.mockClear();
        notifyUser.mockClear();
        prepareCachedAudioBuffersFromIdb.mockClear();
        setSidechainRoutes.mockClear();
        compactProject.mockClear();
        resetCrdtProjectAuthority.mockClear();
        resetAudioGraph.mockClear();
        restoreOldAudioGraph.mockClear();
        persistCrdtProject.mockClear();
        startCrdtAutoSave.mockClear();
        resetMidiState.mockClear();
        stopAllScheduled.mockClear();
        stopAudioRecording.mockClear();
        stopRecording.mockClear();
        vi.mocked(resetModuleStoresToDefault).mockClear();
        transportStore.set({ ...transportStore.value!, tempo: 120, isLooping: false });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    afterEach(() => {
        // Reset every global store this test mutated so the order of test files
        // cannot leak state into an unrelated suite.
        transportStore.set({ ...defaultTransportState });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        trackStore.set({ tracks: [], selectedTrackId: null });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
    });

    it('resolves clip bufferIds and stages them before project publication', async () => {
        await applyImportedProjectData({ data: makeProject() });

        expect(prepareCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1);
        const call = prepareCachedAudioBuffersFromIdb.mock.calls[0]?.[0];
        expect(call?.audioContext).toBe(audioContext);
        expect(call?.bufferIds).toEqual(['buf-frozen', 'buf-1', 'buf-2', 'buf-alt']);
        expect(call?.shouldContinue?.()).toBe(true);
        expect(resetCrdtProjectAuthority).toHaveBeenCalledWith('Round Trip', expect.any(Function));
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({
            audioBufferId: 'buf-1',
            audioOffsetBeats: 1,
        });
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('bufferId');
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('sampleStartBeat');
        expect(trackStore.value?.tracks[0]?.alternatives[0]?.clips[0]).toMatchObject({
            audioBufferId: 'buf-alt',
            audioOffsetBeats: 1,
        });
    });

    it('publishes imported tracks only after their cached audio buffers finish restoring', async () => {
        let completeRestore: (() => void) | undefined;
        let buffersRestored = false;
        const persistEmbedded = vi.fn().mockResolvedValue(true);
        importCachedAudioBuffers.mockResolvedValueOnce({ persist: persistEmbedded, publish: () => 0 });
        prepareCachedAudioBuffersFromIdb.mockImplementationOnce(
            () =>
                new Promise<PreparedAudioBuffers>((resolve) => {
                    completeRestore = () => {
                        resolve({
                            publish: () => {
                                buffersRestored = true;
                                return 2;
                            },
                        });
                    };
                })
        );
        const publicationStates: boolean[] = [];
        const unsubscribe = trackStore.subscribe((state) => {
            if (!state) {
                return;
            }
            if (state.tracks.some((track) => track.id === 'track-audio')) {
                publicationStates.push(buffersRestored);
            }
        });

        const project = makeProject();
        project.audioBuffers = {
            'buf-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['encoded'] },
        };
        const applying = applyImportedProjectData({ data: project });
        await vi.waitFor(() => expect(prepareCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1));

        expect(publicationStates).toEqual([]);
        expect(persistEmbedded).not.toHaveBeenCalled();
        const finishRestore = completeRestore;
        if (!finishRestore) {
            throw new Error('Expected pending audio-buffer restoration');
        }
        finishRestore();
        await applying;
        unsubscribe();

        expect(publicationStates).toEqual([true]);
        expect(persistEmbedded).toHaveBeenCalledTimes(1);
    });

    it('passes an empty buffer list when no clips reference buffers', async () => {
        const project = makeProject();
        project.arrangement.tracks = [baseTrack('track-audio', [])];

        await applyImportedProjectData({ data: project });

        expect(prepareCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1);
        const call = prepareCachedAudioBuffersFromIdb.mock.calls[0]?.[0];
        expect(call?.audioContext).toBe(audioContext);
        expect(call?.bufferIds).toEqual([]);
        expect(call?.shouldContinue?.()).toBe(true);
    });

    it('aborts before live publication when CRDT authority reset fails', async () => {
        trackStore.set({ tracks: [baseTrack('old-track', [])], selectedTrackId: null });
        engineGraph.value = 'old-project';
        crdtAuthority.value = 'Old Project';
        resetCrdtProjectAuthority.mockImplementationOnce(() => {
            throw new Error('branch persistence failed');
        });

        await expect(applyImportedProjectData({ data: makeProject() })).resolves.toBe(false);

        expect(trackStore.value?.tracks[0]?.id).toBe('old-track');
        expect(engineGraph.value).toBe('old-project');
        expect(crdtAuthority.value).toBe('Old Project');
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
        expect(resetAudioGraph).toHaveBeenCalledOnce();
        expect(restoreOldAudioGraph).toHaveBeenCalledOnce();
        // The previous session survives whole, transient flags included. This
        // line used to pin `{ loading: true, initialized: false }` — the flags
        // the aborted import had claimed on entry and never gave back, which
        // left the loading overlay up and `markDirty` permanently short-circuited.
        expect(projectStore.value).toMatchObject({ loading: false, initialized: true });
    });

    it('keeps the committed project live when post-commit embedded persistence fails', async () => {
        trackStore.set({ tracks: [baseTrack('old-track', [])], selectedTrackId: null });
        const persistEmbedded = vi.fn().mockResolvedValue(false);
        const publishEmbedded = vi.fn(() => 0);
        importCachedAudioBuffers.mockResolvedValueOnce({ persist: persistEmbedded, publish: publishEmbedded });
        const project = makeProject();
        project.audioBuffers = {
            'buf-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['encoded'] },
        };

        await expect(applyImportedProjectData({ data: project })).resolves.toBe(true);

        expect(persistEmbedded).toHaveBeenCalledOnce();
        expect(publishEmbedded).toHaveBeenCalledOnce();
        expect(publishEmbedded.mock.invocationCallOrder[0]).toBeLessThan(persistEmbedded.mock.invocationCallOrder[0]!);
        expect(trackStore.value?.tracks[0]?.id).toBe('track-audio');
        expect(engineGraph.value).toBe('empty');
        expect(crdtAuthority.value).toBe('Round Trip');
        expect(resetAudioGraph).toHaveBeenCalledOnce();
        expect(resetCrdtProjectAuthority).toHaveBeenCalledOnce();
        expect(notifyUser).toHaveBeenCalledWith(
            'Project loaded with recovery errors. Save a new copy before closing.',
            'warning'
        );
    });

    it('starts CRDT autosave only after embedded buffers are durable', async () => {
        let finishPersistence: ((persisted: boolean) => void) | undefined;
        const persistEmbedded = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    finishPersistence = resolve;
                })
        );
        importCachedAudioBuffers.mockResolvedValueOnce({ persist: persistEmbedded, publish: () => 0 });
        const project = makeProject();
        project.audioBuffers = {
            'buf-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['encoded'] },
        };

        const applying = applyImportedProjectData({ data: project });
        await vi.waitFor(() => expect(persistEmbedded).toHaveBeenCalledOnce());

        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        const completePersistence = finishPersistence;
        if (!completePersistence) {
            throw new Error('Expected embedded audio-buffer persistence to be pending');
        }
        completePersistence(true);
        await expect(applying).resolves.toBe(true);

        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
        expect(persistEmbedded.mock.invocationCallOrder[0]).toBeLessThan(
            startCrdtAutoSave.mock.invocationCallOrder[0]!
        );
    });

    it('reports success only after the replacement CRDT snapshot is durable', async () => {
        let finishCompaction: (() => void) | undefined;
        compactProject.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishCompaction = resolve;
                })
        );
        let settled = false;
        const applying = applyImportedProjectData({ data: makeProject() }).then((result) => {
            settled = true;
            return result;
        });

        await vi.waitFor(() => expect(compactProject).toHaveBeenCalledOnce());
        expect(settled).toBe(false);
        expect(startCrdtAutoSave).not.toHaveBeenCalled();

        const completeCompaction = finishCompaction;
        if (!completeCompaction) {
            throw new Error('Expected CRDT compaction to be pending');
        }
        completeCompaction();
        await expect(applying).resolves.toBe(true);
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    it('does not let a superseded replacement overwrite newer autosave ownership', async () => {
        let finishFirstPersistence: ((persisted: boolean) => void) | undefined;
        const persistFirst = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    finishFirstPersistence = resolve;
                })
        );
        importCachedAudioBuffers.mockResolvedValueOnce({ persist: persistFirst, publish: () => 0 });
        const firstProject = makeProject();
        firstProject.meta.name = 'First Project';
        firstProject.audioBuffers = {
            'buf-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['encoded'] },
        };
        const firstReplacement = applyImportedProjectData({ data: firstProject });
        await vi.waitFor(() => expect(persistFirst).toHaveBeenCalledOnce());

        const secondProject = makeProject();
        secondProject.meta.name = 'Second Project';
        await expect(applyImportedProjectData({ data: secondProject })).resolves.toBe(true);
        expect(crdtAuthority.value).toBe('Second Project');
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();

        const completeFirstPersistence = finishFirstPersistence;
        if (!completeFirstPersistence) {
            throw new Error('Expected first embedded audio-buffer persistence to be pending');
        }
        completeFirstPersistence(true);
        await expect(firstReplacement).resolves.toBe(true);

        expect(crdtAuthority.value).toBe('Second Project');
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    it('starts the committed project durability lifecycle', async () => {
        await expect(applyImportedProjectData({ data: makeProject() })).resolves.toBe(true);

        expect(trackStore.value?.tracks[0]?.id).toBe('track-audio');
        expect(engineGraph.value).toBe('empty');
        expect(crdtAuthority.value).toBe('Round Trip');
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    it('keeps durability retries active when the initial CRDT snapshot fails', async () => {
        compactProject.mockRejectedValueOnce(new Error('storage unavailable'));

        await expect(applyImportedProjectData({ data: makeProject() })).resolves.toBe(true);

        expect(compactProject).toHaveBeenCalledOnce();
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    it('does not reset or persist when a newer transaction supersedes the prepared load', async () => {
        let finishPreparation: (() => void) | undefined;
        const persistEmbedded = vi.fn().mockResolvedValue(true);
        importCachedAudioBuffers.mockResolvedValueOnce({ persist: persistEmbedded, publish: () => 0 });
        prepareCachedAudioBuffersFromIdb.mockImplementationOnce(
            () =>
                new Promise<PreparedAudioBuffers>((resolve) => {
                    finishPreparation = () => resolve({ publish: () => 0 });
                })
        );
        const project = makeProject();
        project.audioBuffers = {
            'buf-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['encoded'] },
        };
        const loading = applyImportedProjectData({ data: project });
        await vi.waitFor(() => expect(finishPreparation).toBeDefined());
        const newerLoad = runProjectLoadTransaction();
        await newerLoad.prepare();
        newerLoad.activate();

        const completePreparation = finishPreparation;
        if (!completePreparation) {
            throw new Error('Expected audio-buffer preparation to be pending');
        }
        completePreparation();

        await expect(loading).resolves.toBe(false);
        expect(persistEmbedded).not.toHaveBeenCalled();
        expect(resetAudioGraph).not.toHaveBeenCalled();
        expect(trackStore.value?.tracks).toEqual([]);
        expect(engineGraph.value).toBe('old-project');
        expect(crdtAuthority.value).toBe('Old Project');
    });

    it('waits for recording delivery before replacing the graph and project truth', async () => {
        let finishRecordingFlush: (() => void) | undefined;
        stopAudioRecording.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishRecordingFlush = resolve;
            })
        );
        trackStore.set({ tracks: [baseTrack('old-track', [])], selectedTrackId: null });
        transportStore.set({ ...transportStore.value!, isPlaying: true, isRecording: true });

        const applying = applyImportedProjectData({ data: makeProject() });
        await vi.waitFor(() => expect(stopAudioRecording).toHaveBeenCalledOnce());

        expect(resetAudioGraph).not.toHaveBeenCalled();
        expect(trackStore.value?.tracks[0]?.id).toBe('old-track');
        expect(crdtAuthority.value).toBe('Old Project');

        const completeRecordingFlush = finishRecordingFlush;
        if (!completeRecordingFlush) {
            throw new Error('Expected recording flush to be pending');
        }
        completeRecordingFlush();
        await expect(applying).resolves.toBe(true);

        expect(resetAudioGraph).toHaveBeenCalledOnce();
        expect(trackStore.value?.tracks[0]?.id).toBe('track-audio');
        expect(crdtAuthority.value).toBe('Round Trip');
    });

    it('does not replace project truth when superseded during recording delivery', async () => {
        let finishRecordingFlush: (() => void) | undefined;
        stopAudioRecording.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishRecordingFlush = resolve;
            })
        );
        trackStore.set({ tracks: [baseTrack('old-track', [])], selectedTrackId: null });
        transportStore.set({ ...transportStore.value!, isPlaying: true, isRecording: true });

        const applying = applyImportedProjectData({ data: makeProject() });
        await vi.waitFor(() => expect(stopAudioRecording).toHaveBeenCalledOnce());
        const newerLoad = runProjectLoadTransaction();
        await newerLoad.prepare();
        newerLoad.activate();

        const completeRecordingFlush = finishRecordingFlush;
        if (!completeRecordingFlush) {
            throw new Error('Expected recording flush to be pending');
        }
        completeRecordingFlush();
        await expect(applying).resolves.toBe(false);

        expect(resetAudioGraph).not.toHaveBeenCalled();
        expect(trackStore.value?.tracks[0]?.id).toBe('old-track');
        expect(crdtAuthority.value).toBe('Old Project');
    });

    it('finalizes recording before a failed graph reset restores the previous project', async () => {
        const order: string[] = [];
        const persistEmbedded = vi.fn(() => {
            order.push('persist');
            return Promise.resolve(true);
        });
        const publishEmbedded = vi.fn(() => {
            order.push('publish');
            return 1;
        });
        const project = makeProject();
        project.audioBuffers = {
            'buf-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['encoded'] },
        };
        importCachedAudioBuffers.mockResolvedValueOnce({ persist: persistEmbedded, publish: publishEmbedded });
        trackStore.set({ tracks: [baseTrack('old-track', [])], selectedTrackId: null });
        transportStore.set({
            ...transportStore.value!,
            isPlaying: true,
            isRecording: true,
            playheadPosition: 8,
        });
        resetAudioGraph.mockImplementationOnce(() => {
            order.push('reset');
            engineGraph.value = 'empty';
            throw new Error('audio reset failed');
        });

        await expect(applyImportedProjectData({ data: project })).resolves.toBe(false);

        expect(order).toEqual(['reset']);
        expect(publishEmbedded).not.toHaveBeenCalled();
        expect(persistEmbedded).not.toHaveBeenCalled();
        expect(stopAudioRecording).toHaveBeenCalledOnce();
        expect(stopRecording).toHaveBeenCalledOnce();
        expect(stopAllScheduled).toHaveBeenCalled();
        expect(resetMidiState).toHaveBeenCalledOnce();
        expect(stopAudioRecording.mock.invocationCallOrder[0]).toBeLessThan(
            resetAudioGraph.mock.invocationCallOrder[0]!
        );
        expect(trackStore.value?.tracks[0]?.id).toBe('old-track');
        expect(transportStore.value).toMatchObject({ isPlaying: false, isRecording: false });
        expect(engineGraph.value).toBe('old-project');
        expect(crdtAuthority.value).toBe('Old Project');
        expect(restoreOldAudioGraph).toHaveBeenCalledOnce();
    });

    it('continues the committed replacement after a mid-commit store reset failure', async () => {
        vi.mocked(resetModuleStoresToDefault).mockImplementationOnce(() => {
            throw new Error('device store reset failed');
        });

        await expect(applyImportedProjectData({ data: makeProject() })).resolves.toBe(true);

        expect(trackStore.value?.tracks[0]?.id).toBe('track-audio');
        expect(engineGraph.value).toBe('empty');
        expect(crdtAuthority.value).toBe('Round Trip');
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
        expect(restoreOldAudioGraph).not.toHaveBeenCalled();
    });

    it('hydrates the transport store from the imported transport block', async () => {
        await applyImportedProjectData({ data: makeProject() });

        const transport = transportStore.value!;
        expect(transport.tempo).toBe(137);
        expect(transport.timeSignatureNumerator).toBe(3);
        expect(transport.isLooping).toBe(true);
        expect(transport.loopEnd).toBe(12);
        expect(transport.masterGain).toBe(64);
    });

    it('hydrates the MIDI store (notes + CC) from the imported midi maps', async () => {
        await applyImportedProjectData({ data: makeProject() });

        const midi = midiStore.value!;
        expect(midi.notesByClipId['clip-midi']?.[0]?.pitch).toBe(72);
        const cc = midi.ccByClipId['clip-midi']?.[0];
        expect(cc?.controller).toBe(7);
        expect(cc?.value).toBe(90);
        // The serialized CC carried no id; hydration mints a deterministic one.
        expect(cc?.id).toBe('cc-clip-midi-0');
    });

    it('exposes the imported tracks on the active arrangement snapshot', async () => {
        await applyImportedProjectData({ data: makeProject() });

        const state = arrangementStore.value!;
        const active = state.arrangements.find((a) => a.id === state.activeArrangementId);
        expect(active?.tracks.tracks[0]?.clips.map((c) => c.id)).toEqual(['clip-a', 'clip-b']);
    });

    it('rejects malformed hydration data without resetting the live project', async () => {
        const malformedMidi = makeProject();
        Reflect.set(malformedMidi.midi.notesByClipId, 'clip-midi', null);
        const malformedMeta = makeProject();
        Reflect.deleteProperty(malformedMeta.meta, 'name');
        const malformedDevice = makeProject();
        Reflect.set(malformedDevice.arrangement.tracks[0]!.devices, 0, { id: 'device-without-runtime-contract' });
        const malformedAutomation = makeProject();
        Reflect.set(malformedAutomation.automation.lanes, 0, { points: [] });

        for (const malformed of [malformedMidi, malformedMeta, malformedDevice, malformedAutomation]) {
            trackStore.set({ tracks: [], selectedTrackId: null });
            vi.mocked(resetModuleStoresToDefault).mockClear();
            prepareCachedAudioBuffersFromIdb.mockClear();

            await expect(applyImportedProjectData({ data: malformed })).resolves.toBe(false);

            expect(resetModuleStoresToDefault).not.toHaveBeenCalled();
            expect(prepareCachedAudioBuffersFromIdb).not.toHaveBeenCalled();
            expect(trackStore.value).toEqual({ tracks: [], selectedTrackId: null });
        }
    });

    it('rejects embedded PCM that the audio owner cannot prepare', async () => {
        const project = makeProject();
        project.audioBuffers = {
            'buf-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['malformed'] },
        };
        importCachedAudioBuffers.mockResolvedValueOnce(null);

        await expect(applyImportedProjectData({ data: project })).resolves.toBe(false);

        expect(prepareCachedAudioBuffersFromIdb).not.toHaveBeenCalled();
        expect(resetModuleStoresToDefault).not.toHaveBeenCalled();
    });

    it('imports embedded audio before restoring referenced buffers from IDB', async () => {
        const project = makeProject();
        project.audioBuffers = {
            'buf-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['encoded'] },
        };

        await applyImportedProjectData({ data: project });

        const importInput = importCachedAudioBuffers.mock.calls[0]?.[0];
        expect(importInput).toMatchObject({
            audioContext,
            buffers: project.audioBuffers,
            cacheIds: ['buf-frozen', 'buf-1', 'buf-2', 'buf-alt'],
        });
        expect(importInput?.shouldContinue?.()).toBe(true);
        expect(importCachedAudioBuffers.mock.invocationCallOrder[0]).toBeLessThan(
            prepareCachedAudioBuffersFromIdb.mock.invocationCallOrder[0]!
        );
    });

    it('preserves saved arrangements from native project files', async () => {
        const project = makeProject();
        const first = structuredClone(defaultArrangementStoreState.arrangements[0]!);
        const second = structuredClone(first);
        first.id = 'verse';
        first.name = 'Verse';
        second.id = 'chorus';
        second.name = 'Chorus';
        second.tracks.tracks = [baseTrack('inactive-track', [audioClip('inactive-clip', 'inactive-buffer')])];
        project.arrangements = [first, second];
        project.activeArrangementId = second.id;

        await applyImportedProjectData({ data: project });

        expect(arrangementStore.value?.arrangements.map(({ id, name }) => ({ id, name }))).toEqual([
            { id: 'verse', name: 'Verse' },
            { id: 'chorus', name: 'Chorus' },
        ]);
        expect(arrangementStore.value?.activeArrangementId).toBe('chorus');
        expect(prepareCachedAudioBuffersFromIdb.mock.calls[0]?.[0]?.bufferIds).toEqual(['inactive-buffer']);
    });

    it('normalizes sparse version-1 tracks and preserves sparse arrangement records', async () => {
        const project = makeProject();
        const sparseTrack = {
            id: 'sparse-track',
            name: 'Sparse Track',
            kind: 'midi',
            showVariationLanes: true,
            clips: [
                {
                    id: 'sparse-midi-clip',
                    trackId: 'sparse-track',
                    name: 'Sparse MIDI',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'midi',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '#fff',
                    locked: false,
                    muted: false,
                    notes: [{ id: 'sparse-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                },
            ],
        };
        Reflect.set(project.arrangement, 'tracks', [sparseTrack]);
        project.arrangements = [{ id: 'ideas', name: 'Ideas' }];
        project.activeArrangementId = 'ideas';

        await expect(applyImportedProjectData({ data: project })).resolves.toBe(true);

        expect(trackStore.value?.tracks[0]).toMatchObject({
            id: 'sparse-track',
            alternatives: [{ id: 'sparse-track-alt-default', name: 'Alternative 1', clips: [] }],
            freezeState: { status: 'unfrozen' },
            showVariationLanes: true,
        });
        expect(arrangementStore.value?.arrangements[0]?.midi.notesByClipId['sparse-midi-clip']).toEqual([
            {
                id: 'sparse-note',
                pitch: 60,
                startBeat: 0,
                duration: 1,
                velocity: 100,
                probability: 100,
                pressure: 0,
                slide: 0,
                pitchBend: 0,
            },
        ]);
        expect(arrangementStore.value?.arrangements.map(({ id, name }) => ({ id, name }))).toEqual([
            { id: 'ideas', name: 'Ideas' },
        ]);
    });

    it('normalizes missing version-1 automation fields before strict validation', async () => {
        const project = makeProject();
        Reflect.set(project, 'automation', {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-audio',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ beat: 0, value: 0.5, curve: 'linear' }],
                },
            ],
        });

        await expect(applyImportedProjectData({ data: project })).resolves.toBe(true);

        const hydratedArrangement = arrangementStore.value?.arrangements[0];
        if (!hydratedArrangement) {
            throw new Error('expected a hydrated arrangement');
        }
        expect(hydratedArrangement.automation.lanes[0]).toMatchObject({
            points: [{ beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        });
    });

    it('loads a project written before virginTerritory was removed, and drops the field', async () => {
        // A file saved by an older build: the automation lane still carries the
        // retired `virginTerritory` flag. Removing the field made it an
        // unknown extra key rather than a required one, so the strict validator
        // must ignore it instead of rejecting the file — and it must not survive
        // into the hydrated store, or a re-save would write it back out.
        const project = makeProject();
        Reflect.set(project, 'automation', {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-audio',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    virginTerritory: true,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        await expect(applyImportedProjectData({ data: project })).resolves.toBe(true);

        const hydratedLane = arrangementStore.value?.arrangements[0]?.automation.lanes[0];
        expect(hydratedLane).toMatchObject({ id: 'lane-1', enabled: true, minValue: 0, maxValue: 1 });
        expect(hydratedLane).not.toHaveProperty('virginTerritory');
    });

    it('migrates the original version-1 root shape without losing owned state', async () => {
        const canonical = makeProject();
        const legacy = {
            version: 1,
            name: 'Legacy Song',
            createdAt: 10,
            updatedAt: 20,
            tracks: { tracks: canonical.arrangement.tracks, selectedTrackId: 'track-audio' },
            transport: canonical.transport,
            automation: canonical.automation,
            midi: canonical.midi,
            tempoMap: { changes: [{ id: 'tempo-1', beat: 0, tempo: 137, curve: 'linear' }] },
            timeSignatureMap: {
                changes: [{ id: 'meter-1', beat: 0, numerator: 3, denominator: 4 }],
            },
            markers: { markers: [{ id: 'marker-1', beat: 2, name: 'Verse', color: '#fff' }], sections: [] },
            takeLanes: { lanes: [] },
            sidechainRoutes: [
                {
                    id: 'route-1',
                    sourceTrackId: 'track-audio',
                    targetTrackId: 'track-bus',
                    targetDeviceId: 'compressor-1',
                    targetParameterId: 'threshold',
                    gain: 1,
                },
            ],
        };

        await expect(applyImportedProjectData({ data: legacy })).resolves.toBe(true);

        expect(arrangementStore.value?.activeArrangementId).toBe('legacy-arrangement');
        expect(trackStore.value?.selectedTrackId).toBe('track-audio');
        expect(arrangementStore.value?.arrangements[0]?.tempoMap?.changes).toEqual(legacy.tempoMap.changes);
        expect(arrangementStore.value?.arrangements[0]?.timeSignatureMap?.changes).toEqual(
            legacy.timeSignatureMap.changes
        );
        expect(setSidechainRoutes).toHaveBeenCalledWith(legacy.sidechainRoutes);
    });

    it('preserves saved arrangements already present on the legacy root shape', async () => {
        const canonical = makeProject();
        const legacyTracks = { tracks: canonical.arrangement.tracks, selectedTrackId: 'track-audio' };
        const legacy = {
            version: 1,
            name: 'Legacy Arrangements',
            createdAt: 10,
            updatedAt: 20,
            tracks: legacyTracks,
            transport: canonical.transport,
            arrangements: [
                { id: 'verse', name: 'Verse', tracks: legacyTracks },
                { id: 'chorus', name: 'Chorus', tracks: legacyTracks },
            ],
            activeArrangementId: 'chorus',
        };

        await expect(applyImportedProjectData({ data: legacy })).resolves.toBe(true);

        expect(arrangementStore.value?.arrangements.map(({ id }) => id)).toEqual(['verse', 'chorus']);
        expect(arrangementStore.value?.activeArrangementId).toBe('chorus');
    });
});
