/**
 * The one row that takes Tab: the selected track's row while the list draws it,
 * else the first drawn row, so the list stays reachable when nothing is
 * selected or the selection sits in a collapsed folder or a hidden track.
 */
export function getTabStopTrackId(rows: readonly { id: string }[], selectedTrackId: string | null): string | null {
    if (selectedTrackId !== null && rows.some((row) => row.id === selectedTrackId)) {
        return selectedTrackId;
    }
    return rows[0]?.id ?? null;
}
