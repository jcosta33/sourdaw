import { inject } from '#/infra/di/inject';

import { type OpenPreferencesPayload } from '../../events/WorkspaceEvents';
import { WorkspaceEventBus } from '../workspaceEventBus';

type PreferencesSectionRequest = NonNullable<OpenPreferencesPayload>;

/** Not an app action: the section request stays off the command schema `openPreferencesDialog` feeds. */
export const openPreferencesSection = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function openPreferencesSection({ section }: PreferencesSectionRequest): void {
            void eventBus.emit('dialog.openPreferences', { section });
        }
);
