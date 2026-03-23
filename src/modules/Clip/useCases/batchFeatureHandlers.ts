import { type ActionHandler } from '#/modules/Command/models/ActionHandler';
import { searchSamples } from '#/modules/SoundLibrary/useCases/sampleDatabaseUseCases';
import { runEditorScript, toggleScriptEditor } from '#/modules/Extension/useCases/extensionUseCases';
import { createCompGroup } from '#/modules/Clip/useCases/groupCompingUseCases';
import { togglePunchRecording } from '#/modules/Transport/useCases/punchRecordingUseCases';
import { toggleRecord, triggerScene } from '#/modules/Transport/useCases/loopStationUseCases';
import { nextItem, previousItem } from '#/modules/Transport/useCases/setlistUseCases';
import { detectProjectTempo } from '#/modules/Transport/useCases/tempoMappingUseCases';
import { createAdjustmentLayer, type AdjustmentEffectType } from '#/modules/Clip/useCases/adjustmentLayerUseCases';

export const batchFeatureHandlers: Record<string, ActionHandler<any>> = {
    searchSamples: {
        execute: async (a: { payload: { query: string } }) => {
            searchSamples(a.payload.query);
        },
        undoable: false,
        describe: () => ({ label: 'Search Samples' }),
    },
    runScript: {
        execute: async () => {
            runEditorScript();
        },
        undoable: false,
        describe: () => ({ label: 'Run Script' }),
    },
    toggleScriptEditor: {
        execute: async () => {
            toggleScriptEditor();
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Script Editor' }),
    },
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
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: { message: 'Punch recording toggled', level: 'info' },
                })
            );
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
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: {
                        message: result.confidence > 0.5
                            ? `Detected tempo: ${result.averageBpm} BPM (${result.minBpm}–${result.maxBpm} range)`
                            : 'Could not confidently detect tempo — add more content first',
                        level: result.confidence > 0.5 ? 'success' : 'warning',
                    },
                })
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
