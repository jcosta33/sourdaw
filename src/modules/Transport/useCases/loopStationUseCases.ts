/**
 * Integrated Loop Station
 *
 * Hardware-style live looping in clip slots with overdub,
 * quantized recording, undo last layer, and sync to transport.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type LoopSlotState = 'empty' | 'recording' | 'playing' | 'overdubbing' | 'stopped';

export type LoopLayer = {
    id: string;
    /** Layer index (0 = base, 1+ = overdubs) */
    layerIndex: number;
    /** When this layer was recorded */
    recordedAt: string;
    /** Whether this layer is muted */
    muted: boolean;
    /** Volume level (0-1) */
    volume: number;
};

export type LoopSlot = {
    id: string;
    /** Which track this slot is on */
    trackId: string;
    /** Row index in the clip launcher grid */
    row: number;
    /** Column index */
    column: number;
    /** Current state */
    state: LoopSlotState;
    /** Loop duration in beats (set after first recording) */
    lengthBeats: number;
    /** Overdub layers */
    layers: LoopLayer[];
    /** Number of times the loop has repeated */
    loopCount: number;
    /** Master volume */
    volume: number;
    /** Is quantize-to-bar enabled? */
    quantize: boolean;
    /** Fade-in/out duration in beats */
    fadeBeats: number;
};

export type LoopStationState = {
    slots: LoopSlot[];
    /** How many columns (scenes) */
    sceneCount: number;
    /** Active scene column index */
    activeScene: number;
    /** Global record arm */
    armed: boolean;
    /** Sync to transport tempo */
    syncToTransport: boolean;
    /** Fixed loop length in beats (0 = auto-detect from first recording) */
    fixedLoopLength: number;
};

export const loopStationStore = new Store<LoopStationState>(logger, {
    initialData: {
        slots: [],
        sceneCount: 8,
        activeScene: 0,
        armed: false,
        syncToTransport: true,
        fixedLoopLength: 0,
    },
});

let slotId = 1;
let layerId = 1;

// ── Slot Management ───────────────────────────────────────────────────

export function createSlot(trackId: string, row: number, column: number): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }

    const slot: LoopSlot = {
        id: `loop-${slotId++}`,
        trackId, row, column,
        state: 'empty',
        lengthBeats: 0,
        layers: [],
        loopCount: 0,
        volume: 1,
        quantize: true,
        fadeBeats: 0.125,
    };

    loopStationStore.set({ ...state, slots: [...state.slots, slot] });
}

export function toggleRecord(slotIdVal: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }

    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) => {
            if (s.id !== slotIdVal) {
                return s;
            }

            switch (s.state) {
                case 'empty':
                    return { ...s, state: 'recording' as const };
                case 'recording': {
                    // Stop recording, start playing, add layer
                    const layer: LoopLayer = {
                        id: `layer-${layerId++}`, layerIndex: 0,
                        recordedAt: new Date().toISOString(), muted: false, volume: 1,
                    };
                    return {
                        ...s, state: 'playing' as const, layers: [layer],
                        lengthBeats: state.fixedLoopLength || 4,
                    };
                }
                case 'playing':
                    return { ...s, state: 'overdubbing' as const };
                case 'overdubbing': {
                    const newLayer: LoopLayer = {
                        id: `layer-${layerId++}`, layerIndex: s.layers.length,
                        recordedAt: new Date().toISOString(), muted: false, volume: 1,
                    };
                    return { ...s, state: 'playing' as const, layers: [...s.layers, newLayer] };
                }
                case 'stopped':
                    return { ...s, state: 'playing' as const };
                default:
                    return s;
            }
        }),
    });
}

export function stopSlot(slotIdVal: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) =>
            s.id === slotIdVal ? { ...s, state: 'stopped' as const } : s
        ),
    });
}

export function clearSlot(slotIdVal: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) =>
            s.id === slotIdVal
                ? { ...s, state: 'empty' as const, layers: [], lengthBeats: 0, loopCount: 0 }
                : s
        ),
    });
}

export function undoLastLayer(slotIdVal: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) => {
            if (s.id !== slotIdVal || s.layers.length === 0) {
                return s;
            }
            const layers = s.layers.slice(0, -1);
            return {
                ...s,
                layers,
                state: layers.length === 0 ? ('empty' as const) : s.state,
            };
        }),
    });
}

// ── Scene Control ─────────────────────────────────────────────────────

export function triggerScene(column: number): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        activeScene: column,
        slots: state.slots.map((s) => {
            if (s.column === column && s.layers.length > 0) {
                return { ...s, state: 'playing' as const };
            }
            if (s.column !== column && s.state === 'playing') {
                return { ...s, state: 'stopped' as const };
            }
            return s;
        }),
    });
}

export function stopAllSlots(): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) =>
            s.state === 'playing' || s.state === 'overdubbing'
                ? { ...s, state: 'stopped' as const }
                : s
        ),
    });
}

// ── Settings ──────────────────────────────────────────────────────────

export function setFixedLoopLength(beats: number): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({ ...state, fixedLoopLength: beats });
}

export function toggleArm(): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({ ...state, armed: !state.armed });
}

export function toggleSync(): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({ ...state, syncToTransport: !state.syncToTransport });
}
