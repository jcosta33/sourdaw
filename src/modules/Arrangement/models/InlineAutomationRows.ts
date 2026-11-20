import { type Track } from './Track';

type AutomationRowOwner = { trackId: string; clipId?: string; parameterId: string; visible: boolean };
type InlineAutomationSelection = {
    automationVisibility: string;
    automationSubLanes: Readonly<Record<string, readonly string[]>>;
};

export function getInlineAutomationRows<Lane extends AutomationRowOwner>(
    tracks: readonly Pick<Track, 'id' | 'kind'>[],
    lanes: readonly Lane[],
    editing: InlineAutomationSelection | null
): ReadonlyMap<string, readonly Lane[]> {
    const rows = new Map<string, Lane[]>();
    if (editing?.automationVisibility !== 'overlay') {
        return rows;
    }
    const hosts = new Set(
        tracks.filter((track) => track.kind !== 'folder' && track.kind !== 'master').map(({ id }) => id)
    );
    for (const lane of lanes) {
        const { trackId, clipId, parameterId, visible } = lane;
        const selectedParameters = editing.automationSubLanes[trackId];
        if (
            !hosts.has(trackId) ||
            clipId !== undefined ||
            !visible ||
            (selectedParameters && !selectedParameters.includes(parameterId))
        ) {
            continue;
        }
        const trackRows = rows.get(trackId);
        if (trackRows) {
            trackRows.push(lane);
        } else {
            rows.set(trackId, [lane]);
        }
    }
    return rows;
}
