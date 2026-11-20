import { type Track } from '#/modules/Arrangement/stores';
import { getAddedDeviceParameterValues } from '#/modules/Arrangement/useCases';
import { type renderOffline, type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';

import { metricGoalAudioBuffer } from '../useCases/__tests__/metricGoalWorkflowFixture';

import { compress } from './acceptanceRenderLawCompressor';

type TrackRenderInput = Parameters<typeof renderTrackSubgraphOffline>[0];
type MixdownRenderInput = Parameters<typeof renderOffline>[0];
type Stereo = { left: Float64Array; right: Float64Array };
type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

const SAMPLE_RATE = 48_000;

/** One partial in each analysis band from bass to air, so every spectral figure has something to move. */
const PARTIAL_HZ = [110, 330, 1000, 3000, 6000, 12_000] as const;

/** Every source strikes once a beat and decays to its sustain floor this fast. */
const STRIKE_DECAY_SECONDS = 0.03;

/**
 * A strike rises over a half cosine this long before it decays. A struck source reaches its peak a few
 * milliseconds after the beat, which is what lets a fast-attack compressor react before the peak. A
 * zero-rise strike peaks on its first sample, so no compressor without lookahead could clamp it and
 * every one would overshoot by construction.
 */
const STRIKE_RISE_SECONDS = 0.005;

/**
 * The offline render node cannot run, so the acceptance corpora render through this one law, the
 * same for every case, every route and every document — the live project and an isolated preview.
 *
 * Source: a track's source is fixed by its position `p` in the fixture project, and by nothing a case
 * chooses. It sounds one partial per band at `PARTIAL_HZ`, weighted `2^-|k - p mod 6|` around its own
 * spectral centre and normalised to unit energy, at level `0.12 + 0.03 · (p mod 4)`. The right channel
 * runs each partial `k` late by `(p mod 3) · (k + 1) · π / 18`, so tracks differ in stereo
 * decorrelation. Every beat the source strikes and rises over `STRIKE_RISE_SECONDS` (a half cosine, so the
 * peak lands a few milliseconds after the beat) and decays over `STRIKE_DECAY_SECONDS` to a sustain floor
 * of `0.2 + 0.2 · (p mod 4)` of its strike, so tracks differ in peak-to-average shape. Time is read on
 * the project timeline, so a window renders the same samples whatever span it is cut from. A bus has
 * no source of its own.
 *
 * Devices, in chain order, bypassed ones skipped, each parameter its stored value or the value the
 * device starts with:
 * - `builtin-eq`: the three Web Audio peaking bands its nodes are (`createEq`: low, mid and high, each
 *   with its own frequency, gain and Q), by the Audio EQ Cookbook bell Web Audio specifies.
 * - `builtin-compressor`: the Web Audio `DynamicsCompressorNode` it is (`acceptanceRenderLawCompressor`):
 *   a stereo-linked peak read 6 ms ahead, Blink's static curve at its threshold, ratio and knee, the
 *   node's automatic makeup, then the device's own makeup gain.
 * - `builtin-gain`: its level in decibels.
 * - `builtin-stereo-widener`: the mid scaled by its mid level, the side by its width and side level,
 *   with the side below its mono-bass frequency removed.
 * A device no rule covers throws, so no case can lean on a sound the law does not make.
 *
 * Mixer: the fader's linear gain, then a constant-power pan. A bus sums the post-fader (or pre-fader)
 * sends of the tracks rendered with it, then applies its own chain and fader. The master sums every
 * unmuted track and bus routed to it at the master gain; a send reaches its bus, never the master
 * twice, so a sending track is heard on the master through its own output and its bus return.
 */
export function createAcceptanceRenderLaw(input: {
    /** Each track's position in the fixture project, which alone fixes its source. */
    trackPosition: (trackId: string) => number;
    tempo: () => number;
    /** The live tracks and master gain a mixdown of the live project sums. */
    liveTracks: () => readonly Track[];
    masterGain: () => number;
}) {
    function seconds(beats: number): number {
        return (beats * 60) / input.tempo();
    }

    function source(track: Track, startBeat: number, frames: number): Stereo {
        const position = input.trackPosition(track.id);
        const centre = position % PARTIAL_HZ.length;
        const weights = PARTIAL_HZ.map((_, index) => 2 ** -Math.abs(index - centre));
        const norm = Math.sqrt(weights.reduce((total, weight) => total + weight * weight, 0));
        const level = 0.12 + 0.03 * (position % 4);
        const sustain = 0.2 + 0.2 * (position % 4);
        const lag = ((position % 3) * Math.PI) / 18;
        const beatSeconds = seconds(1);
        const start = seconds(startBeat);
        const left = new Float64Array(frames);
        const right = new Float64Array(frames);
        for (let frame = 0; frame < frames; frame++) {
            const time = start + frame / SAMPLE_RATE;
            const sinceStrike = time % beatSeconds;
            const risen = Math.min(sinceStrike, STRIKE_RISE_SECONDS);
            const rise = 0.5 * (1 - Math.cos((Math.PI * risen) / STRIKE_RISE_SECONDS));
            const decay = Math.exp(-Math.max(0, sinceStrike - STRIKE_RISE_SECONDS) / STRIKE_DECAY_SECONDS);
            const envelope = level * (sustain + (1 - sustain) * rise * decay);
            let l = 0;
            let r = 0;
            for (let index = 0; index < PARTIAL_HZ.length; index++) {
                const phase = 2 * Math.PI * PARTIAL_HZ[index]! * time;
                const weight = weights[index]! / norm;
                l += weight * Math.sin(phase);
                r += weight * Math.sin(phase - lag * (index + 1));
            }
            left[frame] = envelope * l;
            right[frame] = envelope * r;
        }
        return { left, right };
    }

    function parameters(device: Track['devices'][number]): Record<string, number> {
        return { ...getAddedDeviceParameterValues(device.type), ...device.parameterValues };
    }

    function applyDevice(signal: Stereo, device: Track['devices'][number]): Stereo {
        const values = parameters(device);
        const read = (id: string): number => {
            const value = values[id];
            if (value === undefined) {
                throw new Error(`The acceptance render law reads no ${id} on ${device.type}.`);
            }
            return value;
        };
        switch (device.type) {
            case 'builtin-eq':
                return filterStereo(signal, [
                    peaking(read('eq-low-freq'), read('eq-low-gain'), read('eq-low-q')),
                    peaking(read('eq-mid-freq'), read('eq-mid-gain'), read('eq-mid-q')),
                    peaking(read('eq-high-freq'), read('eq-high-gain'), read('eq-high-q')),
                ]);
            case 'builtin-compressor':
                return compress(
                    signal,
                    {
                        thresholdDb: read('comp-threshold'),
                        ratio: read('comp-ratio'),
                        kneeDb: read('comp-knee'),
                        attackMs: read('comp-attack'),
                        releaseMs: read('comp-release'),
                        makeupDb: read('comp-makeup'),
                    },
                    SAMPLE_RATE
                );
            case 'builtin-gain':
                return scale(signal, 10 ** (read('gain-level') / 20));
            case 'builtin-stereo-widener':
                return widen(signal, {
                    width: read('width-amount'),
                    midDb: read('width-mid'),
                    sideDb: read('width-side'),
                    monoBassHz: read('width-mono-bass'),
                });
            default:
                throw new Error(`The acceptance render law has no rule for ${device.type}.`);
        }
    }

    function channelStrip(track: Track, signal: Stereo, faderStage: boolean): Stereo {
        let processed = signal;
        for (const device of track.devices) {
            if (!device.bypassed) {
                processed = applyDevice(processed, device);
            }
        }
        if (!faderStage) {
            return processed;
        }
        const angle = ((track.pan + 1) * Math.PI) / 4;
        return {
            left: processed.left.map((sample) => sample * track.gain * Math.SQRT2 * Math.cos(angle)),
            right: processed.right.map((sample) => sample * track.gain * Math.SQRT2 * Math.sin(angle)),
        };
    }

    /** One track or bus through its own chain and fader, a bus fed by the sends of `tracks`. */
    function renderChannel(target: Track, tracks: readonly Track[], startBeat: number, frames: number): Stereo {
        if (target.kind !== 'bus') {
            return channelStrip(target, source(target, startBeat, frames), true);
        }
        const bus = { left: new Float64Array(frames), right: new Float64Array(frames) };
        for (const track of tracks) {
            if (track.id === target.id || track.muted) {
                continue;
            }
            for (const send of track.sends.filter((candidate) => candidate.busId === target.id)) {
                const sent = channelStrip(track, source(track, startBeat, frames), !send.preFader);
                mixInto(bus, sent, send.level);
            }
        }
        return channelStrip(target, bus, true);
    }

    function frameCount(startBeat: number, endBeat: number): number {
        return Math.round(seconds(endBeat - startBeat) * SAMPLE_RATE);
    }

    /** `renderTrackSubgraphOffline`: the target's own channel, read from the document it was handed. */
    function renderTrack(render: TrackRenderInput): AudioBuffer {
        const target = render.renderTracks.find((track) => track.id === render.targetTrackId);
        if (target === undefined) {
            throw new Error(`The render target ${render.targetTrackId} is absent from its subgraph.`);
        }
        const frames = frameCount(render.startBeat, render.endBeat);
        return toAudioBuffer(renderChannel(target, render.renderTracks, render.startBeat, frames));
    }

    /** `renderOffline`: the live project's master output, from beat 0 when no start is given, as the renderer reads it. */
    function renderMixdown(render: MixdownRenderInput): AudioBuffer {
        const tracks = input.liveTracks();
        const startBeat = render.startBeat ?? 0;
        const frames = frameCount(startBeat, startBeat + render.durationBeats);
        const master = { left: new Float64Array(frames), right: new Float64Array(frames) };
        for (const track of tracks) {
            if (track.muted || track.outputId !== 'master') {
                continue;
            }
            mixInto(master, renderChannel(track, tracks, startBeat, frames), input.masterGain());
        }
        return toAudioBuffer(master);
    }

    return { renderTrack, renderMixdown };
}

function mixInto(destination: Stereo, signal: Stereo, gain: number): void {
    for (let frame = 0; frame < destination.left.length; frame++) {
        destination.left[frame] = destination.left[frame]! + gain * signal.left[frame]!;
        destination.right[frame] = destination.right[frame]! + gain * signal.right[frame]!;
    }
}

function scale(signal: Stereo, gain: number): Stereo {
    return { left: signal.left.map((sample) => sample * gain), right: signal.right.map((sample) => sample * gain) };
}

function toAudioBuffer(signal: Stereo): AudioBuffer {
    const buffer = metricGoalAudioBuffer(() => 0, signal.left.length / SAMPLE_RATE, SAMPLE_RATE);
    buffer.getChannelData(0).set(signal.left);
    buffer.getChannelData(1).set(signal.right);
    return buffer;
}

function normalise(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** The Web Audio `peaking` response: the Audio EQ Cookbook bell. */
function peaking(frequency: number, gainDb: number, q: number): Biquad {
    const a = 10 ** (gainDb / 40);
    const omega = (2 * Math.PI * frequency) / SAMPLE_RATE;
    const alpha = Math.sin(omega) / (2 * q);
    const cos = Math.cos(omega);
    return normalise(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a);
}

/** The Audio EQ Cookbook low-pass at Butterworth Q, which the widener's mono-bass split reads. */
function lowPass(frequency: number): Biquad {
    const omega = (2 * Math.PI * frequency) / SAMPLE_RATE;
    const alpha = Math.sin(omega) / Math.SQRT2;
    const cos = Math.cos(omega);
    return normalise((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

function filter(samples: Float64Array, filters: readonly Biquad[]): Float64Array {
    const output = Float64Array.from(samples);
    for (const stage of filters) {
        let x1 = 0;
        let x2 = 0;
        let y1 = 0;
        let y2 = 0;
        for (let index = 0; index < output.length; index++) {
            const x0 = output[index]!;
            const y0 = stage.b0 * x0 + stage.b1 * x1 + stage.b2 * x2 - stage.a1 * y1 - stage.a2 * y2;
            output[index] = y0;
            x2 = x1;
            x1 = x0;
            y2 = y1;
            y1 = y0;
        }
    }
    return output;
}

function filterStereo(signal: Stereo, filters: readonly Biquad[]): Stereo {
    return { left: filter(signal.left, filters), right: filter(signal.right, filters) };
}

function widen(signal: Stereo, settings: { width: number; midDb: number; sideDb: number; monoBassHz: number }): Stereo {
    const frames = signal.left.length;
    const side = new Float64Array(frames);
    for (let frame = 0; frame < frames; frame++) {
        side[frame] = (signal.left[frame]! - signal.right[frame]!) / 2;
    }
    const sideLow = filter(side, [lowPass(settings.monoBassHz), lowPass(settings.monoBassHz)]);
    const midGain = 10 ** (settings.midDb / 20);
    const sideGain = settings.width * 10 ** (settings.sideDb / 20);
    const left = new Float64Array(frames);
    const right = new Float64Array(frames);
    for (let frame = 0; frame < frames; frame++) {
        const mid = ((signal.left[frame]! + signal.right[frame]!) / 2) * midGain;
        const wide = (side[frame]! - sideLow[frame]!) * sideGain;
        left[frame] = mid + wide;
        right[frame] = mid - wide;
    }
    return { left, right };
}
