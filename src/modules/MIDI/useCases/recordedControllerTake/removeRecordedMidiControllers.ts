import { type OverdubControllerRowIds } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';

type RowsByClipId<TRow> = Record<string, TRow[]>;

/**
 * The per-clip lists without the rows named for each clip. A list left empty is
 * dropped, the state a clip the overdub filled first had before it; a list with
 * nothing to remove is untouched. `removed` counts the rows taken out.
 */
function withoutRows<TRow extends { id: string }>(
    rowsByClipId: RowsByClipId<TRow>,
    idsByClipId: ReadonlyMap<string, ReadonlySet<string>>
): { rowsByClipId: RowsByClipId<TRow>; removed: number } {
    let next = rowsByClipId;
    let removed = 0;
    for (const [clipId, ids] of idsByClipId) {
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
        next = kept.length === 0 ? others : { ...next, [clipId]: kept };
    }
    return { rowsByClipId: next, removed };
}

function collectIds(
    clips: readonly OverdubControllerRowIds[],
    pickIds: (clip: OverdubControllerRowIds) => readonly string[]
): Map<string, Set<string>> {
    const idsByClipId = new Map<string, Set<string>>();
    for (const clip of clips) {
        const ids = idsByClipId.get(clip.clipId) ?? new Set<string>();
        for (const id of pickIds(clip)) {
            ids.add(id);
        }
        idsByClipId.set(clip.clipId, ids);
    }
    return idsByClipId;
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
        collectIds(clips, (clip) => clip.ccIds)
    );
    const pitchBend = withoutRows(
        midiState.pitchBendByClipId,
        collectIds(clips, (clip) => clip.pitchBendIds)
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
