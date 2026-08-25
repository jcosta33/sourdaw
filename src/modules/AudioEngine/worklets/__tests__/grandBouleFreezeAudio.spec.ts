import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { freezeTrack } from '#/modules/Arrangement/useCases';

import {
    createOfflineWorkletRenderHarness,
    harnessRmsBetween,
} from '../../../../helpers/__tests__/offlineWorkletRenderHarness';
import { audioBufferCache } from '../../stores/audioBufferCache';

/**
 * Freezing a Grand Boule track must preserve audible note output.
 *
 * The original defect: freeze renders through `OfflineAudioContext`, the
 * offline transport starved the worklet ring, and the resulting 97–99 % silent
 * buffer was baked — `flattenTrack` then replaces the track's `clips` with it
 * and sets `devices: []`. Two ordinary clicks destroyed a piano track,
 * recoverable only from CRDT undo history.
 *
 * This drives the real
 * `freezeTrack` -> real `renderTrackOffline` -> real `renderTrackSubgraphOffline`
 * -> real device chain -> real offline processor, then reads the cached buffer.
 */

const SAMPLE_RATE = 44_100;
const TEMPO = 120;
const SECONDS_PER_BEAT = 60 / TEMPO;

/** `\0asm` + version 1 — the shortest byte string `WebAssembly.compile` accepts. */
const EMPTY_WASM_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer;

const wasmStub = vi.hoisted(() => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const MAX_BLOCK = 4096;
    const LEFT_PTR = 0;
    const RIGHT_PTR = MAX_BLOCK * Float32Array.BYTES_PER_ELEMENT;

    /** A steady tone per held note, so a device that did build is unmistakable. */
    class GrandBouleInstanceStub {
        readonly phases = new Map<number, number>();

        constructor(
            readonly instanceSampleRate: number,
            readonly voiceCount: number
        ) {}

        note_on(midiNote: number, _velocity: number): void {
            this.phases.set(midiNote, this.phases.get(midiNote) ?? 0);
        }
        note_on_with_channel(midiNote: number, velocity: number, _channel: number): void {
            this.note_on(midiNote, velocity);
        }
        note_off(midiNote: number): void {
            this.phases.delete(midiNote);
        }
        note_off_on_channel(midiNote: number, _channel: number): void {
            this.phases.delete(midiNote);
        }
        note_expression(): void {}
        set_param(): void {}
        set_sustain(): void {}
        set_una_corda(): void {}
        set_sostenuto(): void {}
        note_on_midi2(): void {}
        set_temperament(): void {}
        load_attack_clip(): void {}
        all_notes_off(): void {
            this.phases.clear();
        }

        process(frames: number): number {
            const left = new Float32Array(memory.buffer, LEFT_PTR, frames);
            const right = new Float32Array(memory.buffer, RIGHT_PTR, frames);
            left.fill(0);
            right.fill(0);
            for (const [midiNote, phase] of this.phases) {
                const step = (2 * Math.PI * (440 * 2 ** ((midiNote - 69) / 12))) / this.instanceSampleRate;
                for (let index = 0; index < frames; index++) {
                    const sample = Math.sin(phase + step * index) * 0.3;
                    left[index] = (left[index] ?? 0) + sample;
                    right[index] = (right[index] ?? 0) + sample;
                }
                this.phases.set(midiNote, phase + step * frames);
            }
            return LEFT_PTR;
        }

        get_right_ptr(): number {
            return RIGHT_PTR;
        }
    }

    return { memory, GrandBouleInstanceStub };
});

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: () => ({ memory: wasmStub.memory }),
    GrandBouleInstance: wasmStub.GrandBouleInstanceStub,
}));

vi.mock('../grandBouleProcessor.ts?worker&url', () => ({ default: 'grand-boule-processor-url' }));
vi.mock('../grandBouleOfflineProcessor.ts?worker&url', () => ({
    default: 'grand-boule-offline-processor-url',
}));

vi.mock('../../useCases/engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: SAMPLE_RATE }),
}));

