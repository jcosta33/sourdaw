import { pendingOverdubLandings } from '../../repositories/webMidi/pendingOverdubLandings';

/** Resolve once every overdub pass landing has landed or been refused, including passes registered while waiting. */
export function waitForOverdubLanding(): Promise<void> {
    return pendingOverdubLandings.waitForSettled();
}
