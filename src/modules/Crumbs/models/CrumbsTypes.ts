/**
 * Unified Crumbs Suite domain types.
 * Plain types describing crumbs state — no behavior, no framework dependencies.
 */

export type CrumbsMode = 'quick' | 'drum' | 'slice' | 'warp' | 'record';

export type LoopMode = 'off' | 'forward' | 'pingpong' | 'reverse';

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

export type SampleCategory = 'percussive' | 'tonal' | 'loop' | 'unknown';

export type OnsetAlgorithm = 'superflux' | 'hfc' | 'complex';

export type SampleMeta = {
    sampleId: number;
    sampleRate: number;
    channels: number;
    frameCount: number;
    durationSecs: number;
    detectedRoot: number | null;
    detectedBpm: number | null;
    category: SampleCategory;
    filePath: string;
    fileName: string;
};

export type SliceMarker = {
    id: string;
    framePosition: number;
    label: string;
};

export type PadConfig = {
    id: number;
    name: string;
    color: string;
    sampleId: number | null;
    midiNote: number;
    chokeGroup: number;
    volume: number;
    pan: number;
    tune: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    filterCutoff: number;
    filterResonance: number;
    loopMode: LoopMode;
    reverse: boolean;
    oneShot: boolean;
};

export type EnvelopeParams = {
    attack: number;
    hold: number;
    decay: number;
    sustain: number;
    release: number;
};

export type CrumbsLoadResult = {
    sampleId: number;
    sampleRate: number;
    channels: number;
    frameCount: number;
    durationSecs: number;
    detectedRoot: number | null;
    detectedBpm: number | null;
    category: string;
    decodeWarningCount: number;
    decodeWarnings: string[];
};

export type OnsetDetectionResult = {
    positions: number[];
    algorithm: string;
};

export type PitchDetectionResult = {
    frequencyHz: number | null;
    midiNote: number | null;
    confidence: number;
};

export type LoopPointDetectionResult = {
    startFrame: number;
    endFrame: number;
    crossfadeLength: number;
    quality: number;
};

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'sampleAndHold';

export type LfoTarget = 'none' | 'pitch' | 'filterCutoff' | 'pan' | 'volume';

export type ArticulatorGroup = {
    attack: number | null;
    hold: number | null;
    decay: number | null;
    sustain: number | null;
    release: number | null;
    filterCutoff: number | null;
    filterResonance: number | null;
    filterType: FilterType | null;
    lfoRate: number;
    lfoDepth: number;
    lfoShape: LfoShape;
    lfoTarget: LfoTarget;
};

export type PadChannelStrip = {
    gain: number;
    pan: number;
    muted: boolean;
    solo: boolean;
    sends: [number, number, number, number];
    articulator: ArticulatorGroup;
};

export type ModXYState = {
    deckASample: number | null;
    deckBSample: number | null;
    crossfade: number;
};

export type VoiceStackParams = {
    stackCount: number;
    detuneSpread: number;
    stackSpread: number;
};

/** Fallback pad color used when an index falls outside {@link PAD_COLORS}. */
export const DEFAULT_PAD_COLOR = '#E06060';

export const PAD_COLORS = [
    '#E06060',
    '#E08860',
    '#E0B060',
    '#B0E060',
    '#60E080',
    '#60C8E0',
    '#6088E0',
    '#8860E0',
    '#E060B0',
    '#E06080',
    '#C0C060',
    '#60E0C0',
    '#A080E0',
    '#E0A080',
    '#80C0E0',
    '#C080E0',
];

export const DEFAULT_PAD_COUNT = 16;
export const BASE_NOTE = 36; // C2

export function createDefaultPad(index: number): PadConfig {
    return {
        id: index,
        name: `Pad ${index + 1}`,
        color: PAD_COLORS[index % PAD_COLORS.length] ?? DEFAULT_PAD_COLOR,
        sampleId: null,
        midiNote: BASE_NOTE + index,
        chokeGroup: 0,
        volume: 0.8,
        pan: 0,
        tune: 0,
        attack: 0.001,
        decay: 0.3,
        sustain: 1.0,
        release: 0.1,
        filterCutoff: 20000,
        filterResonance: 1,
        loopMode: 'off',
        reverse: false,
        oneShot: true,
    };
}

export function createDefaultArticulator(): ArticulatorGroup {
    return {
        attack: null,
        hold: null,
        decay: null,
        sustain: null,
        release: null,
        filterCutoff: null,
        filterResonance: null,
        filterType: null,
        lfoRate: 1.0,
        lfoDepth: 0.0,
        lfoShape: 'sine',
        lfoTarget: 'none',
    };
}

export function createDefaultChannelStrip(): PadChannelStrip {
    return {
        gain: 1.0,
        pan: 0.0,
        muted: false,
        solo: false,
        sends: [0, 0, 0, 0],
        articulator: createDefaultArticulator(),
    };
}

export function midiNoteToName(note: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(note / 12) - 1;
    // A non-finite note (e.g. NaN) yields a non-finite modulo and an out-of-range
    // lookup; degrade visibly to '?' rather than asserting a value that isn't there.
    const name = names[note % 12] ?? '?';
    return `${name}${octave}`;
}
