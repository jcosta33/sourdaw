import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { freezeTrack } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';

import { createOfflineWorkletRenderHarness } from '../../../../helpers/__tests__/offlineWorkletRenderHarness';
import { audioBufferCache } from '../../stores/audioBufferCache';

/**
 * G-6's guard, in the form it takes now: a freeze whose instrument did not
 * build must refuse the bake, not commit silence over the track.
 *
 * The original defect: freeze renders through `OfflineAudioContext`, the
 * offline transport starved the worklet ring, and the resulting 97–99 % silent
 * buffer was baked — `flattenTrack` then replaces the track's `clips` with it
 * and sets `devices: []`. Two ordinary clicks destroyed a piano track,
 * recoverable only from CRDT undo history.
 *
 * ## Why this spec no longer asks for audio
 *
 * It used to assert energy in the frozen buffer, using Grand Boule as the
 * instrument. [ADR 0032](../../../../../.agents/decisions/0032-withhold-grand-boule-from-release.md)
 * withheld `grand-boule` from release, so the released device chain will not
 * build it and this track can only render silence. That is not a reason to drop
 * the guard — it is the exact input the guard exists for, and it is reachable
 * in the product, because ADR 0032 keeps existing project data intact: a
 * `.sdaw` saved before the withholding still carries a Grand Boule track, and
 * the same path is what any device that fails to build at runtime takes.
 *
 * So the question this file asks is the one that actually protects the user's
 * work: when the render comes back silent because the instrument is missing,
 * does freeze stop, or does it bake?
 *
 * The refusal is only reachable because the withheld device stays in the chain
 * as a silent stand-in (`createWithheldDeviceStrategy`). Drop it instead and
 * `scheduleTrackClips` finds no instrument, substitutes the builtin fallback
 * synth, and the bake *succeeds* — committing a sawtooth lead over the piano
 * track and, through `flattenTrack`, deleting the Grand Boule device reference
 * ADR 0032 exists to preserve. The harness oscillator sounds, so that outcome
 * reds this file rather than passing as silence.
 *
 * ## Why this spec lives here and not beside `freezeTrack`
 *
 * It mocks `getAudioContext`, an AudioEngine internal, and drives the real
 * AudioEngine offline render. A spec under
 * `Arrangement/useCases/freezeBounce/__tests__/` reaching that deep into a
 * foreign module is what `deps:validate` (tests cruise,
 * `cross-module-index-only`) and the barrel-mock guard both refuse. So the spec
 * sits on the side that owns the render and reaches `freezeTrack` through
 * Arrangement's public `useCases` barrel, which is the direction the boundary
 * permits. `silentBakeGuard.spec.ts` owns the silent-bake policy itself with
 * `renderOffline` mocked, and knows nothing about release admission — so
 * nothing there can tell you what the real device chain does with a withheld
 * device. This spec is the only one that closes that gap.
 *
 * Nothing under `freezeBounce/` is touched or mocked: this drives the real
 * `freezeTrack` -> real `renderTrackOffline` -> real `renderTrackSubgraphOffline`
 * -> real device chain, and reads the refusal off the track and the
 * notification channel.
 *
 * ## Why the engine is still stubbed here
 *
 * Everything the device needs to render is in place: the wasm engine stands in
 * as a sine bank, the offline processor is registered, and `fetch` serves a
 * module. That machinery looks redundant for a device that never builds, and it
 * is the opposite — it is what makes this spec mean anything. Without it the
 * device fails to construct for want of a processor whatever release admission
 * says, the render is silent either way, and the refusal this file asserts
 * would fire for a reason that has nothing to do with its name. With it,
 * admission is the only thing standing between this track and a frozen buffer
 * full of piano, so re-admitting `grand-boule` makes the freeze succeed and
 * reds this file.
 */

const SAMPLE_RATE = 44_100;
const TEMPO = 120;

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

/**
 * Stubbed so the refusal can be *observed*, and because the real one resolves
 * an event bus through DI that no spec bootstraps. Left unstubbed it throws
 * `eventBus.emit is not a function` from inside `freezeTrack`, which the outer
 * catch turns into a generic `status: 'error'` — the correct refusal and a
 * crash then look identical from the outside, and the crash is the one that
 * tells the user nothing.
 */
