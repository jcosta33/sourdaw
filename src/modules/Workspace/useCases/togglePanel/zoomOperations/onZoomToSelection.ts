import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

import { type ZoomToSelectionPayload } from '../../../events/WorkspaceEvents';

export const onZoomToSelection = inject({ eventBus })(
    ({ eventBus }) =>
        function onZoomToSelection(handler: (payload: ZoomToSelectionPayload) => void): () => void {
            return eventBus.on('zoom.toSelection', handler);
        }
);
