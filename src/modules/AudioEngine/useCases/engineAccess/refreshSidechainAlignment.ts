import { audioEngine } from '../../repositories/createWebAudioEngine';
import { getSidechainKeyDelay } from '../latencyCompensation/compensation/getSidechainKeyDelay';

/**
 * FX-5 — push the current key alignment onto every wired sidechain route.
 *
 * This is the seam that keeps the live key delay honest: `getSidechainKeyDelay`
 * recomputes from project state on every call (nothing caches, same discipline
 * the native-plugin latency path is locked to), and the engine only glides a
 * delay line when the resolved value actually moved. Running it once per
 * scheduler tick means a mid-session latency push — a native plugin reporting a
 * new lookahead, a device added, removed or bypassed — is followed within one
 * grain rather than held stale until the next transport start.
 *
 * It also keeps project state out of the engine repository: the resolver is
 * handed in, so the engine never reads `trackStore` itself.
 */
export function refreshSidechainAlignment(): void {
    audioEngine.refreshSidechainAlignment(getSidechainKeyDelay);
}
