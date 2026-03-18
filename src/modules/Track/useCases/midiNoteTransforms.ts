import { midiStore } from '../stores/midiStore';
import { applyVelocityCurve, type VelocityCurve } from '../transformers/velocityCurveTransformer';

// Re-export for consumers
export type { VelocityCurve } from '../transformers/velocityCurveTransformer';

export function quantizeNotes(clipId: string, gridSize: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                startBeat: Math.round(n.startBeat / gridSize) * gridSize,
            })),
        },
    });
}

export function quantizeNoteLengths(clipId: string, gridSize: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                duration: Math.max(gridSize, Math.round(n.duration / gridSize) * gridSize),
            })),
        },
    });
}

export function quantizeNotesAndLengths(clipId: string, gridSize: number): void {
    quantizeNotes(clipId, gridSize);
    quantizeNoteLengths(clipId, gridSize);
}

export function transposeNotes(clipId: string, semitones: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                pitch: Math.max(0, Math.min(127, n.pitch + semitones)),
            })),
        },
    });
}

export function humanizeNotes(clipId: string, amount: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                startBeat: n.startBeat + (Math.random() - 0.5) * amount * 0.25,
                velocity: Math.max(1, Math.min(127, n.velocity + Math.round((Math.random() - 0.5) * amount * 10))),
            })),
        },
    });
}

export function invertNotes(clipId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length < 2) {
        return;
    }

    const pitches = existing.map((n) => n.pitch);
    const minPitch = Math.min(...pitches);
    const maxPitch = Math.max(...pitches);
    const axis = minPitch + maxPitch;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                pitch: Math.max(0, Math.min(127, axis - n.pitch)),
            })),
        },
    });
}

export function retrogradeNotes(clipId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length < 2) {
        return;
    }

    const starts = existing.map((n) => n.startBeat);
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...existing.map((n) => n.startBeat + n.duration));
    const totalLength = maxEnd - minStart;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                startBeat: minStart + totalLength - (n.startBeat - minStart) - n.duration,
            })),
        },
    });
}

export function scaleVelocities(clipId: string, curve: VelocityCurve, minVelocity = 1, maxVelocity = 127): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) {
        return;
    }

    const velocities = existing.map((n) => n.velocity);
    const currentMin = Math.min(...velocities);
    const currentMax = Math.max(...velocities);
    const range = currentMax - currentMin || 1;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => {
                const normalized = (n.velocity - currentMin) / range;
                const curved = applyVelocityCurve(normalized, curve);
                const newVelocity = Math.round(minVelocity + curved * (maxVelocity - minVelocity));
                return {
                    ...n,
                    velocity: Math.max(1, Math.min(127, newVelocity)),
                };
            }),
        },
    });
}

export function scaleAllVelocities(clipId: string, factor: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                velocity: Math.max(1, Math.min(127, Math.round(n.velocity * factor))),
            })),
        },
    });
}

export function setAllVelocities(clipId: string, velocity: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) {
        return;
    }

    const clamped = Math.max(1, Math.min(127, velocity));

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                velocity: clamped,
            })),
        },
    });
}
