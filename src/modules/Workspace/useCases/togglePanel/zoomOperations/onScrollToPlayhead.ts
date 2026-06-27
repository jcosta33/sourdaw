import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

export const onScrollToPlayhead = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onScrollToPlayhead(handler: () => void): () => void {
            return eventBus.on('zoom.scrollToPlayhead', handler);
        }
);
