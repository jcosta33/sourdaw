import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    clearScratchPad: vi.fn(),
    commitScratchPadToArrangement: vi.fn(),
}));

vi.mock('../../../useCases/scratchPad/scratchPadCrud/clearScratchPad', () => ({
    clearScratchPad: mocks.clearScratchPad,
}));
vi.mock('../../../useCases/scratchPad/captureCommit/commitScratchPadToArrangement', () => ({
    commitScratchPadToArrangement: mocks.commitScratchPadToArrangement,
}));

import { handleClearScratchPad } from '../handleClearScratchPad';
import { handleCommitScratchPad } from '../handleCommitScratchPad';

describe('Arrangement scratch pad handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should clear the scratch pad through Arrangement', () => {
        handleClearScratchPad.execute({ type: 'clearScratchPad', payload: {} });

        expect(mocks.clearScratchPad).toHaveBeenCalledTimes(1);
    });

    it('should commit the scratch pad through Arrangement', () => {
        handleCommitScratchPad.execute({ type: 'commitScratchPad', payload: {} });

        expect(mocks.commitScratchPadToArrangement).toHaveBeenCalledTimes(1);
    });
});
