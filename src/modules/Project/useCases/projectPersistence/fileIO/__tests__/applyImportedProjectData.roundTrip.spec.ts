import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { CURRENT_PROJECT_VERSION, type ProjectData, type ProjectTrack } from '../../../../models/ProjectData';
import { arrangementStore, defaultArrangementStoreState } from '../../../../stores/arrangementStore';
import { resetModuleStoresToDefault } from '../../helpers/resetModuleStoresToDefault';
import { applyImportedProjectData } from '../applyImportedProjectData';

// Capture the ids the owner restore use case is asked to load — the keystone consequence is
// that this list is NON-empty once the clip-shape mapping resolves bufferId.
// Declared via vi.hoisted so the hoisted vi.mock factory below can close over it.
type RestoreCachedAudioBuffersInput = {
    audioContext: object;
    bufferIds?: string[];
    shouldContinue?: () => boolean;
};

type ImportCachedAudioBuffersInput = {
    audioContext: object;
    buffers: Record<string, { sampleRate: number; numberOfChannels: number; channelData: string[] }>;
    shouldContinue?: () => boolean;
};

const { audioContext, importCachedAudioBuffers, restoreCachedAudioBuffersFromIdb } = vi.hoisted(() => ({
    audioContext: {},
    importCachedAudioBuffers: vi.fn<(input: ImportCachedAudioBuffersInput) => Promise<number>>().mockResolvedValue(0),
    restoreCachedAudioBuffersFromIdb: vi
        .fn<(input: RestoreCachedAudioBuffersInput) => Promise<number>>()
        .mockResolvedValue(0),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: () => audioContext,
    getCachedAudioBuffer: () => null,
    importCachedAudioBuffers,
    resetAudioGraph: vi.fn(),
    restoreCachedAudioBuffersFromIdb,
}));
vi.mock('#/modules/Command/useCases', () => ({ clearUndoHistory: vi.fn() }));
vi.mock('#/modules/Transport/useCases', () => ({ stopPlayback: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
// The §13.1 device-store reset runs before hydration; its per-device resets are
// not what this round-trip asserts (it checks the hydrated track/transport/midi/
// arrangement values), so stub it out to avoid pulling in every device store.
vi.mock('../../helpers/resetModuleStoresToDefault', () => ({ resetModuleStoresToDefault: vi.fn() }));

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
        importCachedAudioBuffers.mockClear();
        restoreCachedAudioBuffersFromIdb.mockClear();
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

    it('resolves clip bufferIds and passes them to restoreCachedAudioBuffersFromIdb (keystone)', async () => {
        await applyImportedProjectData({ data: makeProject() });

        expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1);
        const call = restoreCachedAudioBuffersFromIdb.mock.calls[0]?.[0];
        expect(call?.audioContext).toBe(audioContext);
        expect(call?.bufferIds).toEqual(['buf-frozen', 'buf-1', 'buf-2', 'buf-alt']);
        expect(call?.shouldContinue?.()).toBe(true);
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
        restoreCachedAudioBuffersFromIdb.mockImplementationOnce(
            () =>
                new Promise<number>((resolve) => {
                    completeRestore = () => {
                        buffersRestored = true;
                        resolve(2);
                    };
                })
        );
        const publicationStates: boolean[] = [];
        const unsubscribe = trackStore.subscribe((state) => {
            if (state.tracks.some((track) => track.id === 'track-audio')) {
                publicationStates.push(buffersRestored);
            }
        });

        const applying = applyImportedProjectData({ data: makeProject() });
        await vi.waitFor(() => expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1));

        expect(publicationStates).toEqual([]);
        const finishRestore = completeRestore;
        if (!finishRestore) {
            throw new Error('Expected pending audio-buffer restoration');
        }
        finishRestore();
        await applying;
        unsubscribe();

        expect(publicationStates).toEqual([true]);
    });

    it('passes an empty buffer list when no clips reference buffers', async () => {
        const project = makeProject();
        project.arrangement.tracks = [baseTrack('track-audio', [])];

        await applyImportedProjectData({ data: project });

        expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1);
        const call = restoreCachedAudioBuffersFromIdb.mock.calls[0]?.[0];
        expect(call?.audioContext).toBe(audioContext);
        expect(call?.bufferIds).toEqual([]);
        expect(call?.shouldContinue?.()).toBe(true);
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
        const malformed = makeProject();
        Reflect.set(malformed.midi.notesByClipId, 'clip-midi', null);
        trackStore.set({ tracks: [], selectedTrackId: null });

        await expect(applyImportedProjectData({ data: malformed })).resolves.toBe(false);

        expect(resetModuleStoresToDefault).not.toHaveBeenCalled();
        expect(restoreCachedAudioBuffersFromIdb).not.toHaveBeenCalled();
        expect(trackStore.value).toEqual({ tracks: [], selectedTrackId: null });
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
        });
        expect(importInput?.shouldContinue?.()).toBe(true);
        expect(importCachedAudioBuffers.mock.invocationCallOrder[0]).toBeLessThan(
            restoreCachedAudioBuffersFromIdb.mock.invocationCallOrder[0]!
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
        project.arrangements = [first, second];
        project.activeArrangementId = second.id;

        await applyImportedProjectData({ data: project });

        expect(arrangementStore.value?.arrangements.map(({ id, name }) => ({ id, name }))).toEqual([
            { id: 'verse', name: 'Verse' },
            { id: 'chorus', name: 'Chorus' },
        ]);
        expect(arrangementStore.value?.activeArrangementId).toBe('chorus');
    });
});
