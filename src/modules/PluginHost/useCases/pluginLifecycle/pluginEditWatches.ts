/**
 * How many edits the plugin itself has made to a parameter while the host has a
 * send for it outstanding. A send compares the count at dispatch with the count
 * at settlement: a plugin edit in between is the newer truth, and the send must
 * not overwrite it in the snapshot.
 *
 * Only parameters with a host send outstanding are held, so the map is empty
 * when the host is idle.
 */
export const pluginEditCounts = new Map<string, number>();

export function pluginEditWatchKey(instanceId: string, parameterId: number): string {
    return `${instanceId}|${String(parameterId)}`;
}
