import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleZoomToSelection } from '../handleZoomToSelection';

const mocks = vi.hoisted(() => ({
    zoomToSelection: vi.fn(),
}));

vi.mock('../../../useCases/togglePanel/zoomOperations/zoomToSelection', () => ({
    zoomToSelection: mocks.zoomToSelection,
}));

describe('handleZoomToSelection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to zoomToSelection use case', () => {
        handleZoomToSelection.execute({
            type: 'zoomToSelection',
            payload: {}
        });
        expect(mocks.zoomToSelection).toHaveBeenCalledTimes(1);
    });
});
