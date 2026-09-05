/**
 * Claim the strips the native session sounds, in both places that have to know
 * (#3568).
 *
 * Web Audio has to shut its gates for them, and the tick path has to know that
 * a device on one of them is having its parameters stamped by the engine rather
 * than written over IPC. Those are one claim, so they are made in one call: two
 * call sites for the same fact is how they come to disagree, and a disagreement
 * here either doubles a mix or drives one plugin parameter from both engines.
 */

import { setNativeCarriedTracks } from '../trackAudioControls/setNativeCarriedTracks';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function claimCarriedStrips(stripIds: ReadonlySet<string>): void {
    nativeLiveGraphSession.carriedStripIds = stripIds;
    setNativeCarriedTracks(stripIds);
}
