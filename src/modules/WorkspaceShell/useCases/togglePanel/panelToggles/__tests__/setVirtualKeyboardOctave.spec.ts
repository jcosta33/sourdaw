import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { setVirtualKeyboardOctave } from '../setVirtualKeyboardOctave';

describe('setVirtualKeyboardOctave', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes an in-range octave unchanged', () => {
        setVirtualKeyboardOctave(5);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ virtualKeyboardOctave: 5 });
    });

    it('clamps octaves below 0 up to 0', () => {
        setVirtualKeyboardOctave(-3);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ virtualKeyboardOctave: 0 });
    });

    it('clamps octaves above 8 down to 8', () => {
        setVirtualKeyboardOctave(12);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ virtualKeyboardOctave: 8 });
    });
});
