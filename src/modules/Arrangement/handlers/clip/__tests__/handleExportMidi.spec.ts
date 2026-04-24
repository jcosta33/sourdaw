import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    exportMidiClip: vi.fn(),
}));

vi.mock('../../../useCases/exportMidiClip', () => ({
    exportMidiClip: mocks.exportMidiClip,
}));

import { handleExportMidi } from '../handleExportMidi';

describe('handleExportMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate to exportMidiClip with the provided clip id', () => {
        handleExportMidi.execute({ type: 'exportMidi', payload: { clipId: 'clip1' } });

        expect(mocks.exportMidiClip).toHaveBeenCalledWith('clip1');
    });

    it('should describe the action as a non-undoable export', () => {
        expect(handleExportMidi.describe({ type: 'exportMidi', payload: { clipId: 'clip1' } })).toEqual({
            label: 'Export MIDI',
        });
        expect(handleExportMidi.undoable).toBe(false);
    });
});
