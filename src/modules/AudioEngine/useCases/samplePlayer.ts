/**
 * SFZ Sampler & SF2 SoundFont Player.
 *
 * Provides the TS-side infrastructure for loading and playing
 * SFZ/SF2 sample-based instruments.
 *
 * In production:
 * - SFZ: uses sfizz compiled to WASM via Emscripten
 * - SF2: uses FluidSynth WASM (js-synthesizer)
 *
 * This module provides the loading, mapping, and playback framework.
 */

export type SampleRegion = {
    keyLo: number;
    keyHi: number;
    velLo: number;
    velHi: number;
    sampleUrl: string;
    rootKey: number;
    loopStart?: number;
    loopEnd?: number;
    tuning: number; // cents
    volume: number; // dB
    pan: number; // -100 to 100
};

export type SFZInstrument = {
    id: string;
    name: string;
    format: 'sfz' | 'sf2';
    regions: SampleRegion[];
    globalDefaults: Partial<SampleRegion>;
    loaded: boolean;
    sampleBuffers: Map<string, AudioBuffer>;
};

const instruments = new Map<string, SFZInstrument>();

/**
 * Parse an SFZ file and create an instrument.
 */
export function parseSFZ(name: string, sfzContent: string): SFZInstrument {
    const regions: SampleRegion[] = [];
    let currentRegion: Partial<SampleRegion> | null = null;

    for (const line of sfzContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed === '') {
            continue;
        }

        if (trimmed === '<region>') {
            if (currentRegion) {
                regions.push(fillDefaults(currentRegion));
            }
            currentRegion = {};
            continue;
        }

        if (currentRegion) {
            // Parse opcodes
            const tokens = trimmed.split(/\s+/);
            for (const token of tokens) {
                const eq = token.indexOf('=');
                if (eq === -1) {
                    continue;
                }
                const key = token.slice(0, eq);
                const value = token.slice(eq + 1);
                switch (key) {
                    case 'lokey':
                        currentRegion.keyLo = parseInt(value, 10);
                        break;
                    case 'hikey':
                        currentRegion.keyHi = parseInt(value, 10);
                        break;
                    case 'lovel':
                        currentRegion.velLo = parseInt(value, 10);
                        break;
                    case 'hivel':
                        currentRegion.velHi = parseInt(value, 10);
                        break;
                    case 'sample':
                        currentRegion.sampleUrl = value;
                        break;
                    case 'pitch_keycenter':
                        currentRegion.rootKey = parseInt(value, 10);
                        break;
                    case 'loop_start':
                        currentRegion.loopStart = parseInt(value, 10);
                        break;
                    case 'loop_end':
                        currentRegion.loopEnd = parseInt(value, 10);
                        break;
                    case 'tune':
                        currentRegion.tuning = parseInt(value, 10);
                        break;
                    case 'volume':
                        currentRegion.volume = parseFloat(value);
                        break;
                    case 'pan':
                        currentRegion.pan = parseInt(value, 10);
                        break;
                    case 'key':
                        currentRegion.keyLo = parseInt(value, 10);
                        currentRegion.keyHi = parseInt(value, 10);
                        currentRegion.rootKey = parseInt(value, 10);
                        break;
                }
            }
        }
    }

    if (currentRegion) {
        regions.push(fillDefaults(currentRegion));
    }

    const inst: SFZInstrument = {
        id: `sfz-${name.toLowerCase().replace(/\s+/g, '-')}`,
        name,
        format: 'sfz',
        regions,
        globalDefaults: {},
        loaded: false,
        sampleBuffers: new Map(),
    };

    instruments.set(inst.id, inst);
    return inst;
}

function fillDefaults(partial: Partial<SampleRegion>): SampleRegion {
    return {
        keyLo: partial.keyLo ?? 0,
        keyHi: partial.keyHi ?? 127,
        velLo: partial.velLo ?? 0,
        velHi: partial.velHi ?? 127,
        sampleUrl: partial.sampleUrl ?? '',
        rootKey: partial.rootKey ?? 60,
        loopStart: partial.loopStart,
        loopEnd: partial.loopEnd,
        tuning: partial.tuning ?? 0,
        volume: partial.volume ?? 0,
        pan: partial.pan ?? 0,
    };
}

/**
 * Load all samples for an SFZ instrument.
 */
export async function loadSFZSamples(
    instrumentId: string,
    ctx: AudioContext,
    baseUrl: string
): Promise<boolean> {
    const inst = instruments.get(instrumentId);
    if (!inst) {
        return false;
    }

    const uniqueSamples = new Set(inst.regions.map((r) => r.sampleUrl));

    for (const sampleUrl of uniqueSamples) {
        if (!sampleUrl || inst.sampleBuffers.has(sampleUrl)) {
            continue;
        }
        try {
            const response = await fetch(`${baseUrl}/${sampleUrl}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            inst.sampleBuffers.set(sampleUrl, audioBuffer);
        } catch (err) {
            console.warn(`[SFZ] Failed to load sample: ${sampleUrl}`, err);
        }
    }

    inst.loaded = true;
    return true;
}

/**
 * Find the matching region for a note event.
 */
export function findRegion(
    instrumentId: string,
    note: number,
    velocity: number
): SampleRegion | null {
    const inst = instruments.get(instrumentId);
    if (!inst) {
        return null;
    }
    return (
        inst.regions.find(
            (r) => note >= r.keyLo && note <= r.keyHi && velocity >= r.velLo && velocity <= r.velHi
        ) ?? null
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
    const inst = instruments.get(instrumentId);
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
    source.playbackRate.value = Math.pow(2, semitoneDiff / 12);

    // Loop
    if (region.loopStart !== undefined && region.loopEnd !== undefined) {
        source.loop = true;
        source.loopStart = region.loopStart / buffer.sampleRate;
        source.loopEnd = region.loopEnd / buffer.sampleRate;
    }

    // Volume
    const gain = ctx.createGain();
    gain.gain.value = (velocity / 127) * Math.pow(10, region.volume / 20);

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
    return [...instruments.values()];
}

/**
 * Create an SF2 SoundFont instrument entry.
 * In production, would use FluidSynth WASM to parse and play.
 */
export function createSF2Instrument(name: string, sf2Url: string): SFZInstrument {
    const inst: SFZInstrument = {
        id: `sf2-${name.toLowerCase().replace(/\s+/g, '-')}`,
        name,
        format: 'sf2',
        regions: [],
        globalDefaults: {},
        loaded: false,
        sampleBuffers: new Map(),
    };

    // SF2 metadata would be parsed by FluidSynth WASM
    // Store URL for lazy loading
    (inst as Record<string, unknown>)._sf2Url = sf2Url;

    instruments.set(inst.id, inst);
    return inst;
}
