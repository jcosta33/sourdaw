import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { setSemanticContext, clearSemanticContext, getDsoSnapshotHandlers } from '#/modules/CrdtDocument/useCases';
import { pushActionHistoryEntry } from '#/modules/CrdtDocument/stores';
import { type AppAction, type ActionHandler, createUndoEntry } from './commandQueries';
import { commitUndoEntry } from './commitUndoEntry';
import { getArrangementHandlers } from '#/modules/Arrangement';
import { getTransportHandlers } from '#/modules/Transport';
import { getWorkspaceHandlers, getScratchPadHandlers } from '#/modules/Workspace';
import { getAutomationHandlers } from '#/modules/Automation';
import { getGenerationHandlers, getAiMidiHandlers } from '#/modules/AiGeneration';
import { getAnalysisHandlers } from '#/modules/AudioAnalysis';
import { getCollaborationHandlers } from '#/modules/Collaboration';
import { getPluginHostHandlers } from '#/modules/Plugin';
import { getAiOrganizationHandlers } from '#/modules/AiRuntime';
import {
    getChordTrackHandlers,
    getMidiRoutingHandlers,
    getPatternInstanceHandlers,
} from '#/modules/MIDI';
import { getSongStructureHandlers, getVersionControlHandlers } from '#/modules/Project';
import { getFinalFeatureHandlers } from '#/modules/AudioEngine';
import { getMacroHandlers } from './getMacroHandlers';
import { getUndoTreeHandlers } from './getUndoTreeHandlers';
import { recordAction } from './macro/recording/recordAction';
import { traceAppAction } from './traceAppAction';

/**
 * Built lazily so `getArrangementHandlers` is not invoked while the Arrangement
 * barrel is still initializing (e.g. `batchFeatureHandlers` imports from
 * `#/modules/Arrangement` and re-enters).
 *
 * §45.1 — Wrapped in a holder object so the module-level binding can't be
 * reassigned from outside, and mutation is localised to this file.
 */
const handlerRegistryState: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers are type-safe at definition site
    cache: Record<string, ActionHandler<any>> | null;
} = { cache: null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeHandlers(...sources: Record<string, ActionHandler<any>>[]): Record<string, ActionHandler<any>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry: Record<string, ActionHandler<any>> = {};
    for (const source of sources) {
        for (const key of Object.keys(source)) {
            if (key in registry) {
                const message = `[executeAppAction] Duplicate handler for action type: ${key}`;
                if (import.meta.env.DEV) {
                    throw new Error(message);
                }
                logger.warn(message);
            }
            registry[key] = source[key]!;
        }
    }
    return registry;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandlerRegistry(): Record<string, ActionHandler<any>> {
    if (!handlerRegistryState.cache) {
        handlerRegistryState.cache = mergeHandlers(
            getArrangementHandlers(),
            getTransportHandlers(),
            getWorkspaceHandlers(),
            getAutomationHandlers(),
            getGenerationHandlers(),
            getAnalysisHandlers(),
            getCollaborationHandlers(),
            getPluginHostHandlers(),
            getAiMidiHandlers(),
            getAiOrganizationHandlers(),
            getChordTrackHandlers(),
            getScratchPadHandlers(),
            getPatternInstanceHandlers(),
            getMidiRoutingHandlers(),
            getMacroHandlers(),
            getUndoTreeHandlers(),
            getSongStructureHandlers(),
            getVersionControlHandlers(),
            getFinalFeatureHandlers(),
            getDsoSnapshotHandlers(),
        );
    }
    return handlerRegistryState.cache;
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
        (async function executeAppAction(action: AppAction, options?: ExecuteOptions): Promise<void> {
            traceAppAction(action.type, options?.source ?? 'manual');

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
                    commitUndoEntry(entry);
                }
            }
        })
);
