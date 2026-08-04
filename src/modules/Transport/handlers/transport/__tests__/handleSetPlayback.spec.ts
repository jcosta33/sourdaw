import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { setPlayback } from '../../../useCases/transportControls/setPlayback';
import { handleSetPlayback } from '../handleSetPlayback';

vi.mock('../../../useCases/transportControls/setPlayback', () => ({ setPlayback: vi.fn() }));

describe('handleSetPlayback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set({ ...defaultTransportState });
    });

    it('delegates the explicit desired state to Transport', () => {
        void handleSetPlayback.execute({ type: 'setPlayback', payload: { playing: true } });

        expect(setPlayback).toHaveBeenCalledWith(true);
    });

    it('classifies playback as runtime-only and non-undoable', () => {
        expect(handleSetPlayback.executionKind).toBe('runtime');
        expect(handleSetPlayback.undoable).toBe(false);
    });

    it('reports a no-op only when live playback already matches', () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true });

        expect(handleSetPlayback.isNoop?.({ type: 'setPlayback', payload: { playing: true } })).toBe(true);
        expect(handleSetPlayback.isNoop?.({ type: 'setPlayback', payload: { playing: false } })).toBe(false);
    });
});
