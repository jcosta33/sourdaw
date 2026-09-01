import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readNativeEnginePlayheadSeconds } from '#/modules/AudioEngine/useCases';

import { tempoMapStore } from '../../../stores/tempoMapStore';
import { transportStore } from '../../../stores/transportStore';
import { readNativeEngineCursorBeats } from '../readNativeEngineCursorBeats';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    readNativeEnginePlayheadSeconds: vi.fn((): number | null => null),
}));

describe('readNativeEngineCursorBeats', () => {
    beforeEach(() => {
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...transportStore.value!, tempo: 120 });
        vi.mocked(readNativeEnginePlayheadSeconds).mockReturnValue(null);
    });

    it('keeps the cursor on the scheduler clock when the engine has nothing to say', () => {
        expect(readNativeEngineCursorBeats()).toBeNull();
    });

    it('converts the engine seconds through the arrangement tempo map', () => {
        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-1', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        // Beats 0..4 at 120 BPM take two seconds; the next two seconds at
        // 60 BPM carry two more beats.
        vi.mocked(readNativeEnginePlayheadSeconds).mockReturnValue(4);

        expect(readNativeEngineCursorBeats()).toBeCloseTo(6, 6);
    });

    it('refuses a non-finite reading rather than drawing the cursor nowhere', () => {
        vi.mocked(readNativeEnginePlayheadSeconds).mockReturnValue(Number.NaN);

        expect(readNativeEngineCursorBeats()).toBeNull();
    });
});
