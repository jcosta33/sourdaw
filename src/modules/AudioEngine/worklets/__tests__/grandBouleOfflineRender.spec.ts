import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import {
    createOfflineWorkletRenderHarness,
    harnessRmsBetween,
} from '../../../../helpers/__tests__/offlineWorkletRenderHarness';
import { renderTrackSubgraphOffline } from '../../useCases/offlineRender/renderTrackSubgraphOffline';

/**
 * What the released offline render does with a device it is not allowed to build.
 *
 * ## Why this spec no longer asks for audio
 *
 * It used to render a Grand Boule track and assert energy under the notes — the
 * G-1 guard, where the offline transport starved the worklet ring and exported
 * 97–99 % silence. [ADR 0032](../../../../../.agents/decisions/0032-withhold-grand-boule-from-release.md)
 * then withheld `grand-boule` from release over patent and parameter-provenance
 * risk, and `findReleasedNativeDspDeviceFactory` stopped resolving it. The
 * device cannot be built on this path by design, so asking it for audio here
 * asserts a contract the product deliberately revoked.
 *
 * The transport guard did not go with it. `grandBouleOfflineNoteTiming`,
 * `grandBouleOfflineRenderBudget`, `grandBouleConsumerClock` and
 * `grandBouleDispatchParity` all reach `NATIVE_DSP_DEVICE_FACTORIES` or the
 * processor registry directly, which is the implementation ADR 0032 preserves,
 * and they still measure it. What is left over — and what only this path can
 * see — is what the *released* render does with a device on a track it may not
 * build, which is reachable in the product because ADR 0032 keeps existing
 * project data intact: a `.sdaw` file saved before the withholding still has a
 * Grand Boule track in it.
 *
 * ## What must not happen
 *
 * The withheld device is reported and renders silent, matching live playback,
 * which keeps the project and says the device stays silent. It must not come
 * back as the builtin fallback synth `scheduleTrackClips` reaches for when a
 * track has no instrument — a render must contain what playback contains, and a
 * sawtooth standing in for a piano is wrong in a way that sounds deliberate.
 *
 * That substitution is what the energy assertion below observes, and it can
 * only observe it because the harness oscillator *sounds*. A silent one does
 * not prevent the fallback, it hides it: the substituted synth renders as zeros
 * and the assertion passes either way. With an audible oscillator, a fallback
 * synth voicing these two notes puts roughly half-scale RMS under both of them,
 * so removing the withheld device's stand-in from the chain reds this file.
 *
 * The assertion pairs the warning with the energy on purpose. Silence alone
 * cannot tell "the device was withheld" from "the device built and played
 * quietly", and reading the two together is what makes the next occurrence name
 * itself rather than look like a level problem. The warning it reads is the
 * admission-specific one, not the generic device-load degrade: that one is
 * emitted for any environment fault too, so it could not tell a withheld device
 * from a broken one.
 *
 * ## Why the engine is still stubbed here
 *
 * Everything the device needs to render is in place: the wasm engine stands in
 * as a sine bank, the offline processor is registered, and `fetch` serves a
 * module. That machinery looks redundant for a device that never builds, and it
 * is the opposite — it is what makes this spec mean anything. Without it the
 * device fails to construct for want of a processor whatever release admission
 * says, the render is silent either way, and the spec passes for a reason that
 * has nothing to do with its name. With it, admission is the only thing
 * standing between this track and audible output, so re-admitting `grand-boule`
 * turns the notes on and reds this file.
 */

const SAMPLE_RATE = 44_100;
const TEMPO = 120;
const SECONDS_PER_BEAT = 60 / TEMPO;

/** `\0asm` + version 1 — the shortest byte string `WebAssembly.compile` accepts. */
const EMPTY_WASM_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer;

const wasmStub = vi.hoisted(() => {
    /** One page (64 KiB) — two 4096-frame channels need 32 KiB. */
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

describe('a withheld device renders silent in the offline render, and is reported', () => {
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

    it('names the device on the warning channel instead of substituting for it', async () => {
        const warnings: string[] = [];

        const buffer = await renderTrackSubgraphOffline({
            targetTrackId: 'gb-track',
            renderTracks: [grandBouleTrack()],
            startBeat: 0,
            endBeat: 4,
            onWarning: (message) => warnings.push(message),
        });

        expect(buffer).not.toBeNull();

        // Measure strictly inside each held note. Anything here is a stand-in
        // the render invented for an instrument it never built — the harness
        // oscillator sounds, so a fallback synth voicing these notes shows up.
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

        // Read as one object so a green run cannot mean "silent for some other
        // reason": the warning has to be there too, it has to name this device,
        // and it has to name withholding rather than a load failure.
        // Re-admitting `grand-boule` reds this on `deviceReported` *and* on the
        // energy, which is the difference between "the gate moved" and "the
        // render went quiet".
        expect({
            deviceReported: warnings.some(
                (message) => message.includes('grand-boule') && message.includes('withheld from this build')
            ),
            warningCount: warnings.length,
            firstNoteAudible: firstNote > 0.02,
            secondNoteAudible: secondNote > 0.02,
        }).toEqual({
            deviceReported: true,
            warningCount: 1,
            firstNoteAudible: false,
            secondNoteAudible: false,
        });
    });
});
