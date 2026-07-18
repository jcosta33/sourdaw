import { type MidiMappingScaleMode } from '../../stores/midiLearnStore';

/**
 * Map a raw 7-bit MIDI value (0-127) into [min, max] using the given curve.
 * `linear` is the default and matches the historical behaviour; `log` produces
 * a perceptual taper for gain (more travel near the top) and `exp` its inverse.
 * The normalised position is clamped to [0, 1] so out-of-spec raw values can't
 * push the result outside the target range.
 */
export function scaleMidiValue(
    raw: number,
    min: number,
    max: number,
    scaleMode: MidiMappingScaleMode = 'linear'
): number {
    const t = Math.max(0, Math.min(1, raw / 127));
    let curved: number;
    switch (scaleMode) {
        case 'log':
            // Concave curve: equal MIDI steps cover more range up high.
            curved = Math.sqrt(t);
            break;
        case 'exp':
            // Convex curve: equal MIDI steps cover more range down low.
            curved = t * t;
            break;
        case 'linear':
        default:
            curved = t;
            break;
    }
    return min + curved * (max - min);
}
