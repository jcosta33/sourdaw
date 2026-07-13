import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { CURRENT_PROJECT_VERSION, type ProjectData, type ProjectTrack } from '../../../../models/ProjectData';
import { arrangementStore, defaultArrangementStoreState } from '../../../../stores/arrangementStore';
import { applyImportedProjectData } from '../applyImportedProjectData';

// Capture the ids the owner restore use case is asked to load — the keystone consequence is
// that this list is NON-empty once the clip-shape mapping resolves bufferId.
// Declared via vi.hoisted so the hoisted vi.mock factory below can close over it.
const { audioContext, restoreCachedAudioBuffersFromIdb } = vi.hoisted(() => ({
    audioContext: {},
    restoreCachedAudioBuffersFromIdb: vi.fn().mockResolvedValue(0),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: () => audioContext,
    getCachedAudioBuffer: () => null,
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
            tracks: [baseTrack('track-audio', [audioClip('clip-a', 'buf-1'), audioClip('clip-b', 'buf-2')])],
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
        restoreCachedAudioBuffersFromIdb.mockClear();
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
        await applyImportedProjectData(makeProject());

        expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1);
        expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledWith({
            audioContext,
            bufferIds: expect.arrayContaining(['buf-1', 'buf-2']),
        });
        const call = restoreCachedAudioBuffersFromIdb.mock.calls[0]?.[0];
        expect(call?.bufferIds).toHaveLength(2);
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

        const applying = applyImportedProjectData(makeProject());
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

    it('passes undefined bufferIds to restoreCachedAudioBuffersFromIdb when no clips reference buffers', async () => {
        const project = makeProject();
        project.arrangement.tracks = [baseTrack('track-audio', [])];

        await applyImportedProjectData(project);

        expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1);
        expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledWith({
            audioContext,
            bufferIds: undefined,
        });
    });

    it('hydrates the transport store from the imported transport block', async () => {
        await applyImportedProjectData(makeProject());

        const transport = transportStore.value!;
        expect(transport.tempo).toBe(137);
        expect(transport.timeSignatureNumerator).toBe(3);
        expect(transport.isLooping).toBe(true);
        expect(transport.loopEnd).toBe(12);
        expect(transport.masterGain).toBe(64);
    });

    it('hydrates the MIDI store (notes + CC) from the imported midi maps', async () => {
        await applyImportedProjectData(makeProject());

        const midi = midiStore.value!;
        expect(midi.notesByClipId['clip-midi']?.[0]?.pitch).toBe(72);
        const cc = midi.ccByClipId['clip-midi']?.[0];
        expect(cc?.controller).toBe(7);
        expect(cc?.value).toBe(90);
        // The serialized CC carried no id; hydration mints a deterministic one.
        expect(cc?.id).toBe('cc-clip-midi-0');
    });

    it('exposes the imported tracks on the active arrangement snapshot', async () => {
        await applyImportedProjectData(makeProject());

        const state = arrangementStore.value!;
        const active = state.arrangements.find((a) => a.id === state.activeArrangementId);
        expect(active?.tracks.tracks[0]?.clips.map((c) => c.id)).toEqual(['clip-a', 'clip-b']);
    });
});
