import { readBarAtBeat } from '../../stores/readBarAtBeat';

/**
 * The 1-based bar a beat falls in through the project's meter map, and whether the beat is that
 * bar's bar line.
 */
export function getBarAtBeat(beat: number): { bar: number; opensBar: boolean } {
    return readBarAtBeat({ beat });
}
