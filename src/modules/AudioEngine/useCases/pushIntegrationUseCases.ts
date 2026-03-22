/**
 * Ableton Push Integration
 *
 * Deep hardware integration for Push 2/3 controllers.
 * Pad grid, knob mapping, display feedback, mode switching.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

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

export const pushStore = new Store<PushState>(logger, {
    initialData: {
        connected: false,
        model: null,
        padMode: 'session',
        pads: Array.from({ length: 64 }, (_, i) => ({
            index: i, midiNote: 36 + i, velocity: 0,
            color: { r: 0, g: 0, b: 0 }, aftertouch: 0,
        })),
        encoders: Array.from({ length: 8 }, (_, i) => ({
            index: i, value: 64, parameterPath: null, label: '',
        })),
        display: { lines: ['', '', '', ''] },
        rootNote: 0, // C
        scaleName: 'Major',
        tempo: 120,
        touchStripPosition: 0.5,
    },
});

// ── Connection ────────────────────────────────────────────────────────

export function connectPush(model: 'push2' | 'push3'): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({ ...state, connected: true, model });
}

export function disconnectPush(): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({ ...state, connected: false, model: null });
}

// ── Pad Control ───────────────────────────────────────────────────────

export function setPadMode(mode: PushPadMode): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({ ...state, padMode: mode });
    updatePadColors(mode);
}

export function setPadColor(padIndex: number, color: PushPadColor): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        pads: state.pads.map((p) => (p.index === padIndex ? { ...p, color } : p)),
    });
}

export function handlePadPress(padIndex: number, velocity: number): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        pads: state.pads.map((p) => (p.index === padIndex ? { ...p, velocity } : p)),
    });
}

export function handlePadRelease(padIndex: number): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        pads: state.pads.map((p) => (p.index === padIndex ? { ...p, velocity: 0 } : p)),
    });
}

// ── Encoders ──────────────────────────────────────────────────────────

export function setEncoderValue(encoderIndex: number, value: number): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        encoders: state.encoders.map((e) =>
            e.index === encoderIndex ? { ...e, value: Math.max(0, Math.min(127, value)) } : e
        ),
    });
}

export function mapEncoder(encoderIndex: number, parameterPath: string, label: string): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        encoders: state.encoders.map((e) =>
            e.index === encoderIndex ? { ...e, parameterPath, label } : e
        ),
    });
}

// ── Display ───────────────────────────────────────────────────────────

export function updateDisplay(lineIndex: number, text: string): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    const lines = [...state.display.lines] as [string, string, string, string];
    lines[lineIndex] = text.slice(0, 68);
    pushStore.set({ ...state, display: { lines } });
}

// ── Scale ─────────────────────────────────────────────────────────────

export function setScale(rootNote: number, scaleName: string): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({ ...state, rootNote: rootNote % 12, scaleName });
}

// ── Helpers ───────────────────────────────────────────────────────────

function updatePadColors(mode: PushPadMode): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }

    const colorMap: Record<PushPadMode, PushPadColor> = {
        session: { r: 0, g: 127, b: 0 },
        note: { r: 0, g: 0, b: 127 },
        drum: { r: 127, g: 127, b: 0 },
        chromatic: { r: 127, g: 0, b: 127 },
        scale: { r: 0, g: 127, b: 127 },
        user: { r: 64, g: 64, b: 64 },
    };

    const color = colorMap[mode];
    pushStore.set({
        ...state,
        pads: state.pads.map((p) => ({ ...p, color })),
    });
}
