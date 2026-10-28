import { pendingOverdubLandings } from '../../repositories/webMidi/pendingOverdubLandings';

/** How many overdub passes have settled since the app started, whether they landed or were refused. */
export function countSettledOverdubPasses(): number {
    return pendingOverdubLandings.countSettled();
}
