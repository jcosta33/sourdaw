/**
 * Push controller store — manages Ableton Push 2/3 hardware state.
 *
 * Extracted from pushIntegrationUseCases.ts.
 *
 * PERFORMANCE NOTE: Pads are stored as an array of 64 items. Every pad
 * mutation via .map() allocates 64 new objects. For high-frequency real-time
 * events (pad press/release, aftertouch), this should be refactored to use
 * indexed access or a Map<number, PushPad> for O(1) single-pad updates
 * instead of O(n) full-array mapping.
 */

import { createStore } from '#/infra/store/createStore';

export type PushPadMode = 'session' | 'note' | 'drum' | 'chromatic' | 'scale' | 'user';

export type PushPadColor = {
    r: number;
    g: number;
    b: number;
};

export type PushPad = {
    index: number;
    /** MIDI note for this pad */
    midiNote: number;
    velocity: number;
    color: PushPadColor;
    aftertouch: number;
};

export type PushEncoder = {
    index: number;
    value: number;
    /** Parameter this encoder controls */
    parameterPath: string | null;
    label: string;
};

export type PushDisplay = {
    /** 4 lines of text, 68 chars per line on Push 2 */
    lines: [string, string, string, string];
};

export type PushState = {
    connected: boolean;
    model: 'push2' | 'push3' | null;
    padMode: PushPadMode;
    /** 64 pads (8x8 grid) */
    pads: PushPad[];
    /** 8 touch encoders */
    encoders: PushEncoder[];
    /** Display state */
    display: PushDisplay;
    /** Current scale for note/scale modes */
    rootNote: number;
    /** Scale name */
    scaleName: string;
    /** Tempo encoder value */
    tempo: number;
    /** Touch strip position (0-1) */
    touchStripPosition: number;
};

/** Color presets for each pad mode */
export const PAD_MODE_COLORS: Record<PushPadMode, PushPadColor> = {
    session: { r: 0, g: 127, b: 0 },
    note: { r: 0, g: 0, b: 127 },
    drum: { r: 127, g: 127, b: 0 },
    chromatic: { r: 127, g: 0, b: 127 },
    scale: { r: 0, g: 127, b: 127 },
    user: { r: 64, g: 64, b: 64 },
};

export const pushStore = createStore<PushState>({
    initialData: {
        connected: false,
        model: null,
        padMode: 'session',
        pads: Array.from({ length: 64 }, (_, i) => ({
            index: i,
            midiNote: 36 + i,
            velocity: 0,
            color: { r: 0, g: 0, b: 0 },
            aftertouch: 0,
        })),
        encoders: Array.from({ length: 8 }, (_, i) => ({
            index: i,
            value: 64,
            parameterPath: null,
            label: '',
        })),
        display: { lines: ['', '', '', ''] },
        rootNote: 0, // C
        scaleName: 'Major',
        tempo: 120,
        touchStripPosition: 0.5,
    },
});
