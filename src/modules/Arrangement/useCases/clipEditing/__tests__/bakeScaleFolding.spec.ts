import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../bakeScaleFolding';

const mocks = vi.hoisted(() => ({
    projectValue: { value: null as { keyRoot: number; scaleName: string } | null },
    updateClip: vi.fn(),
}));

vi.mock('#/modules/Project/stores', () => ({
    projectStore: {
        get value() {
            return mocks.projectValue.value;
        },
    },
}));

vi.mock('../../updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('bakeClipScaleFolding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectValue.value = null;
    });

    it('commits the project key and scale as the clip baked source', () => {
        mocks.projectValue.value = { keyRoot: 7, scaleName: 'major' };

        subject.bakeClipScaleFolding('clip-1');

        expect(mocks.updateClip).toHaveBeenCalledTimes(1);
        const [clipId, updater] = mocks.updateClip.mock.calls[0] ?? [];
        expect(clipId).toBe('clip-1');
        const result = updater({ sourceKeyRoot: 0, sourceScaleName: 'chromatic', unchanged: true });
        expect(result).toEqual({ sourceKeyRoot: 7, sourceScaleName: 'major', unchanged: true });
    });

    it('does nothing when the project store has not loaded', () => {
        mocks.projectValue.value = null;

        subject.bakeClipScaleFolding('clip-1');

        expect(mocks.updateClip).not.toHaveBeenCalled();
    });
});
