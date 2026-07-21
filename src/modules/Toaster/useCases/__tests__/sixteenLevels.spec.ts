import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { updatePad } from '../../stores/toasterStore';
import { enter16Levels } from '../enter16Levels';
import { exit16Levels } from '../exit16Levels';
import { get16LevelsTarget } from '../get16LevelsTarget';
import { is16LevelsActive } from '../is16LevelsActive';
import { trigger16Level } from '../trigger16Level';
import { triggerToasterPad } from '../triggerPad';

const mockResolveDeviceTarget = vi.hoisted(() =>
    vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(() => ({ status: 'missing' }))
);

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mockResolveDeviceTarget,
}));

vi.mock('../triggerPad', () => ({
    triggerToasterPad: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: vi.fn(() => []),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getTrackStrip: vi.fn(),
}));

vi.mock('../../stores/toasterStore', () => ({
    updatePad: vi.fn(),
}));

describe('trigger16Level', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        mockResolveDeviceTarget.mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: 't1',
            deviceId,
        }));
    });

    afterEach(() => {
        exit16Levels('d1');
    });

    it('does not trigger when 16 Levels mode is inactive', () => {
        trigger16Level(0, 'd1');

        expect(triggerToasterPad).not.toHaveBeenCalled();
    });

    // Regression — sessions are keyed by deviceId, so one instance entering
    // 16-Levels must not activate it for another (previously a single global).
    it('scopes the active session to its deviceId', () => {
        enter16Levels('d1', 5);

        expect(is16LevelsActive('d1')).toBe(true);
        expect(is16LevelsActive('d2')).toBe(false);
        expect(get16LevelsTarget('d1')).toEqual({ deviceId: 'd1', padIndex: 5, target: 'velocity' });
        expect(get16LevelsTarget('d2')).toBeNull();

        // A trigger for the other device is ignored.
        trigger16Level(0, 'd2');
        expect(triggerToasterPad).not.toHaveBeenCalled();

        // A trigger for the owning device routes to its pad.
        trigger16Level(0, 'd1');
        expect(triggerToasterPad).toHaveBeenCalledWith('d1', 5, expect.any(Number));

        exit16Levels('d1');
        expect(is16LevelsActive('d1')).toBe(false);
        expect(get16LevelsTarget('d1')).toBeNull();
    });

    // Regression — Finding #48: the param was sent through the rAF-coalesced
    // setToasterPadParam then the pad was triggered synchronously, so the first
    // hit played with the previous value. The param must reach the worklet
    // synchronously, BEFORE the trigger, without waiting for a frame.
    it('triggers velocity cells directly without writing a pad param', () => {
        enter16Levels('d1', 2, 'velocity');

        trigger16Level(15, 'd1');

        expect(triggerToasterPad).toHaveBeenCalledWith('d1', 2, 127);
        expect(updatePad).not.toHaveBeenCalled();
        expect(getTrackStrip).not.toHaveBeenCalled();
    });

    it.each([
        { target: 'tune', gridIndex: 15, paramKey: 'tune', expectedValue: 24 },
        { target: 'decay', gridIndex: 7, paramKey: 'decay', expectedValue: 0.5 },
        { target: 'filter', gridIndex: 15, paramKey: 'filterCutoff', expectedValue: 20000 },
    ] as const)('sends $target to the worklet synchronously before triggering', (input) => {
        const setPadParam = vi.fn();
        vi.mocked(getAllTracks).mockReturnValue([{ id: 't1', devices: [{ id: 'd1', type: 'toaster' }] }] as never);
        vi.mocked(getTrackStrip).mockReturnValue({
            deviceNodes: [{ deviceId: 'd1', toasterControls: { ready: true, setPadParam, noteOn: vi.fn() } }],
        } as never);

        enter16Levels('d1', 2, input.target);
        trigger16Level(input.gridIndex, 'd1');

        // Param reached the worklet without any rAF tick having run.
        expect(setPadParam).toHaveBeenCalledWith(2, input.paramKey, input.expectedValue);
        // Store kept in sync too.
        expect(updatePad).toHaveBeenCalledWith('d1', 2, { [input.paramKey]: input.expectedValue });
        // And the param was sent before the note fired.
        const paramOrder = setPadParam.mock.invocationCallOrder[0]!;
        const triggerOrder = vi.mocked(triggerToasterPad).mock.invocationCallOrder[0]!;
        expect(paramOrder).toBeLessThan(triggerOrder);
    });
});
