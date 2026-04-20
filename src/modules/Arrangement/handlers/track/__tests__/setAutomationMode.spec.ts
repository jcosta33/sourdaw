import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetAutomationMode } from '../setAutomationMode';

const mocks = vi.hoisted(() => ({
    setAutomationMode: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/setAutomationMode', () => ({
    setAutomationMode: mocks.setAutomationMode,
}));

describe('handleSetAutomationMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setAutomationMode with the provided payload', () => {
        handleSetAutomationMode.execute({
            type: 'setAutomationMode',
            payload: { trackId: 't1', mode: 'write' },
        });

        expect(mocks.setAutomationMode).toHaveBeenCalledWith('t1', 'write');
    });

    it('provides a description reflecting the mode', () => {
        const desc = handleSetAutomationMode.describe({
            type: 'setAutomationMode',
            payload: { trackId: 't1', mode: 'touch' },
        });
        expect(desc.label).toBe('Set automation mode: touch');
    });

    it('is undoable', () => {
        expect(handleSetAutomationMode.undoable).toBe(true);
    });
});
