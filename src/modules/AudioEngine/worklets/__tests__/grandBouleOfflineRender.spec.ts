import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import {
    createOfflineWorkletRenderHarness,
    harnessRmsBetween,
} from '../../../../helpers/__tests__/offlineWorkletRenderHarness';
import { renderTrackSubgraphOffline } from '../../useCases/offlineRender/renderTrackSubgraphOffline';

/**
 * Does a Grand Boule track render audible audio through the real offline path?
 *
 * INVENTORY-device-clock-parity G-1 measured 97–99 % silence out of a real
 * export, and G-6 turns that into data loss: freeze bakes the silent buffer and
 * flatten commits it over the MIDI clips. This is the reproduction, and it is
 * deliberately built out of production parts — the real
 * `renderTrackSubgraphOffline`, the real `buildDeviceChain`, the real device
 * registry, the real `createGrandBouleNode` and the real worklet processor. Only
 * two things are stand-ins:
 *
 *  - The WASM engine. `GrandBouleInstance` is replaced by a sine bank so the
 *    buffer says whether the *transport* delivered what the engine produced.
 *    A physical-model piano would prove the same thing less legibly.
 *  - Web Audio itself; see `offlineWorkletRenderHarness`.
 *
 * Against the pre-split transport this failed with silence in both note regions
 * and a single island of content at the 1 s segment boundary — the shape the
 * inventory measured, for the reason it gives: the engine Worker's producer loop
 * is paced by the main thread's macrotask queue and back-pressured at
 * `TARGET_AHEAD` = 768 frames, while the render consumes 344 quanta per second
 * without ever yielding to it.
 */

const SAMPLE_RATE = 44_100;
const TEMPO = 120;
const SECONDS_PER_BEAT = 60 / TEMPO;

/** `\0asm` + version 1 — the shortest byte string `WebAssembly.compile` accepts. */
const EMPTY_WASM_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer;

// ---------------------------------------------------------------------------
// The engine stand-in. Hoisted because `vi.mock`'s factory runs before the
// module body.
// ---------------------------------------------------------------------------

const wasmStub = vi.hoisted(() => {
    /** One page (64 KiB) — two 4096-frame channels need 32 KiB. */
    const memory = new WebAssembly.Memory({ initial: 1 });
    const MAX_BLOCK = 4096;
    const LEFT_PTR = 0;
    const RIGHT_PTR = MAX_BLOCK * Float32Array.BYTES_PER_ELEMENT;

    function midiFrequency(note: number): number {
        return 440 * 2 ** ((note - 69) / 12);
    }

    /**
     * A sine bank with the same call surface as `GrandBouleInstance`.
     *
     * Phase is carried across blocks per note, so a note voiced in the wrong
     * block shows up as displaced content rather than as a click — the way the
     * real engine's ring-out would.
     */
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
                const step = (2 * Math.PI * midiFrequency(midiNote)) / this.instanceSampleRate;
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

// The `?worker&url` imports resolve to a bundler URL that vitest cannot serve;
// this spec registers the processor itself by importing its module.
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
        id: 'gb-track',
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
                id: 'gb-clip',
                trackId: 'gb-track',
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

describe('Grand Boule renders audible audio offline', () => {
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
                // Structurally valid but empty: the node factory compiles these
                // before the mocked wasm-bindgen glue sees the shared module.
                arrayBuffer: () => Promise.resolve(EMPTY_WASM_MODULE.slice(0)),
            })
        );

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

        const { trackStore } = await import('#/modules/Arrangement/stores');
        const { midiStore } = await import('#/modules/MIDI/stores');
        const { transportStore } = await import('#/modules/Transport/stores');
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set({ ...transportStore.value!, tempo: TEMPO });
        // Two held notes, each one beat long: beat 1 (0.5 s) and beat 2 (1.0 s).
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'gb-clip': [
                    { id: 'n1', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
                    { id: 'n2', pitch: 67, startBeat: 2, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('puts signal under the notes instead of silence', async () => {
        const buffer = await renderTrackSubgraphOffline({
            targetTrackId: 'gb-track',
            renderTracks: [grandBouleTrack()],
            startBeat: 0,
            endBeat: 4,
        });

        expect(buffer).not.toBeNull();

        // Both notes are held for a full beat. Measure strictly inside each, away
        // from the 1 s and 2 s segment boundaries where a starved ring still
        // delivered its islands — the content between them is the point.
        const firstNote = harnessRmsBetween({
            buffer: buffer!,
            startSeconds: 1 * SECONDS_PER_BEAT + 0.05,
            endSeconds: 2 * SECONDS_PER_BEAT - 0.05,
        });
        const secondNote = harnessRmsBetween({
            buffer: buffer!,
            startSeconds: 2 * SECONDS_PER_BEAT + 0.05,
            endSeconds: 3 * SECONDS_PER_BEAT - 0.05,
        });

        // A single 0.3-amplitude sine is 0.212 RMS; the strip carries unity gain
        // and centre pan, so anything at or below a tenth of that is the silence
        // this test exists to catch.
        expect({
            firstNoteAudible: firstNote > 0.02,
            secondNoteAudible: secondNote > 0.02,
        }).toEqual({ firstNoteAudible: true, secondNoteAudible: true });
    });

    // A companion assertion — "the gap before the first note stays silent" — was
    // written here and then removed, because mutation-checking showed nothing
    // reds for it. Every way of collapsing the note queue drains the note-offs
    // along with the note-ons, so a broken transport produces *silence* in the
    // gap too, not early sound. Note placement is measured where it can actually
    // fail, in `worklets/__tests__/grandBouleOfflineNoteTiming.spec.ts`, which
    // asserts the render block each note is voiced in.
});
