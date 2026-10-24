import { type OverdubControllerRowsSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';

import { readLiveClipIds } from './readLiveClipIds';

/**
 * The part of an overdub pass `appendOverdubControllers` actually writes: the
 * clips still on the timeline, without the rows the store already holds under
 * the same id (a replay never doubles a row), and only the clips left with a
 * row to add.
 *
 * Reads only. The action's `describe` names the same rows in its inverse that
 * `execute` then writes.
 */
export function readOverdubRowsToAppend(
    clips: readonly OverdubControllerRowsSnapshot[]
): OverdubControllerRowsSnapshot[] {
    const midiState = midiStore.value;
    if (!midiState) {
        return [];
    }
    const liveClipIds = readLiveClipIds();
    const toAppend: OverdubControllerRowsSnapshot[] = [];
    for (const clip of clips) {
        if (!liveClipIds.has(clip.clipId)) {
            continue;
        }
        const storedCcIds = new Set((midiState.ccByClipId[clip.clipId] ?? []).map((row) => row.id));
        const storedPitchBendIds = new Set((midiState.pitchBendByClipId[clip.clipId] ?? []).map((row) => row.id));
        const cc = clip.cc.filter((row) => !storedCcIds.has(row.id));
        const pitchBend = clip.pitchBend.filter((row) => !storedPitchBendIds.has(row.id));
        if (cc.length > 0 || pitchBend.length > 0) {
            toAppend.push({ clipId: clip.clipId, cc, pitchBend });
        }
    }
    return toAppend;
}
