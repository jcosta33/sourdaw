import { type DrumEngineType } from '../models/ToasterKit';
import { TOASTER_KIT_STATE_VERSION } from '../models/ToasterKitState';

type Family = 'kick' | 'snare' | 'hi-hat' | 'tom' | 'cymbal' | 'percussion';
type Metadata = { status: 'unknown' } | { status: 'known'; voices: Array<{ pitch: number; family: Family | null }> };

const FAMILIES: Record<DrumEngineType, Family | null> = {
    'kick-808': 'kick',
    'kick-909': 'kick',
    'kick-analog': 'kick',
    'snare-808': 'snare',
    'snare-analog': 'snare',
    'hihat-closed': 'hi-hat',
    'hihat-open': 'hi-hat',
    'hihat-909': 'hi-hat',
    'tom-808-low': 'tom',
    'tom-808-mid': 'tom',
    'tom-808-high': 'tom',
    tom: 'tom',
    cymbal: 'cymbal',
    clap: 'percussion',
    'clap-909': 'percussion',
    cowbell: 'percussion',
    clave: 'percussion',
    rimshot: 'percussion',
    maracas: 'percussion',
    shaker: 'percussion',
    'perc-generic': 'percussion',
    // This resonator engine covers several drum families; its id declares no single voice.
    'cr78-drum': null,
    'cr78-metallic': 'percussion',
    'modal-tabla': 'percussion',
    'modal-bongo': 'percussion',
    'modal-woodblock': 'percussion',
    'modal-metal': 'percussion',
    'fm-perc': 'percussion',
    sample: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Unlike playback decoding, this read never repairs absent metadata with a default kit. */
export function getStoredDrumVoiceMetadata(chunk: unknown): Metadata {
    if (!isRecord(chunk) || chunk.version !== TOASTER_KIT_STATE_VERSION || !isRecord(chunk.data)) {
        return { status: 'unknown' };
    }
    const kit = chunk.data.kit;
    if (!isRecord(kit) || !Array.isArray(kit.pads) || kit.pads.length !== 16) {
        return { status: 'unknown' };
    }
    const voices: Array<{ pitch: number; family: Family | null }> = [];
    const pitches = new Set<number>();
    for (const pad of kit.pads) {
        if (
            !isRecord(pad) ||
            typeof pad.midiNote !== 'number' ||
            !Number.isInteger(pad.midiNote) ||
            pad.midiNote < 0 ||
            pad.midiNote > 127 ||
            typeof pad.engineType !== 'string' ||
            pitches.has(pad.midiNote)
        ) {
            return { status: 'unknown' };
        }
        pitches.add(pad.midiNote);
        const family = Object.entries(FAMILIES).find(([engine]) => engine === pad.engineType)?.[1] ?? null;
        voices.push({ pitch: pad.midiNote, family });
    }
    return { status: 'known', voices };
}
