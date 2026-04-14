import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setAutomationMode } from '../setAutomationMode';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('setAutomationMode', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should call updateTrack with a patch that sets automationMode', () => {
        setAutomationMode('t1', 'write');

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: {
            automationMode: 'read' | 'write';
            id: string;
        }) => { automationMode: 'read' | 'write'; id: string };
        expect(patch({ automationMode: 'read', id: 't1' })).toEqual({ automationMode: 'write', id: 't1' });
    });
});
