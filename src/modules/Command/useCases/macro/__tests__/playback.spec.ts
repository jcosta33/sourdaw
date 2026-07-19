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

    it('remaps dependent adjustment identities and strips recorded mutation provenance', async () => {
        macroStore.set({
            macros: [
                {
                    id: 'adjustment-chain',
                    name: 'Adjustment chain',
                    actions: [
                        {
                            type: 'createAdjustmentLayer',
                            payload: {
                                name: 'Layer',
                                effectType: 'volume',
                                layerId: 'recorded-layer',
                                adjustmentMutationId: 'recorded-create',
                            },
                        },
                        {
                            type: 'addAdjustmentRegion',
                            payload: {
                                layerId: 'recorded-layer',
                                regionId: 'recorded-region',
                                startBeat: 0,
                                endBeat: 4,
                                adjustmentMutationId: 'recorded-add',
                            },
                        },
                        {
                            type: 'moveAdjustmentRegion',
                            payload: {
                                regionId: 'recorded-region',
                                startBeat: 2,
                                endBeat: 6,
                                adjustmentMutationId: 'recorded-move',
                            },
                        },
                    ],
                    createdAt: 0,
                },
            ],
            recording: false,
            currentRecording: [],
        });

        await playMacro('adjustment-chain');

        const create_action = executeAppActionMock.mock.calls[0]?.[0];
        const add_action = executeAppActionMock.mock.calls[1]?.[0];
        const move_action = executeAppActionMock.mock.calls[2]?.[0];
        expect(create_action?.type).toBe('createAdjustmentLayer');
        expect(add_action?.type).toBe('addAdjustmentRegion');
        expect(move_action?.type).toBe('moveAdjustmentRegion');
        if (
            create_action?.type !== 'createAdjustmentLayer' ||
            add_action?.type !== 'addAdjustmentRegion' ||
            move_action?.type !== 'moveAdjustmentRegion'
        ) {
            throw new Error('Expected adjustment replay actions');
        }
        expect(create_action.payload.layerId).not.toBe('recorded-layer');
        expect(add_action.payload.layerId).toBe(create_action.payload.layerId);
        expect(add_action.payload.regionId).not.toBe('recorded-region');
        expect(move_action.payload.regionId).toBe(add_action.payload.regionId);
        expect(create_action.payload.adjustmentMutationId).toBeUndefined();
        expect(add_action.payload.adjustmentMutationId).toBeUndefined();
        expect(move_action.payload.adjustmentMutationId).toBeUndefined();
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
});