const harness = createOfflineWorkletRenderHarness();

function grandBouleTrack(): Track {
    return {
        id: 'gb-freeze-track',
        name: 'Piano',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#fff',
        clips: [
            {
                id: 'gb-freeze-clip',
                trackId: 'gb-freeze-track',
                name: 'Piano Clip',
                startBeat: 0,
                endBeat: 4,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#fff',
                locked: false,
                muted: false,
            },
        ],
        devices: [{ id: 'gb-device', name: 'Grand Boule', type: 'grand-boule', bypassed: false, parameterValues: {} }],
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
}

describe('freezing a Grand Boule track', () => {
    beforeAll(async () => {
        harness.installWorkletGlobals({ sampleRate: SAMPLE_RATE });
        await import('../grandBouleOfflineProcessor');
    });

    beforeEach(async () => {
        vi.stubGlobal('OfflineAudioContext', harness.OfflineAudioContext);
        vi.stubGlobal('AudioWorkletNode', harness.AudioWorkletNode);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(EMPTY_WASM_MODULE.slice(0)),
            })
        );
        audioBufferCache.clear();

        const { configureOfflineMidiEventProjection } =
            await import('../../useCases/configureOfflineMidiEventProjection');
        const { configureOfflinePpqEndpointProjection } =
            await import('../../useCases/configureOfflinePpqEndpointProjection');
        const { configureOfflineYeastMidiProcessing } =
            await import('../../useCases/configureOfflineYeastMidiProcessing');
        configureOfflinePpqEndpointProjection({
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
            project: ({ startPpq, endPpq, defaultTempo, sampleRate: rate }) => {
                const startSamples = Math.round((startPpq / defaultTempo) * 60 * rate);
                const endSamples = Math.round((endPpq / defaultTempo) * 60 * rate);
                return {
                    startSamples,
                    endSamples,
                    durationSamples: endSamples - startSamples,
                    startSeconds: startSamples / rate,
                    endSeconds: endSamples / rate,
                    durationSeconds: (endSamples - startSamples) / rate,
                };
            },
        });
        configureOfflineMidiEventProjection({
            createProjector: () => (input) => input.events,
            selectProbability: () => true,
            createChordPitchProjector: () => (input) => input.pitch,
            evaluateAutomationValue: () => 0,
        });
        configureOfflineYeastMidiProcessing({ createProcessor: () => () => [] });

        const { midiStore } = await import('#/modules/MIDI/stores');
        const { transportStore } = await import('#/modules/Transport/stores');
        transportStore.set({ ...transportStore.value!, tempo: TEMPO });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'gb-freeze-clip': [{ id: 'n1', pitch: 60, startBeat: 1, duration: 2, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        trackStore.set({ tracks: [grandBouleTrack()], selectedTrackId: null, ghostClips: [] });
    });

    it('caches an audible buffer and records the freeze', async () => {
        const froze = await freezeTrack('gb-freeze-track');

        const frozen = trackStore.value?.tracks.find((track) => track.id === 'gb-freeze-track');
        const freezeState = frozen?.freezeState;
        const bufferId = freezeState?.status === 'frozen' ? freezeState.frozenBufferId : undefined;
        let buffer: AudioBuffer | undefined;
        if (bufferId !== undefined) {
            buffer = audioBufferCache.get(bufferId);
        }

        let noteEnergy = 0;
        if (buffer !== undefined) {
            noteEnergy = harnessRmsBetween({
                buffer,
                startSeconds: 1 * SECONDS_PER_BEAT + 0.05,
                endSeconds: 3 * SECONDS_PER_BEAT - 0.05,
            });
        }

        expect({
            froze,
            status: freezeState?.status,
            cachedBuffer: buffer !== undefined,
            trackFrozen: frozen?.frozen === true,
            noteAudible: noteEnergy > 0.02,
        }).toEqual({
            froze: true,
            status: 'frozen',
            cachedBuffer: true,
            trackFrozen: true,
            noteAudible: true,
        });
    });
});
