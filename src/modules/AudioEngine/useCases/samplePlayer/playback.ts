import { type SampleRegion, type SFZInstrument, getInstrument, instrumentStore } from './types';

/**
 * Find the matching region for a note event.
 */
export function findRegion(instrumentId: string, note: number, velocity: number): SampleRegion | null {
    const inst = getInstrument(instrumentId);
    if (!inst) {
        return null;
    }
    return (
        inst.regions.find((r) => note >= r.keyLo && note <= r.keyHi && velocity >= r.velLo && velocity <= r.velHi) ??
        null
    );
}

/**
 * Play a note using the sampler.
 */
export function playNote(
    instrumentId: string,
    note: number,
    velocity: number,
    ctx: AudioContext,
    destination: AudioNode
): AudioBufferSourceNode | null {
    const inst = getInstrument(instrumentId);
    if (!inst || !inst.loaded) {
        return null;
    }

    const region = findRegion(instrumentId, note, velocity);
    if (!region) {
        return null;
    }

    const buffer = inst.sampleBuffers.get(region.sampleUrl);
    if (!buffer) {
        return null;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Pitch shift based on note vs root key
    const semitoneDiff = note - region.rootKey + region.tuning / 100;
    source.playbackRate.value = 2 ** (semitoneDiff / 12);

    // Loop
    if (region.loopStart !== undefined && region.loopEnd !== undefined) {
        source.loop = true;
        source.loopStart = region.loopStart / buffer.sampleRate;
        source.loopEnd = region.loopEnd / buffer.sampleRate;
    }

    // Volume
    const gain = ctx.createGain();
    gain.gain.value = (velocity / 127) * 10 ** (region.volume / 20);

    // Pan
    const panner = ctx.createStereoPanner();
    panner.pan.value = region.pan / 100;

    source.connect(gain).connect(panner).connect(destination);
    source.start();

    return source;
}

/**
 * Get all loaded instruments.
 */
export function getLoadedInstruments(): SFZInstrument[] {
    const state = instrumentStore.value;
    if (!state) {
        return [];
    }
    return Object.values(state.instruments);
}
