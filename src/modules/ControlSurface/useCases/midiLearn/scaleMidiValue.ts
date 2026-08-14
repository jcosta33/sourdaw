import { type MidiMappingScaleMode } from '../../stores/midiLearnStore';

/**
 * Map a raw 7-bit MIDI value (0-127) into [min, max] using the given curve.
 * `linear` is the default and matches the historical behaviour; `log` is the
 * convex audio-pot taper for gain (equal MIDI steps cover more range near the
 * top, matching perceived loudness) and `exp` is its inverse (more range near
 * the bottom). The normalised position is clamped to [0, 1] so out-of-spec raw
 * values can't push the result outside the target range.
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
            // Convex audio-pot taper: stays low longer, so equal MIDI steps
            // cover more range up high (matches perceived loudness).
            curved = t * t;
            break;
        case 'exp':
            // Concave inverse taper: reaches higher faster, so equal MIDI
            // steps cover more range down low.
            curved = Math.sqrt(t);
            break;
        case 'linear':
        default:
            curved = t;
            break;
    }
    return min + curved * (max - min);
}
