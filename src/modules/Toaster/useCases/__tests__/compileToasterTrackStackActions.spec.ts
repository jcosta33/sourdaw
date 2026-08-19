import { describe, expect, it, vi } from 'vitest';

import { compileToasterTrackStackActions } from '../compileToasterTrackStackActions';

const arrangementMocks = vi.hoisted(() => ({
    compileLoadPresetActions: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    compileLoadPresetActions: arrangementMocks.compileLoadPresetActions,
}));

describe('compileToasterTrackStackActions', () => {
    it('adds the Toaster parent, catalog device, and sixteen routed device-free pad tracks to one action batch', () => {
        arrangementMocks.compileLoadPresetActions.mockReturnValue({
            actions: [
                { type: 'addTrack', payload: { id: 'toaster-parent', name: 'Toaster Kit', kind: 'folder' } },
                { type: 'loadPreset', payload: { presetId: 'toaster-default', trackId: 'toaster-parent' } },
            ],
            deviceIds: ['toaster-device'],
            groupLabel: 'Load preset',
            trackId: 'toaster-parent',
        });

        const plan = compileToasterTrackStackActions();

        expect(plan?.groupLabel).toBe('Create Toaster Kit');
        expect(plan?.actions).toHaveLength(18);
        expect(plan?.actions[0]).toMatchObject({ type: 'addTrack', payload: { select: true } });
        expect(plan?.actions[1]).toEqual({
            type: 'loadPreset',
            payload: { presetId: 'toaster-default', trackId: 'toaster-parent' },
        });
        expect(plan?.actions.slice(2)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'addTrack',
                    payload: expect.objectContaining({
                        parentId: 'toaster-parent',
                        outputId: 'toaster-parent',
                        withoutDefaultDevice: true,
                    }),
                }),
            ])
        );
    });

    it('does not create a partial Toaster batch without the catalog parent and load actions', () => {
        arrangementMocks.compileLoadPresetActions.mockReturnValue(null);

        expect(compileToasterTrackStackActions()).toBeNull();
    });
});
