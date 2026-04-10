import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { setSemanticContext, clearSemanticContext, pushActionHistoryEntry } from '#/modules/CrdtDocument';
import { type AppAction, type ActionHandler, createUndoEntry } from './commandQueries';
import { pushUndo } from '../stores/undoStore';
import {
    getArrangementHandlers,
    saveTrackAsTemplate,
    loadTrackTemplate,
    deleteTrackTemplate,
    createVcaGroup,
    assignToVca,
    removeFromVca,
    setVcaGain,
} from '#/modules/Arrangement';
import { transportHandlers } from '#/modules/Transport';
import { workspaceHandlers, scratchPadHandlers } from '#/modules/Workspace';
import { automationHandlers } from '#/modules/Automation';
import { generationHandlers, aiMidiHandlers } from '#/modules/AiGeneration';
import { analysisHandlers } from '#/modules/AudioAnalysis';
import { collaborationHandlers } from '#/modules/Collaboration';
import { pluginHostHandlers } from '#/modules/Plugin';
import { aiOrganizationHandlers } from '#/modules/AiRuntime';
import {
    chordTrackHandlers,
    patternInstanceHandlers,
    setMidiOutput,
    clearMidiOutput,
} from '#/modules/MIDI';
import { macroHandlers } from '../useCases/macroHandlers';
import { undoTreeHandlers } from '../useCases/undoTreeHandlers';
import { songStructureHandlers, versionControlHandlers } from '#/modules/Project';
import { finalFeatureHandlers } from '#/modules/AudioEngine';
import { recordAction } from './macro/recording';
import {
    handleCreateTrackAlternative,
    handleSwitchTrackAlternative,
    handleRenameTrackAlternative,
    handleDeleteTrackAlternative,
} from './trackAlternativeHandlers';

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

const dsoSnapshotHandlers: Record<string, ActionHandler<any>> = {
    restoreDsoSnapshot: {
        execute: async (action) => {
            const { restoreSnapshot } = await import('#/modules/CrdtDocument');
            restoreSnapshot(action.payload.bundle);
        },
        undoable: false,
        describe: () => ({ label: 'Restore DSO Snapshot' }),
    },
};

/** Built lazily so `getArrangementHandlers` is not invoked while the Arrangement barrel is still
 *  initializing (e.g. `batchFeatureHandlers` imports from `#/modules/Arrangement` and re-enters). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers are type-safe at definition site; the registry erases the action subtype for dynamic dispatch
let handlerRegistryCache: Record<string, ActionHandler<any>> | null = null;

function getHandlerRegistry(): Record<string, ActionHandler<any>> {
    if (!handlerRegistryCache) {
        handlerRegistryCache = {
            ...getArrangementHandlers(),
            ...transportHandlers,
            ...workspaceHandlers,
            ...automationHandlers,
            ...generationHandlers,
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
            ...finalFeatureHandlers,
            ...dsoSnapshotHandlers,
        };
    }
    return handlerRegistryCache;
}

export type ExecuteOptions = {
    groupId?: string;
    groupLabel?: string;
    source?: 'manual' | 'prompt' | 'voice' | 'ai';
    /** When true, skip pushing an undo entry and action history entry.
     *  Use this when the caller manages batch undo externally (e.g. executeDsoEdit). */
    skipUndo?: boolean;
};

export const executeAppAction = inject({ logger })(
    ({ logger }) =>
        async function executeAppAction(action: AppAction, options?: ExecuteOptions): Promise<void> {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = getHandlerRegistry()[action.type] as ActionHandler<any> | undefined;
            if (!handler) {
                logger.error(new Error(`No handler registered for action: ${action.type}`));
                return;
            }

            // Capture undo info BEFORE executing — this lets describe() snapshot current
            // state for destructive actions like removeTrack / removeClip.
            let undoResult: { label: string; inverseAction?: AppAction | null } | null = null;
            if (handler.undoable) {
                undoResult = handler.describe(action);
            }

            // Set semantic context so AutomergeStorage attaches a message to the CRDT change.
            // This makes `Automerge.getHistory()` return readable change descriptions.
            const label = undoResult?.label ?? action.type;
            setSemanticContext({
                message: label,
                actionKind: action.type,
                entityRefs: [],
            });

            try {
                await handler.execute(action);
            } finally {
                clearSemanticContext();
            }

            // Record to macro playback
            recordAction(action);

            if (!options?.skipUndo) {
                // Record undoable actions to global history (skip UI-only actions like panel toggles)
                if (handler.undoable) {
                    pushActionHistoryEntry({
                        id: crypto.randomUUID(),
                        label,
                        actionKind: action.type,
                        action,
                        inverseAction: undoResult?.inverseAction ?? null,
                        source: options?.source ?? 'manual',
                        timestamp: Date.now(),
                        groupId: options?.groupId,
                        groupLabel: options?.groupLabel,
                        reverted: false,
                    });
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
        }
);