const notification = vi.hoisted(() => ({ notifyUser: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notification.notifyUser }));

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

describe('freezing a track whose instrument did not build refuses the bake', () => {
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
        notification.notifyUser.mockClear();
        audioBufferCache.clear();
        automationStore.set(null);

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

    it('reports a non-write, caches nothing, and tells the user why', async () => {
        const froze = await freezeTrack('gb-freeze-track');

        const frozen = trackStore.value?.tracks.find((track) => track.id === 'gb-freeze-track');
        const freezeState = frozen?.freezeState;
        const bufferId = freezeState?.status === 'frozen' ? freezeState.frozenBufferId : undefined;
        let buffer: AudioBuffer | undefined;
        if (bufferId !== undefined) {
            buffer = audioBufferCache.get(bufferId);
        }

        const messages = notification.notifyUser.mock.calls.map(([message, level]) => ({
            message: String(message),
            level: String(level),
        }));

        // `froze` must be false, and that is the load-bearing half rather than a
        // detail: `handleFreezeTrack` maps a `true` through
        // `toHandlerExecutionResult` to `{status: 'written'}`, which would file a
        // refusal as an undoable edit against a track nothing was written to.
        //
        // The two notifications are read together because they cover the two
        // ways this can go silently wrong. Without the first, the device
        // vanished from the render with nothing said. Without the second, freeze
        // stopped and the user was left looking at an unfrozen track wondering
        // why. The first reads the admission-specific message rather than the
        // generic device-load degrade, which fires for any environment fault
        // and so cannot say which of the two happened.
        expect({
            froze,
            status: freezeState?.status,
            cachedBuffer: buffer !== undefined,
            trackFrozen: frozen?.frozen === true,
            deviceWithholdingReported: messages.some(
                ({ message, level }) =>
                    message.includes('grand-boule') &&
                    message.includes('withheld from this build') &&
                    level === 'warning'
            ),
            bakeRefused: messages.some(
                ({ message, level }) =>
                    message.includes('grand-boule') &&
                    message.includes('withheld from this build') &&
                    message.includes('Freeze stopped') &&
                    level === 'error'
            ),
        }).toEqual({
            froze: false,
            status: 'error',
            cachedBuffer: false,
            trackFrozen: false,
            deviceWithholdingReported: true,
            bakeRefused: true,
        });
    });

    it('refuses the same bake on a track carrying an automation lane', async () => {
        // The ordinary case, and the one the test above cannot reach. An
        // instrument track almost always carries a ride, and `freezeTrack`
        // passes `bakesAutomation: true` unconditionally, so
        // `classifyRenderSilence` abstains with `automation-not-modelled` for
        // any track owning one enabled lane with one point. Behind that
        // abstention the withheld device froze "successfully" over silence, and
        // `flattenTrack` then set `devices: []` — deleting the Grand Boule
        // reference ADR 0032 exists to preserve, from a project the user only
        // clicked Freeze and Flatten on.
        //
        // A withheld verdict is a fact about the build, not a guess about the
        // audio, so it is refused ahead of every abstention.
        automationStore.set({
            lanes: [
                {
                    id: 'gb-volume-ride',
                    trackId: 'gb-freeze-track',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ id: 'p1', beat: 0, value: 0.8, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        const froze = await freezeTrack('gb-freeze-track');

        const frozen = trackStore.value?.tracks.find((track) => track.id === 'gb-freeze-track');
        const messages = notification.notifyUser.mock.calls.map(([message, level]) => ({
            message: String(message),
            level: String(level),
        }));

        expect({
            froze,
            status: frozen?.freezeState.status,
            trackFrozen: frozen?.frozen === true,
            // The refusal must name the withholding, not digital silence. The
            // silence message ends "Play the track back to confirm it sounds,
            // then try again" — advice with no exit for a device that is gone
            // from the build, because playback of it is silent too.
            withheldRefusal: messages.some(
                ({ message, level }) =>
                    message.includes('grand-boule') &&
                    message.includes('withheld from this build') &&
                    message.includes('Freeze stopped') &&
                    level === 'error'
            ),
            toldToPlayItBack: messages.some(({ message }) => message.includes('Play the track back')),
        }).toEqual({
            froze: false,
            status: 'error',
            trackFrozen: false,
            withheldRefusal: true,
            toldToPlayItBack: false,
        });
    });
});
