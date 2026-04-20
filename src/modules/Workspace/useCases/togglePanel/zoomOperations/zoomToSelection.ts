import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { trackStore } from '#/modules/Arrangement/stores';

import { getWorkspaceState } from '../../../repositories/workspace';

export const zoomToSelection = inject({ eventBus })(
    ({ eventBus }) =>
        function zoomToSelection(): void {
            const ws = getWorkspaceState();
            const state = trackStore.value;
            if (!ws || !state) {
                return;
            }

            const selectedIds =
                ws.selectedClipIds.length > 0 ? ws.selectedClipIds : ws.selectedClipId ? [ws.selectedClipId] : [];

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

            eventBus.emit('zoom.toSelection', { startBeat: minStart, endBeat: maxEnd });
        }
);
