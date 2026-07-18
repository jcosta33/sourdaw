import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleExportDawProject } from '../handlers/handleExportDawProject';
import { handleImportDawProject } from '../handlers/handleImportDawProject';

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
