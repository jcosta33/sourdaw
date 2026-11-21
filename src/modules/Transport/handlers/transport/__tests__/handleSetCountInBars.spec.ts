import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../useCases/transportQueries/getTransportState';
import { handleSetCountInBars } from '../handleSetCountInBars';

vi.mock('../../../useCases/transportControls/setCountInBars', () => ({
    setCountInBars: vi.fn(),
}));

vi.mock('../../../useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

describe('handleSetCountInBars', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, countInBars: 1 });
    });

    it('undoes to the previous bar count and redoes to the new one', () => {
        expect(handleSetCountInBars.describe({ type: 'setCountInBars', payload: { bars: 2 } })).toMatchObject({
            inverseAction: { type: 'setCountInBars', payload: { bars: 1 } },
            redoAction: { type: 'setCountInBars', payload: { bars: 2 } },
        });
    });

    it('redoes to the clamped bar count the use case stores', () => {
        expect(handleSetCountInBars.describe({ type: 'setCountInBars', payload: { bars: 20 } })).toMatchObject({
            redoAction: { type: 'setCountInBars', payload: { bars: 8 } },
        });
    });

    it('has no inverse when the transport state is unavailable', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        expect(
            handleSetCountInBars.describe({ type: 'setCountInBars', payload: { bars: 2 } }).inverseAction
        ).toBeNull();
    });

    it('treats the stored clamped value as a no-op', () => {
        expect(handleSetCountInBars.isNoop?.({ type: 'setCountInBars', payload: { bars: 1 } })).toBe(true);
        expect(handleSetCountInBars.isNoop?.({ type: 'setCountInBars', payload: { bars: 2 } })).toBe(false);

        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, countInBars: 8 });
        expect(handleSetCountInBars.isNoop?.({ type: 'setCountInBars', payload: { bars: 20 } })).toBe(true);
    });
});
