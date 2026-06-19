import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { updatePad } from '../../stores/toasterStore';
import { enter16Levels, exit16Levels, is16LevelsActive, trigger16Level } from '../sixteenLevels';
import { triggerToasterPad } from '../triggerPad';

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

        // A trigger for the other device is ignored.
        trigger16Level(0, 'd2');
        expect(triggerToasterPad).not.toHaveBeenCalled();

        // A trigger for the owning device routes to its pad.
        trigger16Level(0, 'd1');
        expect(triggerToasterPad).toHaveBeenCalledWith('d1', 5, expect.any(Number));

        exit16Levels('d1');
        expect(is16LevelsActive('d1')).toBe(false);
    });

    // Regression — Finding #48: the param was sent through the rAF-coalesced
    // setToasterPadParam then the pad was triggered synchronously, so the first
    // hit played with the previous value. The param must reach the worklet
    // synchronously, BEFORE the trigger, without waiting for a frame.
    it('sends the pad param to the worklet synchronously before triggering', () => {
        const setPadParam = vi.fn();
        vi.mocked(getAllTracks).mockReturnValue([{ id: 't1', devices: [{ id: 'd1', type: 'toaster' }] }] as never);
        vi.mocked(getTrackStrip).mockReturnValue({
            deviceNodes: [{ deviceId: 'd1', toasterControls: { ready: true, setPadParam, noteOn: vi.fn() } }],
        } as never);

        enter16Levels('d1', 2, 'tune');
        trigger16Level(15, 'd1'); // gridIndex 15 -> normalized 1.0 -> tune +24

        // Param reached the worklet without any rAF tick having run.
        expect(setPadParam).toHaveBeenCalledWith(2, 'tune', 24);
        // Store kept in sync too.
        expect(updatePad).toHaveBeenCalledWith('d1', 2, { tune: 24 });
        // And the param was sent before the note fired.
        const paramOrder = setPadParam.mock.invocationCallOrder[0]!;
        const triggerOrder = vi.mocked(triggerToasterPad).mock.invocationCallOrder[0]!;
        expect(paramOrder).toBeLessThan(triggerOrder);

        exit16Levels('d1');
    });
});
