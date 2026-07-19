import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleApplyGroove } from '../handlers/groove/handleApplyGroove';
import { handleAssignGrooveTemplate } from '../handlers/groove/handleAssignGrooveTemplate';
import { handleCreateGrooveTemplate } from '../handlers/groove/handleCreateGrooveTemplate';
import { handleDeleteGrooveTemplate } from '../handlers/groove/handleDeleteGrooveTemplate';
import { handleExtractGroove } from '../handlers/groove/handleExtractGroove';
import { handleRenameGrooveTemplate } from '../handlers/groove/handleRenameGrooveTemplate';
import { handleRestoreDeletedGrooveTemplate } from '../handlers/groove/handleRestoreDeletedGrooveTemplate';
import { handleRestoreGrooveAssignment } from '../handlers/groove/handleRestoreGrooveAssignment';

type MidiGrooveAction =
    | Extract<AppAction, { type: 'createGrooveTemplate' }>
    | Extract<AppAction, { type: 'renameGrooveTemplate' }>
    | Extract<AppAction, { type: 'deleteGrooveTemplate' }>
    | Extract<AppAction, { type: 'restoreDeletedGrooveTemplate' }>
    | Extract<AppAction, { type: 'assignGrooveTemplate' }>
    | Extract<AppAction, { type: 'restoreGrooveAssignment' }>
    | Extract<AppAction, { type: 'extractGroove' }>
    | Extract<AppAction, { type: 'applyGroove' }>;

type MidiGrooveHandlersMap = {
    [Action in MidiGrooveAction as Action['type']]: ActionHandler<Action>;
};

export function getMidiGrooveHandlers(): MidiGrooveHandlersMap {
    return {
        createGrooveTemplate: handleCreateGrooveTemplate,
        renameGrooveTemplate: handleRenameGrooveTemplate,
        deleteGrooveTemplate: handleDeleteGrooveTemplate,
        restoreDeletedGrooveTemplate: handleRestoreDeletedGrooveTemplate,
        assignGrooveTemplate: handleAssignGrooveTemplate,
        restoreGrooveAssignment: handleRestoreGrooveAssignment,
        extractGroove: handleExtractGroove,
        applyGroove: handleApplyGroove,
    };
}
