import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';

import { handleExportDawProject } from '../handlers/dawProject/handleExportDawProject';
import { handleImportDawProject } from '../handlers/dawProject/handleImportDawProject';

type DawProjectAppAction = Extract<AppAction, { type: 'importDawProject' | 'exportDawProject' }>;

export type DawProjectHandlersMap = {
    [Action in DawProjectAppAction as Action['type']]: ActionHandler<Action>;
};

export function getDawProjectHandlers(): DawProjectHandlersMap {
    return {
        importDawProject: handleImportDawProject,
        exportDawProject: handleExportDawProject,
    };
}
