import { type MidiMappingScaleMode } from '../../stores/midiLearnStore';

/**
 * Map a raw 7-bit MIDI value (0-127) into [min, max] using the given curve.
 * `linear` is the default and matches the historical behaviour; `log` produces
 * a perceptual taper for gain (more travel near the top) and `exp` its inverse.
 * The normalised position is clamped to [0, 1] so out-of-spec raw values can't
 * push the result outside the target range.
 *
 * `normalized` overrides `raw / 127` for controllers that arrived as a 14-bit
 * MSB/LSB pair (audit MD-7): the caller has already resolved the position at
 * full resolution and `raw` is only its MSB, so re-deriving it here would throw
 * the extra 7 bits away. The curve and the clamp are unchanged either way.
 */
export function scaleMidiValue(
    raw: number,
    min: number,
    max: number,
    scaleMode: MidiMappingScaleMode = 'linear',
    normalized?: number
): number {
    const position = normalized ?? raw / 127;
    const t = Math.max(0, Math.min(1, position));
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
