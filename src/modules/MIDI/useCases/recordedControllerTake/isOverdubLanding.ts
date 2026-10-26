import { pendingOverdubLandings } from '../../repositories/webMidi/pendingOverdubLandings';

/** True while an overdub pass's rows are landing in the store: neither landed nor refused yet. */
export function isOverdubLanding(): boolean {
    return pendingOverdubLandings.isLanding();
}
