import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { searchSamples } from '#/modules/SoundLibrary/useCases/sampleDatabase/searchSamples';
import { createCompGroup } from '#/modules/Arrangement/useCases/groupComping/compGroupOperations';
import { togglePunchRecording } from '#/modules/Transport/useCases/punchRecording/togglePunchRecording';
import { toggleRecord } from '#/modules/Transport/useCases/loopStation/toggleRecord';
import { triggerScene } from '#/modules/Transport/useCases/loopStation/triggerScene';
import { nextItem } from '#/modules/Transport/useCases/setlist/nextItem';
import { previousItem } from '#/modules/Transport/useCases/setlist/previousItem';
import { detectProjectTempo } from '#/modules/Transport/useCases/tempoMapping/operations';
import { createAdjustmentLayer } from '#/modules/Arrangement/useCases/adjustmentLayer/createAdjustmentLayer';
import type { AdjustmentEffectType } from '#/modules/Arrangement/stores/adjustmentLayer';

export const batchFeatureHandlers: Record<string, ActionHandler<any>> = {
    searchSamples: {
        execute: async (a: { payload: { query: string } }) => {
            searchSamples(a.payload.query);
        },
        undoable: false,
        describe: () => ({ label: 'Search Samples' }),
    },
    // TODO: Extension system frozen — runtime uses unsandboxed new Function().
    // Rebuild with Worker-based sandbox before re-exposing runScript / toggleScriptEditor.
    // See dead-code-audit.md Section 10 for full security analysis.
    createCompGroup: {
        execute: async (a: { payload: { name: string; trackIds: string[] } }) => {
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
        execute: async (a: { payload: { slotId: string } }) => {
            toggleRecord(a.payload.slotId);
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Loop Record' }),
    },
    triggerScene: {
        execute: async (a: { payload: { column: number } }) => {
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
        execute: async (a: { payload: { name: string; effectType: string } }) => {
            createAdjustmentLayer(a.payload.name, a.payload.effectType as AdjustmentEffectType);
        },
        undoable: true,
        describe: () => ({ label: 'Create Adjustment Layer' }),
    },
};
