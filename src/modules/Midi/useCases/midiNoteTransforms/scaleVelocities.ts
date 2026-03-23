import { midiStore } from '#/modules/Midi/stores/midiStore';
import { applyVelocityCurve, type VelocityCurve } from '#/modules/Track/transformers/velocityCurveTransformer';

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
