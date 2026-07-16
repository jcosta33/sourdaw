import { inject } from '#/infra/di/inject';

import { type PromptPayload } from '../events/WorkspaceEvents';

import { WorkspaceEventBus } from './workspaceEventBus';

export const onPrompt = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onPrompt(handler: (payload: PromptPayload) => void): () => void {
            return eventBus.on('ui.prompt', handler);
        }
);
