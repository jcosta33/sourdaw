import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type AppAction } from '../models/AppAction';
import { getCollaborationStoreValue } from '#/modules/Collaboration/useCases/collaborationQueries';
import { broadcastAction } from '#/modules/Collaboration/useCases/collaboration';

const logger = Container.getInstance().get(Logger);
import { type ActionHandler } from '../models/ActionHandler';
import { createUndoEntry } from '../models/UndoEntry';
import { pushUndo } from '../stores/undoStore';
import { trackHandlers } from '#/modules/Arrangement/useCases/trackHandlers';
import { clipHandlers } from '#/modules/Arrangement/useCases/clipHandlers';
import { transportHandlers } from '#/modules/Transport/useCases/transportHandlers';
import { deviceHandlers } from '#/modules/Arrangement/useCases/deviceHandlers';
import { workspaceHandlers } from '#/modules/Workspace/useCases/workspaceHandlers';
import { automationHandlers } from '#/modules/Automation/useCases/automationHandlers';
import { presetHandlers } from '#/modules/Arrangement/useCases/presetHandlers';
import { generationHandlers } from '#/modules/AiGeneration/useCases/generationHandlers';
import { stretchHandlers } from '#/modules/Arrangement/useCases/stretchHandlers';
import { analysisHandlers } from '#/modules/AudioAnalysis/useCases/analysisHandlers';
import { collaborationHandlers } from '#/modules/Collaboration/useCases/collaborationHandlers';
import { pluginHostHandlers } from '#/modules/Plugin/useCases/pluginHostHandlers';
import { aiMidiHandlers } from '#/modules/AiGeneration/useCases/aiMidiHandlers';
import { aiOrganizationHandlers } from '#/modules/AiRuntime/useCases/aiOrganizationHandlers';
import { chordTrackHandlers } from '#/modules/MIDI/useCases/chordTrackHandlers';
import { scratchPadHandlers } from '#/modules/Workspace/useCases/scratchPadHandlers';
import { patternInstanceHandlers } from '#/modules/MIDI/useCases/patternInstanceHandlers';
import { macroHandlers } from '../useCases/macroHandlers';
import { undoTreeHandlers } from '../useCases/undoTreeHandlers';
import { songStructureHandlers } from '#/modules/Project/useCases/songStructureHandlers';
import { versionControlHandlers } from '#/modules/Project/useCases/versionControlHandlers';
import { newFeatureHandlers } from '#/modules/Arrangement/useCases/newFeatureHandlers';
import { batchFeatureHandlers } from '#/modules/Arrangement/useCases/batchFeatureHandlers';
import { finalFeatureHandlers } from '#/modules/AudioEngine/useCases/finalFeatureHandlers';
import { recordAction } from './macro';
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
} from '#/modules/Arrangement/useCases/trackTemplate';
import { createVcaGroup, assignToVca, removeFromVca, setVcaGain } from '#/modules/Arrangement/useCases/vca';
import { setMidiOutput, clearMidiOutput } from '#/modules/MIDI/useCases/midiRouting';

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
    ...chordTrackHandlers,
    ...scratchPadHandlers,
    ...patternInstanceHandlers,
    ...macroHandlers,
    ...undoTreeHandlers,
    ...songStructureHandlers,
    ...versionControlHandlers,
    ...newFeatureHandlers,
    ...batchFeatureHandlers,
    ...finalFeatureHandlers,
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

    // Hook: record action for macro playback
    recordAction(action);

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
