import { type Track } from '../../models/Track';
import { setVcaGroupsState, type VcaGroup } from '../../stores/vcaGroupStore';
import { setTrackState } from '../setTrackState';

type LegacyVcaTemplateGroup = {
    id: string;
    name: string;
    gain: number;
    muted: boolean;
    memberTrackIds: readonly string[];
};

type CommitLegacyVcaTemplateStateInput = {
    groups: readonly LegacyVcaTemplateGroup[];
    tracks: readonly Track[];
    selectedTrackId: string | null;
};

export function commitLegacyVcaTemplateState(input: CommitLegacyVcaTemplateStateInput): Track[] {
    const groupIds = new Set<string>();
    for (const group of input.groups) {
        if (groupIds.has(group.id)) {
            throw new Error(`Duplicate legacy VCA group id: ${group.id}`);
        }
        groupIds.add(group.id);
    }

    const availableTrackIds = new Set(input.tracks.map((track) => track.id));
    const ownerByTrackId = new Map<string, string>();
    const legacyGroups: VcaGroup[] = [];

    for (const group of input.groups) {
        const trackIds: string[] = [];
        for (const trackId of group.memberTrackIds) {
            if (!availableTrackIds.has(trackId) || ownerByTrackId.has(trackId)) {
                continue;
            }

            ownerByTrackId.set(trackId, group.id);
            trackIds.push(trackId);
        }

        legacyGroups.push({
            id: group.id,
            name: group.name,
            gain: group.gain,
            muted: group.muted,
            trackIds,
        });
    }

    const assignedTracks = input.tracks.map((track) => ({
        ...track,
        vcaGroupId: ownerByTrackId.get(track.id) ?? null,
    }));

    setVcaGroupsState(legacyGroups);
    setTrackState({
        tracks: assignedTracks,
        selectedTrackId: input.selectedTrackId,
    });
    return assignedTracks;
}
