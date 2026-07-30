import { audioEngine } from '../../repositories/createWebAudioEngine';
import { getSidechainKeyDelay } from '../latencyCompensation/compensation/getSidechainKeyDelay';

/**
 * FX-5 — push the current key alignment onto every wired sidechain route.
 *
 * This is the seam that keeps the live key delay honest: the scheduler injects
 * the resolver from its one immutable per-tick latency snapshot, and the engine
 * only glides a delay line when the resolved value actually moved. A mid-session
 * latency push — a native plugin reporting new lookahead, or a device being
 * added, removed, or bypassed — is therefore followed within one grain rather
 * than held stale until the next transport start.
 *
 * It also keeps project state out of the engine repository: the resolver is
 * handed in, so the engine never reads `trackStore` itself.
 */
export function refreshSidechainAlignment(
    resolveSidechainKeyDelay: typeof getSidechainKeyDelay = getSidechainKeyDelay
): void {
    audioEngine.refreshSidechainAlignment(resolveSidechainKeyDelay);
}
