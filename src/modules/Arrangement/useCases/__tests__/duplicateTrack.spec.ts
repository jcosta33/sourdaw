import { describe, it, expect, vi, beforeEach } from 'vitest';

import { duplicateTrack } from '../duplicateTrack';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
    addTrack: vi.fn(),
}));

vi.mock('../repositories/track/getTrackById', () => ({ getTrackById: mocks.getTrackById }));
vi.mock('../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../addTrack', () => ({ addTrack: mocks.addTrack }));
vi.mock('#/modules/MIDI/stores', () => ({ midiStore: { value: null, set: vi.fn() } }));
vi.mock('#/modules/Automation/useCases', () => ({ duplicateClipAutomation: vi.fn() }));

describe('duplicateTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does nothing when track not found', () => {
        mocks.getTrackById.mockReturnValue(null);
        duplicateTrack('nonexistent');
        expect(mocks.addTrack).not.toHaveBeenCalled();
    });

    it('creates a new track when source exists', () => {
        mocks.getTrackById.mockReturnValue({
            id: 't1',
            name: 'Synth',
            kind: 'midi',
            alternatives: [{ id: 'a1', clips: [] }],
            clips: [],
        });
        expect(() => duplicateTrack('t1')).not.toThrow();
    });

    it('handles track with MIDI clips', () => {
        mocks.getTrackById.mockReturnValue({
            id: 't1',
            name: 'MIDI',
            kind: 'midi',
            alternatives: [{ id: 'a1', clips: [{ id: 'c1', type: 'midi', startBeat: 0, endBeat: 4 }] }],
            clips: [],
        });
        expect(() => duplicateTrack('t1')).not.toThrow();
    });

    it('handles track with audio clips', () => {
        mocks.getTrackById.mockReturnValue({
            id: 't1',
            name: 'Audio',
            kind: 'audio',
            alternatives: [{ id: 'a1', clips: [{ id: 'c1', type: 'audio', startBeat: 0, endBeat: 4 }] }],
            clips: [],
        });
        expect(() => duplicateTrack('t1')).not.toThrow();
    });

    it('handles track with no alternatives', () => {
        mocks.getTrackById.mockReturnValue({
            id: 't1',
            name: 'Empty',
            kind: 'midi',
            alternatives: [],
            clips: [],
        });
        expect(() => duplicateTrack('t1')).not.toThrow();
    });
});
