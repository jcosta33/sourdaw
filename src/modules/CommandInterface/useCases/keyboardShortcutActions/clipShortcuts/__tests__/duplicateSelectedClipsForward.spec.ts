import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTrackStore, mockAddClip, mockRemoveClip, mockDuplicateClipAutomation, mockPushUndoEntry } = vi.hoisted(
    () => ({
        mockTrackStore: {
            value: {
                tracks: [
                    {
                        id: 't1',
                        name: 'Track 1',
                        clips: [
                            {
                                id: 'c1',
                                name: 'Clip A',
                                startBeat: 0,
                                endBeat: 4,
                                type: 'audio',
                                audioBufferId: 'buf-1',
                            },
                            {
                                id: 'c2',
                                name: 'Clip B',
                                startBeat: 8,
                                endBeat: 12,
                                type: 'midi',
                            },
                        ],
                    },
                ],
            },
        },
        mockAddClip: vi.fn(() => ({ id: 'new-clip' })),
        mockRemoveClip: vi.fn(),
        mockDuplicateClipAutomation: vi.fn(),
        mockPushUndoEntry: vi.fn(),
    })
);

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mockTrackStore }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: mockAddClip,
    removeClip: mockRemoveClip,
}));
vi.mock('#/modules/Automation/useCases', () => ({ duplicateClipAutomation: mockDuplicateClipAutomation }));
vi.mock('#/modules/Command/useCases', () => ({ pushUndoEntry: mockPushUndoEntry }));

import { duplicateSelectedClipsForward } from '../duplicateSelectedClipsForward';

describe('duplicateSelectedClipsForward', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does nothing when no clips are selected', () => {
        duplicateSelectedClipsForward([]);
        expect(mockAddClip).not.toHaveBeenCalled();
        expect(mockPushUndoEntry).not.toHaveBeenCalled();
    });

    it('does nothing when the store has no value', () => {
        const original = mockTrackStore.value;
        (mockTrackStore as { value: unknown }).value = null;
        duplicateSelectedClipsForward(['c1']);
        mockTrackStore.value = original;
        expect(mockAddClip).not.toHaveBeenCalled();
    });

    it('duplicates a single clip forward by its own span', () => {
        duplicateSelectedClipsForward(['c1']);
        // span = 4 - 0 = 4; new clip at beat 4-8
        expect(mockAddClip).toHaveBeenCalledExactlyOnceWith({
            trackId: 't1',
            startBeat: 4,
            endBeat: 8,
            name: 'Clip A (copy)',
            type: 'audio',
            audioBufferId: 'buf-1',
        });
        expect(mockDuplicateClipAutomation).toHaveBeenCalledWith('c1', 'new-clip');
    });

    it('duplicates multiple clips forward by the selection span', () => {
        duplicateSelectedClipsForward(['c1', 'c2']);
        // earliestStart = 0, latestEnd = 12, span = 12
        // c1 → 12-16, c2 → 20-24
        expect(mockAddClip).toHaveBeenCalledTimes(2);
        const calls = mockAddClip.mock.calls as Array<Array<Record<string, unknown>>>;
        const firstCall = calls[0]?.[0];
        const secondCall = calls[1]?.[0];
        expect(firstCall).toMatchObject({ startBeat: 12, endBeat: 16, name: 'Clip A (copy)' });
        expect(secondCall).toMatchObject({ startBeat: 20, endBeat: 24, name: 'Clip B (copy)' });
    });

    it('pushes an undo entry with the correct label', () => {
        duplicateSelectedClipsForward(['c1']);
        expect(mockPushUndoEntry).toHaveBeenCalledTimes(1);
        const label = mockPushUndoEntry.mock.calls[0]?.[0];
        expect(label).toBe('Duplicate 1 clip forward');
    });

    it('uses plural label when duplicating multiple clips', () => {
        duplicateSelectedClipsForward(['c1', 'c2']);
        const label = mockPushUndoEntry.mock.calls[0]?.[0];
        expect(label).toBe('Duplicate 2 clips forward');
    });

    it('registers undo and redo closures that call removeClip and addClip respectively', () => {
        duplicateSelectedClipsForward(['c1']);
        const undoFn = mockPushUndoEntry.mock.calls[0]?.[1];
        const redoFn = mockPushUndoEntry.mock.calls[0]?.[2];
        // Undo removes the created clips
        undoFn();
        expect(mockRemoveClip).toHaveBeenCalledWith('new-clip');
        // Redo creates new clips with the same offsets
        vi.clearAllMocks();
        redoFn();
        expect(mockAddClip).toHaveBeenCalledExactlyOnceWith({
            trackId: 't1',
            startBeat: 4,
            endBeat: 8,
            name: 'Clip A (copy)',
            type: 'audio',
            audioBufferId: 'buf-1',
        });
    });

    it('does nothing when selected clip ids do not match any clips in the store', () => {
        duplicateSelectedClipsForward(['nonexistent']);
        expect(mockAddClip).not.toHaveBeenCalled();
        expect(mockPushUndoEntry).not.toHaveBeenCalled();
    });
});
