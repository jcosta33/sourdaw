/**
 * Hand the record a start found back to the session it found it in.
 *
 * A start whose whole batch the engine refused rebuilt nothing: an adopted
 * session's engine still holds the graph the record it kept describes — the one
 * the stop contract deliberately keeps when the park is refused — so the
 * projection the start wrote optimistically is the only thing that has to go.
 * Clearing instead would strand a still-sounding session where every mirror
 * edit skips as strip-not-built.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function restoreNativeChains(chains: ReadonlyMap<string, readonly string[]>): void {
    nativeLiveGraphSession.nativeChainByStripId = chains;
}
