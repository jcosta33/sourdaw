import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetClipStretchMode } from '../handleSetClipStretchMode';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setClipStretchMode: vi.fn(),
}));

vi.mock('../../../useCases/clipStretch/setClipStretchMode', () => ({
    setClipStretchMode: mocks.setClipStretchMode,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetClipStretchMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.setClipStretchMode.mockReturnValue(true);
    });

    it('executes setClipStretchMode with the provided payload', () => {
        void handleSetClipStretchMode.execute({
            type: 'setClipStretchMode',
            payload: { clipId: 'c1', mode: 'timestretch' },
        });

        expect(mocks.setClipStretchMode).toHaveBeenCalledWith('c1', 'timestretch');
    });

    it('provides a description reflecting the mode', () => {
        const desc = handleSetClipStretchMode.describe({
            type: 'setClipStretchMode',
            payload: { clipId: 'c1', mode: 'timestretch' },
        });
        expect(desc.label).toBe('Set clip c1 stretch mode to timestretch');
        expect(desc.inverseAction).toBeNull();
    });

    it('captures exact stretch state for undo and redo with a stable receipt', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', name: 'Verse Lead', startBeat: 2, endBeat: 10, stretchRatio: 1.5 }],
                },
            ],
        });

        const desc = handleSetClipStretchMode.describe({
            type: 'setClipStretchMode',
            payload: { clipId: 'c1', mode: 'timestretch' },
        });
        const previous = {
            startBeat: 2,
            endBeat: 10,
            mode: { present: false, value: 'off' },
            ratio: { present: true, value: 1.5 },
        };
        const next = {
            startBeat: 2,
            endBeat: 10,
            mode: { present: true, value: 'timestretch' },
            ratio: { present: true, value: 1.5 },
        };

        expect(desc.label).toBe('Set clip "Verse Lead" (c1) stretch mode to timestretch');
        expect(desc.inverseAction).toEqual({
            type: 'restoreClipStretchState',
            payload: { clipId: 'c1', expected: next, replacement: previous },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreClipStretchState',
            payload: { clipId: 'c1', expected: previous, replacement: next },
        });
    });

    it('recognizes the effective current mode as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4, stretchMode: 'repitch' }] }],
        });

        expect(
            handleSetClipStretchMode.isNoop?.({
                type: 'setClipStretchMode',
                payload: { clipId: 'c1', mode: 'repitch' },
            })
        ).toBe(true);
    });

    it('is undoable', () => {
        expect(handleSetClipStretchMode.undoable).toBe(true);
    });
});
