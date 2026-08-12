import { pushStore } from '../../stores/push';

/**
 * Handle a pad press event from the Push hardware.
 *
 * Indexed write rather than `.map()` over all 64 pads (F-6): pad events now
 * arrive from live hardware via connectPush, so this runs per real-time pad
 * hit rather than hypothetically.
 */
export function handlePadPress(padIndex: number, velocity: number): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    const pad = state.pads[padIndex];
    if (!pad) {
        return;
    }
    // Clamp to the 7-bit MIDI domain, matching setEncoderValue's clamp (F-7):
    // pad presses now arrive from live hardware via connectPush, so an
    // out-of-spec velocity is no longer hypothetical.
    const clampedVelocity = Math.max(0, Math.min(127, velocity));
    const pads = [...state.pads];
    pads[padIndex] = { ...pad, velocity: clampedVelocity };
    pushStore.set({ ...state, pads });
}
