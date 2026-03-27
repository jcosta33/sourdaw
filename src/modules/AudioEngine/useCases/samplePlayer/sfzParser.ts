import { type SampleRegion, type SFZInstrument, getInstrument, setInstrument } from './types';
import { notifyUser } from '#/helpers/Notification/notifyUser';

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
        id: `sfz-${name.toLowerCase().replaceAll(/\s+/g, '-')}`,
        name,
        format: 'sfz',
        regions,
        globalDefaults: {},
        loaded: false,
        sampleBuffers: new Map(),
    };

    setInstrument(inst);
    return inst;
}

/**
 * Load all samples for an SFZ instrument.
 */
export async function loadSFZSamples(instrumentId: string, ctx: AudioContext, baseUrl: string): Promise<boolean> {
    const inst = getInstrument(instrumentId);
    if (!inst) {
        return false;
    }

    const uniqueSamples = new Set(inst.regions.map((r: SampleRegion) => r.sampleUrl));
    const newBuffers = new Map(inst.sampleBuffers);

    for (const sampleUrl of uniqueSamples) {
        if (!sampleUrl || newBuffers.has(sampleUrl)) {
            continue;
        }
        try {
            const response = await fetch(`${baseUrl}/${sampleUrl}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            newBuffers.set(sampleUrl, audioBuffer);
        } catch (error) {
            console.warn(`[SFZ] Failed to load sample: ${sampleUrl}`, error);
            notifyUser(`Failed to load sample: ${sampleUrl}`, 'warning');
        }
    }

    setInstrument({ ...inst, sampleBuffers: newBuffers, loaded: true });
    return true;
}

/**
 * Create an SF2 SoundFont instrument entry.
 */
export function createSF2Instrument(name: string, sf2Url: string): SFZInstrument {
    const inst: SFZInstrument = {
        id: `sf2-${name.toLowerCase().replaceAll(/\s+/g, '-')}`,
        name,
        format: 'sf2',
        regions: [],
        globalDefaults: {},
        loaded: false,
        sampleBuffers: new Map(),
    };

    (inst as Record<string, unknown>)._sf2Url = sf2Url;

    setInstrument(inst);
    return inst;
}
