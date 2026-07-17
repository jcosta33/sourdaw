import { vcaGroupStore } from '#/modules/Arrangement/stores';

import type { Track } from '#/modules/Arrangement/stores';
import type { VcaGroupHandle } from './builderTypes';

export function commitVcaGroups(handles: VcaGroupHandle[], allTracks: Track[]): void {
    vcaGroupStore.set({
        groups: handles.map((handle) => ({
            id: handle.id,
            name: handle.name,
            gain: 1,
            muted: false,
            trackIds: handle.memberTrackIds,
        })),
    });
    for (const handle of handles) {
        for (const memberId of handle.memberTrackIds) {
            const member = allTracks.find((track) => track.id === memberId);
            if (member) {
                member.vcaGroupId = handle.id;
            }
        }
    }
}
