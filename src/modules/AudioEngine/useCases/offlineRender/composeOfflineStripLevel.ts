import { PAN_SCALE_MAX } from '#/utils/audioLevelLaw';

/**
 * Fold an adjustment composition into a strip's seed level — the offline
 * mirror of live's `composedGain`/`composedPan` writes. Gain composes
 * multiplicatively before the strip's fader clamp (the order the VCA fold
 * already uses: multiply, then clamp); pan composes additively in stored
 * units and clamps to the travel, exactly as live's `composedPan` does before
 * `toStereoPan`.
 */
export function composeOfflineStripLevel(
    level: { gain: number; pan: number },
    composition: { gainMultiplier: number; panOffset: number }
): { gain: number; pan: number } {
    return {
        gain: level.gain * composition.gainMultiplier,
        pan: Math.max(-PAN_SCALE_MAX, Math.min(PAN_SCALE_MAX, level.pan + composition.panOffset)),
    };
}
