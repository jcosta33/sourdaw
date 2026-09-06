/**
 * The pass's own strips, with each one's contents as project truth holds them
 * now (#3568).
 *
 * Every arm claims to re-project the whole world — `armNativeLiveAutomationWriter`
 * clears `pendingRearm` on exactly that claim — so every caller that arms an
 * existing pass has to hand it the store's current chains. Reading them here
 * rather than at each caller is what makes the claim hold by construction: a
 * caller that passed the arm-time objects instead would find no parameters for
 * a plugin that arrived after the pass was taken, while the tick path — which
 * reads the engine's own chain — has already stopped writing that device over
 * IPC, and the strip would be driven by neither engine.
 *
 * The strip *set* stays exactly the one the session's topology built. A strip
 * missing from the store keeps its arm-time object rather than dropping out:
 * `carriedStripIds` still names it, so its devices are still the engine's as
 * far as every other reader is concerned.
 */

import { trackStore, type Track } from '#/modules/Arrangement/stores';

export function currentStripTracks(stripTracks: readonly Track[]): readonly Track[] {
    const byId = new Map((trackStore.value?.tracks ?? []).map((track): [string, Track] => [track.id, track]));
    return stripTracks.map((track) => byId.get(track.id) ?? track);
}
