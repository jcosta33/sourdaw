import { inject } from '#/infra/di/inject';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { applyVelocityCurve as applyVelocityCurveDependency, type VelocityCurve } from '#/modules/Arrangement';

export const scaleVelocitiesDependencies = {
    applyVelocityCurveDependency: () => applyVelocityCurveDependency,
} as const;

export const scaleVelocities = inject(scaleVelocitiesDependencies)(
    ({ applyVelocityCurveDependency }) =>
        function scaleVelocities(clipId: string, curve: VelocityCurve, minVelocity = 1, maxVelocity = 127): void {
            const applyVelocityCurve = applyVelocityCurveDependency();
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
);
