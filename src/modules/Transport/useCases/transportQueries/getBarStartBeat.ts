import { readBarStartBeat } from '../../stores/readBarStartBeat';

/**
 * The beat a 1-based bar opens on through the project's meter map, or `null` for a bar number
 * that names no bar. Pass the bar after a range's last bar to find where that range ends.
 */
export function getBarStartBeat(bar: number): number | null {
    return readBarStartBeat({ bar });
}
