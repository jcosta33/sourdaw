import { notifyUser } from '#/helpers/Notification/notifyUser';
import { searchSamples } from '#/modules/SoundLibrary';
import { createCompGroup } from './groupComping/compGroupOperations';
import {
    togglePunchRecording,
    toggleRecord,
    triggerScene,
    nextItem,
    previousItem,
    detectProjectTempo,
} from '#/modules/Transport';
import { createAdjustmentLayer } from './adjustmentLayer/createAdjustmentLayer';
import type { AdjustmentEffectType } from '../stores/adjustmentLayer';

type BatchFeatureAction =
    | { type: 'searchSamples'; payload: { query: string } }
    | { type: 'createCompGroup'; payload: { name: string; trackIds: string[] } }
    | { type: 'togglePunchRecording'; payload?: undefined }
    | { type: 'toggleLoopRecord'; payload: { slotId: string } }
    | { type: 'triggerScene'; payload: { column: number } }
    | { type: 'nextSetlistItem'; payload?: undefined }
    | { type: 'previousSetlistItem'; payload?: undefined }
    | { type: 'detectTempo'; payload?: undefined }
    | { type: 'createAdjustmentLayer'; payload: { name: string; effectType: string } };

type BatchFeatureHandlerResult = {
    label: string;
};

type BatchFeatureHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => BatchFeatureHandlerResult;
    undoable: boolean;
};

type BatchFeatureHandlers = {
    [ActionType in BatchFeatureAction['type']]: BatchFeatureHandler<Extract<BatchFeatureAction, { type: ActionType }>>;
};

export const batchFeatureHandlers: BatchFeatureHandlers = {
    searchSamples: {
        execute: async (a) => {
            searchSamples(a.payload.query);
        },
        undoable: false,
        describe: () => ({ label: 'Search Samples' }),
    },
    // TODO: Extension system frozen — runtime uses unsandboxed new Function().
    // Rebuild with Worker-based sandbox before re-exposing runScript / toggleScriptEditor.
    // See dead-code-audit.md Section 10 for full security analysis.
    createCompGroup: {
        execute: async (a) => {
            createCompGroup(a.payload.name, a.payload.trackIds);
        },
        undoable: true,
        describe: () => ({ label: 'Create Comp Group' }),
    },
    togglePunchRecording: {
        execute: async () => {
            togglePunchRecording();
            notifyUser('Punch recording toggled');
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Punch Recording' }),
    },
    toggleLoopRecord: {
        execute: async (a) => {
            toggleRecord(a.payload.slotId);
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Loop Record' }),
    },
    triggerScene: {
        execute: async (a) => {
            triggerScene(a.payload.column);
        },
        undoable: false,
        describe: () => ({ label: 'Trigger Scene' }),
    },
    nextSetlistItem: {
        execute: async () => {
            nextItem();
        },
        undoable: false,
        describe: () => ({ label: 'Next Setlist Item' }),
    },
    previousSetlistItem: {
        execute: async () => {
            previousItem();
        },
        undoable: false,
        describe: () => ({ label: 'Previous Setlist Item' }),
    },
    detectTempo: {
        execute: async () => {
            const result = detectProjectTempo();
            notifyUser(
                result.confidence > 0.5
                    ? `Detected tempo: ${result.averageBpm} BPM (${result.minBpm}–${result.maxBpm} range)`
                    : 'Could not confidently detect tempo — add more content first',
                result.confidence > 0.5 ? 'success' : 'warning'
            );
        },
        undoable: true,
        describe: () => ({ label: 'Detect Tempo' }),
    },
    createAdjustmentLayer: {
        execute: async (a) => {
            createAdjustmentLayer(a.payload.name, a.payload.effectType as AdjustmentEffectType);
        },
        undoable: true,
        describe: () => ({ label: 'Create Adjustment Layer' }),
    },
};
