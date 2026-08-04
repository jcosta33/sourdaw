import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../stores/chordTrackStore', () => ({
    chordTrackStore: {
        get value() {
            return mockValue;
        },
    },
    defaultChordTrackState: { enabled: false, events: [] },
}));

vi.mock('../../../useCases/chordTrack/toggleChordTrack', () => ({
    toggleChordTrack: vi.fn(),
}));

vi.mock('../handleRestoreChordTrackState', () => ({
    describeChordTrackMutation: vi.fn(() => ({
        label: 'Mock',
        inverseAction: {
            type: 'restoreChordTrackState',
            payload: { expected: { enabled: false, events: [] }, replacement: { enabled: false, events: [] } },
        },
    })),
}));

import { toggleChordTrack } from '../../../useCases/chordTrack/toggleChordTrack';
import { describeChordTrackMutation } from '../handleRestoreChordTrackState';
import { handleToggleChordTrack } from '../handleToggleChordTrack';

const mockedToggle = vi.mocked(toggleChordTrack);
const mockedDescribe = vi.mocked(describeChordTrackMutation);

let mockValue: { enabled: boolean; events: unknown[] } | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    mockValue = { enabled: false, events: [] };
});

describe('handleToggleChordTrack — execute', () => {
    it('calls toggleChordTrack with the target value (explicit)', () => {
        handleToggleChordTrack.execute({ type: 'toggleChordTrack', payload: { enabled: true } });
        expect(mockedToggle).toHaveBeenCalledWith(true);
    });

    it('toggles to opposite when no explicit payload', () => {
        mockValue = { enabled: false, events: [] };
        handleToggleChordTrack.execute({ type: 'toggleChordTrack' });
        expect(mockedToggle).toHaveBeenCalledWith(true);
    });

    it('mutates action payload to carry resolved target', () => {
        const action = { type: 'toggleChordTrack' as const, payload: undefined };
        handleToggleChordTrack.execute(action);
        expect(action.payload).toEqual({ enabled: true });
    });
});

describe('handleToggleChordTrack — describe', () => {
    it('delegates to describeChordTrackMutation with "Enable chord track" label', () => {
        handleToggleChordTrack.describe({ type: 'toggleChordTrack', payload: { enabled: true } });
        expect(mockedDescribe).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'toggleChordTrack', payload: { enabled: true } }),
            'Enable chord track'
        );
    });

    it('uses "Disable chord track" when target is false', () => {
        handleToggleChordTrack.describe({ type: 'toggleChordTrack', payload: { enabled: false } });
        expect(mockedDescribe).toHaveBeenCalledWith(expect.anything(), 'Disable chord track');
    });
});

describe('handleToggleChordTrack — isNoop', () => {
    it('returns true when store is null', () => {
        mockValue = null;
        expect(handleToggleChordTrack.isNoop!({ type: 'toggleChordTrack', payload: { enabled: true } })).toBe(true);
    });

    it('returns true when target equals current', () => {
        mockValue = { enabled: true, events: [] };
        expect(handleToggleChordTrack.isNoop!({ type: 'toggleChordTrack', payload: { enabled: true } })).toBe(true);
    });

    it('returns false when target differs from current', () => {
        mockValue = { enabled: false, events: [] };
        expect(handleToggleChordTrack.isNoop!({ type: 'toggleChordTrack', payload: { enabled: true } })).toBe(false);
    });
});
