import { inject } from '#/infra/di/inject';
import { getWorkspaceState } from '../../repositories/workspace';
import { trackStore } from '#/modules/Arrangement';
import { eventBus } from '#/app/registerDependencies';
import { type ZoomToSelectionPayload } from '#/modules/Workspace/events/WorkspaceEvents';

export const zoomToFit = inject({ eventBus })(
    ({ eventBus }) =>
        function zoomToFit(): void {
            eventBus.emit('zoom.toFit', undefined);
        }
);

export const zoomToSelection = inject({ eventBus, getWorkspaceState })(
    ({ eventBus, getWorkspaceState }) =>
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

export const cycleAutomationVisibility = inject({ eventBus })(
    ({ eventBus }) =>
        function cycleAutomationVisibility(): void {
            eventBus.emit('panel.showAutomation', undefined);
        }
);

export const onZoomToFit = inject({ eventBus })(
    ({ eventBus }) =>
        function onZoomToFit(handler: () => void): () => void {
            return eventBus.on('zoom.toFit', handler);
        }
);

export const onZoomToSelection = inject({ eventBus })(
    ({ eventBus }) =>
        function onZoomToSelection(handler: (payload: ZoomToSelectionPayload) => void): () => void {
            return eventBus.on('zoom.toSelection', handler);
        }
);

export const onScrollToPlayhead = inject({ eventBus })(
    ({ eventBus }) =>
        function onScrollToPlayhead(handler: () => void): () => void {
            return eventBus.on('zoom.scrollToPlayhead', handler);
        }
);
