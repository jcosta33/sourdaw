import { inject } from '#/infra/di/inject';
import { trackStore } from '#/modules/Arrangement/stores';

import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { WorkspaceEventBus } from '../../workspaceEventBus';

export const zoomToSelection = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function zoomToSelection(): void {
            const ws = getWorkspaceState();
            const state = trackStore.value;
            if (!ws || !state) {
                return;
            }

            let selectedIds: string[];
            if (ws.selectedClipIds.length > 0) {
                selectedIds = ws.selectedClipIds;
            } else if (ws.selectedClipId) {
                selectedIds = [ws.selectedClipId];
            } else {
                selectedIds = [];
            }

            if (selectedIds.length === 0) {
                return;
            }

            let minStart = Infinity;
            let maxEnd = -Infinity;
            for (const track of state.tracks) {
                for (const clip of track.clips) {
                    if (selectedIds.includes(clip.id)) {
                        if (clip.startBeat < minStart) {
                            minStart = clip.startBeat;
                        }
                        if (clip.endBeat > maxEnd) {
                            maxEnd = clip.endBeat;
                        }
                    }
                }
            }

            if (minStart === Infinity || maxEnd === -Infinity || maxEnd <= minStart) {
                return;
            }

            void eventBus.emit('zoom.toSelection', { startBeat: minStart, endBeat: maxEnd });
        }
);
