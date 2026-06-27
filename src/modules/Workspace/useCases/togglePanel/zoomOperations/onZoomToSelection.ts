import { inject } from '#/infra/di/inject';

import { type ZoomToSelectionPayload } from '../../../events/WorkspaceEvents';
import { WorkspaceEventBus } from '../../workspaceEventBus';

export const onZoomToSelection = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onZoomToSelection(handler: (payload: ZoomToSelectionPayload) => void): () => void {
            return eventBus.on('zoom.toSelection', handler);
        }
);
