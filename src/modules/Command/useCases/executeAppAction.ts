import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type AppAction } from '../models/AppAction';
import { getCollaborationStoreValue } from '#/modules/Collaboration/useCases/collaborationQueries';
import { broadcastAction } from '#/modules/Collaboration/useCases/collaborationUseCases';

const logger = Container.getInstance().get(Logger);
import { type ActionHandler } from '../models/ActionHandler';
import { createUndoEntry } from '../models/UndoEntry';
import { pushUndo } from '../stores/undoStore';
import { trackHandlers } from '../handlers/trackHandlers';
import { clipHandlers } from '../handlers/clipHandlers';
import { transportHandlers } from '../handlers/transportHandlers';
import { deviceHandlers } from '../handlers/deviceHandlers';
import { workspaceHandlers } from '../handlers/workspaceHandlers';
import { automationHandlers } from '../handlers/automationHandlers';
import { presetHandlers } from '../handlers/presetHandlers';
import { generationHandlers } from '../handlers/generationHandlers';
import { stretchHandlers } from '../handlers/stretchHandlers';
import { analysisHandlers } from '../handlers/analysisHandlers';
import { collaborationHandlers } from '../handlers/collaborationHandlers';
import { pluginHostHandlers } from '../handlers/pluginHostHandlers';
import { aiMidiHandlers } from '../handlers/aiMidiHandlers';
import { aiOrganizationHandlers } from '../handlers/aiOrganizationHandlers';
import {
    handleCreateTrackAlternative,
    handleSwitchTrackAlternative,
    handleRenameTrackAlternative,
    handleDeleteTrackAlternative,
} from './trackAlternativeHandlers';
import {
    saveTrackAsTemplate,
    loadTrackTemplate,
    deleteTrackTemplate,
} from '#/modules/Track/useCases/trackTemplateUseCases';
import { createVcaGroup, assignToVca, removeFromVca, setVcaGain } from '#/modules/Track/useCases/vcaUseCases';
import { setMidiOutput, clearMidiOutput } from '#/modules/Track/useCases/midiRoutingUseCases';

const trackAlternativeHandlers: Record<string, ActionHandler<any>> = {
    createTrackAlternative: {
        execute: async (a) => handleCreateTrackAlternative(a),
        undoable: true,
        describe: () => ({ label: 'Create Alternative' }),
    },
    switchTrackAlternative: {
        execute: async (a) => handleSwitchTrackAlternative(a),
        undoable: true,
        describe: () => ({ label: 'Switch Alternative' }),
    },
    renameTrackAlternative: {
        execute: async (a) => handleRenameTrackAlternative(a),
        undoable: true,
        describe: () => ({ label: 'Rename Alternative' }),
    },
    deleteTrackAlternative: {
        execute: async (a) => handleDeleteTrackAlternative(a),
        undoable: true,
        describe: () => ({ label: 'Delete Alternative' }),
    },
};

const templateHandlers: Record<string, ActionHandler<any>> = {
    saveTrackTemplate: {
        execute: async (a) => {
            saveTrackAsTemplate(a.payload.trackId, a.payload.name, a.payload.category);
        },
        undoable: false,
        describe: () => ({ label: 'Save Track Template' }),
    },
    loadTrackTemplate: {
        execute: async (a) => {
            loadTrackTemplate(a.payload.templateId);
        },
        undoable: true,
        describe: () => ({ label: 'Load Track Template' }),
    },
    deleteTrackTemplate: {
        execute: async (a) => {
            deleteTrackTemplate(a.payload.templateId);
        },
        undoable: false,
        describe: () => ({ label: 'Delete Track Template' }),
    },
};

const vcaHandlers: Record<string, ActionHandler<any>> = {
    createVcaGroup: {
        execute: async (a) => {
            createVcaGroup(a.payload.name, a.payload.trackIds);
        },
        undoable: true,
        describe: () => ({ label: 'Create VCA Group' }),
    },
    assignToVca: {
        execute: async (a) => {
            assignToVca(a.payload.trackId, a.payload.vcaGroupId);
        },
        undoable: true,
        describe: () => ({ label: 'Assign to VCA' }),
    },
    removeFromVca: {
        execute: async (a) => {
            removeFromVca(a.payload.trackId);
        },
        undoable: true,
        describe: () => ({ label: 'Remove from VCA' }),
    },
    setVcaGain: {
        execute: async (a) => {
            setVcaGain(a.payload.vcaGroupId, a.payload.gain);
        },
        undoable: true,
        describe: () => ({ label: 'Set VCA Gain' }),
    },
};

const midiRoutingHandlers: Record<string, ActionHandler<any>> = {
    setMidiOutput: {
        execute: async (a) => {
            setMidiOutput(a.payload.trackId, a.payload.destinationTrackId);
        },
        undoable: true,
        describe: () => ({ label: 'Set MIDI Output' }),
    },
    clearMidiOutput: {
        execute: async (a) => {
            clearMidiOutput(a.payload.trackId);
        },
        undoable: true,
        describe: () => ({ label: 'Clear MIDI Output' }),
    },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers are type-safe at definition site; the registry erases the action subtype for dynamic dispatch
const handlerRegistry: Record<string, ActionHandler<any>> = {
    ...trackHandlers,
    ...clipHandlers,
    ...transportHandlers,
    ...deviceHandlers,
    ...workspaceHandlers,
    ...automationHandlers,
    ...presetHandlers,
    ...generationHandlers,
    ...stretchHandlers,
    ...analysisHandlers,
    ...collaborationHandlers,
    ...pluginHostHandlers,
    ...aiMidiHandlers,
    ...trackAlternativeHandlers,
    ...templateHandlers,
    ...vcaHandlers,
    ...midiRoutingHandlers,
    ...aiOrganizationHandlers,
};

export type ExecuteOptions = {
    groupId?: string;
    groupLabel?: string;
    source?: 'manual' | 'prompt' | 'voice' | 'ai';
};

export async function executeAppAction(action: AppAction, options?: ExecuteOptions): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = handlerRegistry[action.type] as ActionHandler<any> | undefined;
    if (!handler) {
        logger.warn(`No handler registered for action: ${action.type}`);
        return;
    }

    // Capture undo info BEFORE executing — this lets describe() snapshot current
    // state for destructive actions like removeTrack / removeClip.
    let undoResult: { label: string; inverseAction?: AppAction | null } | null = null;
    if (handler.undoable) {
        undoResult = handler.describe(action);
    }

    await handler.execute(action);

    if (getCollaborationStoreValue()?.sessionId) {
        broadcastAction(action);
    }

    if (undoResult) {
        const entry = createUndoEntry(
            undoResult.label,
            action,
            undoResult.inverseAction ?? null,
            options?.source ?? 'manual'
        );
        if (options?.groupId) {
            entry.groupId = options.groupId;
            entry.groupLabel = options.groupLabel;
        }
        pushUndo(entry);
    }
}

