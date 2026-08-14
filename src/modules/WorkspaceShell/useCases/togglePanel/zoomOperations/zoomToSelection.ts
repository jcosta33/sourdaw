import { inject } from '#/infra/di/inject';
import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';

import { WorkspaceEventBus } from '../../workspaceEventBus';

export const zoomToSelection = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function zoomToSelection(): void {
            const ws = clipSelectionStore.value;
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

            // Set, not Array#includes: the lookup sits inside a tracks × clips loop,
            // so a linear scan per clip makes a large marquee selection quadratic.
            const selectedIdSet = new Set(selectedIds);

            let minStart = Infinity;
            let maxEnd = -Infinity;
            for (const track of state.tracks) {
                for (const clip of track.clips) {
                    if (selectedIdSet.has(clip.id)) {
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
