import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type Macro } from '../../../models/Macro';
import { macroStore } from '../../../stores/macroStore';
import { playMacro } from '../playback';

const STORAGE_KEY = 'sourdaw:macros';

const { executeAppActionMock } = vi.hoisted(() => ({
    executeAppActionMock: vi
        .fn<typeof import('../../executeAppAction').executeAppAction>()
        .mockResolvedValue(undefined),
}));

vi.mock('../../executeAppAction', () => ({
    executeAppAction: executeAppActionMock,
}));

describe('playMacro', () => {
    const macro: Macro = {
        id: 'play-1',
        name: 'Two steps',
        actions: [{ type: 'togglePlayback' }, { type: 'toggleLoop' }],
        createdAt: 0,
    };

    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        macroStore.set({ macros: [macro], recording: false, currentRecording: [] });
        executeAppActionMock.mockClear();
    });

    afterEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it('should execute each action with a shared undo group', async () => {
        await playMacro('play-1');

        expect(executeAppActionMock).toHaveBeenCalledTimes(2);
        const [firstAction, firstOptions] = executeAppActionMock.mock.calls[0] as [
            import('#/utils/handlerContract').AppAction,
            import('#/utils/handlerContract').ExecuteOptions | undefined,
        ];
        const [secondAction, secondOptions] = executeAppActionMock.mock.calls[1] as [
            import('#/utils/handlerContract').AppAction,
            import('#/utils/handlerContract').ExecuteOptions | undefined,
        ];
        expect(firstAction).toEqual({ type: 'togglePlayback' });
        expect(secondAction).toEqual({ type: 'toggleLoop' });
        expect(firstOptions?.groupId).toBe(secondOptions?.groupId);
        expect(firstOptions?.groupLabel).toBe('Macro: Two steps');
    });

    it('should no-op when macro id is missing', async () => {
        await playMacro('missing');
        expect(executeAppActionMock).not.toHaveBeenCalled();
    });

    it('should no-op when macroStore value is null', async () => {
        macroStore.set(null);
        await playMacro('play-1');
        expect(executeAppActionMock).not.toHaveBeenCalled();
    });

    it('should regenerate adjustment IDs and remap later references without mutating the macro', async () => {
        const adjustmentMacro: Macro = {
            id: 'adjustment-1',
            name: 'Adjustment steps',
            actions: [
                {
                    type: 'createAdjustmentLayer',
                    payload: { name: 'Layer', effectType: 'volume', layerId: 'recorded-layer' },
                },
                { type: 'setLayerMix', payload: { layerId: 'recorded-layer', mix: 0.5 } },
                {
                    type: 'addAdjustmentRegion',
                    payload: {
                        layerId: 'recorded-layer',
                        startBeat: 0,
                        endBeat: 4,
                        regionId: 'recorded-region',
                    },
                },
                {
                    type: 'moveAdjustmentRegion',
                    payload: { regionId: 'recorded-region', startBeat: 4, endBeat: 8 },
                },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [adjustmentMacro], recording: false, currentRecording: [] });
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'createAdjustmentLayer') {
                action.payload.layerId = 'replayed-layer';
            }
            if (action.type === 'addAdjustmentRegion') {
                action.payload.regionId = 'replayed-region';
            }
            return Promise.resolve();
        });

        await playMacro('adjustment-1');

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'createAdjustmentLayer',
                payload: { name: 'Layer', effectType: 'volume', layerId: 'replayed-layer' },
            },
            { type: 'setLayerMix', payload: { layerId: 'replayed-layer', mix: 0.5 } },
            {
                type: 'addAdjustmentRegion',
                payload: {
                    layerId: 'replayed-layer',
                    startBeat: 0,
                    endBeat: 4,
                    regionId: 'replayed-region',
                },
            },
            {
                type: 'moveAdjustmentRegion',
                payload: { regionId: 'replayed-region', startBeat: 4, endBeat: 8 },
            },
        ]);
        expect(macroStore.value?.macros[0]?.actions).toEqual(adjustmentMacro.actions);
    });

    it('should regenerate recorded VCA IDs and remap references independently on every playback', async () => {
        const vcaMacro: Macro = {
            id: 'vca-1',
            name: 'VCA steps',
            actions: [
                {
                    type: 'createVcaGroup',
                    payload: { name: 'Drums', trackIds: ['track-1'], vcaGroupId: 'recorded-vca' },
                },
                { type: 'assignToVca', payload: { trackId: 'track-2', vcaGroupId: 'recorded-vca' } },
                { type: 'setVcaGain', payload: { vcaGroupId: 'recorded-vca', gain: 0.75 } },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [vcaMacro], recording: false, currentRecording: [] });
        let generatedId = 0;
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'createVcaGroup' && action.payload.vcaGroupId === undefined) {
                generatedId += 1;
                action.payload.vcaGroupId = `replayed-vca-${String(generatedId)}`;
            }
            return Promise.resolve();
        });

        await playMacro('vca-1');
        await playMacro('vca-1');

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'createVcaGroup',
                payload: { name: 'Drums', trackIds: ['track-1'], vcaGroupId: 'replayed-vca-1' },
            },
            { type: 'assignToVca', payload: { trackId: 'track-2', vcaGroupId: 'replayed-vca-1' } },
            { type: 'setVcaGain', payload: { vcaGroupId: 'replayed-vca-1', gain: 0.75 } },
            {
                type: 'createVcaGroup',
                payload: { name: 'Drums', trackIds: ['track-1'], vcaGroupId: 'replayed-vca-2' },
            },
            { type: 'assignToVca', payload: { trackId: 'track-2', vcaGroupId: 'replayed-vca-2' } },
            { type: 'setVcaGain', payload: { vcaGroupId: 'replayed-vca-2', gain: 0.75 } },
        ]);
        expect(macroStore.value?.macros[0]?.actions).toEqual(vcaMacro.actions);
    });
});
