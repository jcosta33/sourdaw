import { type OverdubControllerRowIds } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';

type RowsByClipId<TRow> = Record<string, TRow[]>;

/** What to take out of one clip's list, and whether the list existed before the pass that added the rows. */
type ListRemoval = {
    ids: Set<string>;
    listExisted: boolean;
};

/**
 * The per-clip lists without the rows named for each clip. A list the pass created is dropped
 * once it is empty, the state a clip without one had before it; a list that existed stays,
 * empty if need be, because "no list" and "an empty list" are different states to the
 * operations that compare them (a split's undo guard reads list presence). A list with
 * nothing to remove is untouched. `removed` counts the rows taken out.
 */
function withoutRows<TRow extends { id: string }>(
    rowsByClipId: RowsByClipId<TRow>,
    removals: ReadonlyMap<string, ListRemoval>
): { rowsByClipId: RowsByClipId<TRow>; removed: number } {
    let next = rowsByClipId;
    let removed = 0;
    for (const [clipId, { ids, listExisted }] of removals) {
        const existing = rowsByClipId[clipId];
        if (!existing) {
            continue;
        }
        const kept = existing.filter((row) => !ids.has(row.id));
        if (kept.length === existing.length) {
            continue;
        }
        removed += existing.length - kept.length;
        const { [clipId]: _dropped, ...others } = next;
        next = kept.length === 0 && !listExisted ? others : { ...next, [clipId]: kept };
    }
    return { rowsByClipId: next, removed };
}

function collectRemovals(
    clips: readonly OverdubControllerRowIds[],
    pick: (clip: OverdubControllerRowIds) => { ids: readonly string[]; listExisted: boolean }
): Map<string, ListRemoval> {
    const removals = new Map<string, ListRemoval>();
    for (const clip of clips) {
        const { ids, listExisted } = pick(clip);
        const removal = removals.get(clip.clipId) ?? { ids: new Set<string>(), listExisted };
        for (const id of ids) {
            removal.ids.add(id);
        }
        removal.listExisted = removal.listExisted || listExisted;
        removals.set(clip.clipId, removal);
    }
    return removals;
}

/**
 * Take the named controller and pitch-bend rows out of their clips in one store
 * write, the inverse of `appendRecordedMidiControllers`. Every other row of the
 * clip, a peer's edit made after the overdub included, stays where it is.
 * Returns whether any row was removed.
 */
export function removeRecordedMidiControllers(clips: readonly OverdubControllerRowIds[]): boolean {
    const midiState = midiStore.value;
    if (!midiState) {
        return false;
    }
    const cc = withoutRows(
        midiState.ccByClipId,
        collectRemovals(clips, (clip) => ({ ids: clip.ccIds, listExisted: clip.ccListExisted }))
    );
    const pitchBend = withoutRows(
        midiState.pitchBendByClipId,
        collectRemovals(clips, (clip) => ({ ids: clip.pitchBendIds, listExisted: clip.pitchBendListExisted }))
    );
    if (cc.removed + pitchBend.removed === 0) {
        return false;
    }
    midiStore.set({
        ...midiState,
        ccByClipId: cc.rowsByClipId,
        pitchBendByClipId: pitchBend.rowsByClipId,
    });
    return true;
}
