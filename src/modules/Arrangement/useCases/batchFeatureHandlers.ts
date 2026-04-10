import { inject } from '#/infra/di/inject';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { type ActionHandler } from '#/modules/Command';
import { createAdjustmentLayer } from './adjustmentLayer/createAdjustmentLayer';
import { createCompGroup } from './groupComping/compGroupOperations';
import { type AdjustmentEffectType } from '../stores/adjustmentLayer';
import { searchSamples } from '#/modules/SoundLibrary';
import {
    detectProjectTempo,
    nextItem,
    previousItem,
    togglePunchRecording,
    toggleRecord,
    triggerScene,
} from '#/modules/Transport';

export const executeSearchSamples = inject({ searchSamples })(
    ({ searchSamples }) =>
        async function executeSearchSamples(a: { payload: { query: string } }): Promise<void> {
            searchSamples(a.payload.query);
        }
);

export const executeCreateCompGroup = inject({ createCompGroup })(
    ({ createCompGroup }) =>
        async function executeCreateCompGroup(a: { payload: { name: string; trackIds: string[] } }): Promise<void> {
            createCompGroup(a.payload.name, a.payload.trackIds);
        }
);

export const executeTogglePunchRecordingBatch = inject({ togglePunchRecording, notifyUser })(
    ({ togglePunchRecording, notifyUser }) =>
        async function executeTogglePunchRecordingBatch(): Promise<void> {
            togglePunchRecording();
            notifyUser('Punch recording toggled');
        }
);

export const executeToggleLoopRecord = inject({ toggleRecord })(
    ({ toggleRecord }) =>
        async function executeToggleLoopRecord(a: { payload: { slotId: string } }): Promise<void> {
            toggleRecord(a.payload.slotId);
        }
);

export const executeTriggerSceneBatch = inject({ triggerScene })(
    ({ triggerScene }) =>
        async function executeTriggerSceneBatch(a: { payload: { column: number } }): Promise<void> {
            triggerScene(a.payload.column);
        }
);

export const executeNextSetlistItem = inject({ nextItem })(
    ({ nextItem }) =>
        async function executeNextSetlistItem(): Promise<void> {
            nextItem();
        }
);

export const executePreviousSetlistItem = inject({ previousItem })(
    ({ previousItem }) =>
        async function executePreviousSetlistItem(): Promise<void> {
            previousItem();
        }
);

export const executeDetectTempo = inject({ detectProjectTempo, notifyUser })(
    ({ detectProjectTempo, notifyUser }) =>
        async function executeDetectTempo(): Promise<void> {
            const result = detectProjectTempo();
            notifyUser(
                result.confidence > 0.5
                    ? `Detected tempo: ${result.averageBpm} BPM (${result.minBpm}–${result.maxBpm} range)`
                    : 'Could not confidently detect tempo — add more content first',
                result.confidence > 0.5 ? 'success' : 'warning'
            );
        }
);

export const executeCreateAdjustmentLayerBatch = inject({ createAdjustmentLayer })(
    ({ createAdjustmentLayer }) =>
        async function executeCreateAdjustmentLayerBatch(a: {
            payload: { name: string; effectType: string };
        }): Promise<void> {
            createAdjustmentLayer(a.payload.name, a.payload.effectType as AdjustmentEffectType);
        }
);

export const batchFeatureHandlers: Record<string, ActionHandler<any>> = {
    searchSamples: {
        execute: executeSearchSamples,
        undoable: false,
        describe: () => ({ label: 'Search Samples' }),
    },
    // TODO: Extension system frozen — runtime uses unsandboxed new Function().
    // Rebuild with Worker-based sandbox before re-exposing runScript / toggleScriptEditor.
    // See dead-code-audit.md Section 10 for full security analysis.
    createCompGroup: {
        execute: executeCreateCompGroup,
        undoable: true,
        describe: () => ({ label: 'Create Comp Group' }),
    },
    togglePunchRecording: {
        execute: executeTogglePunchRecordingBatch,
        undoable: false,
        describe: () => ({ label: 'Toggle Punch Recording' }),
    },
    toggleLoopRecord: {
        execute: executeToggleLoopRecord,
        undoable: false,
        describe: () => ({ label: 'Toggle Loop Record' }),
    },
    triggerScene: {
        execute: executeTriggerSceneBatch,
        undoable: false,
        describe: () => ({ label: 'Trigger Scene' }),
    },
    nextSetlistItem: {
        execute: executeNextSetlistItem,
        undoable: false,
        describe: () => ({ label: 'Next Setlist Item' }),
    },
    previousSetlistItem: {
        execute: executePreviousSetlistItem,
        undoable: false,
        describe: () => ({ label: 'Previous Setlist Item' }),
    },
    detectTempo: {
        execute: executeDetectTempo,
        undoable: true,
        describe: () => ({ label: 'Detect Tempo' }),
    },
    createAdjustmentLayer: {
        execute: executeCreateAdjustmentLayerBatch,
        undoable: true,
        describe: () => ({ label: 'Create Adjustment Layer' }),
    },
};
