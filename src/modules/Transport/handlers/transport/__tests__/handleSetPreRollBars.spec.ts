import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../useCases/transportQueries/getTransportState';
import { handleSetPreRollBars } from '../handleSetPreRollBars';

vi.mock('../../../useCases/transportControls/setPreRollBars', () => ({
    setPreRollBars: vi.fn(),
}));

vi.mock('../../../useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

describe('handleSetPreRollBars', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, preRollBars: 2 });
    });

    it('undoes to the previous bar count and redoes to the new one', () => {
        expect(handleSetPreRollBars.describe({ type: 'setPreRollBars', payload: { bars: 3 } })).toMatchObject({
            inverseAction: { type: 'setPreRollBars', payload: { bars: 2 } },
            redoAction: { type: 'setPreRollBars', payload: { bars: 3 } },
        });
    });

    it('redoes to the clamped bar count the use case stores', () => {
        expect(handleSetPreRollBars.describe({ type: 'setPreRollBars', payload: { bars: 20 } })).toMatchObject({
            redoAction: { type: 'setPreRollBars', payload: { bars: 8 } },
        });
    });

    it('has no inverse when the transport state is unavailable', () => {
        vi.mocked(getTransportState).mockReturnValue(undefined);

        expect(
            handleSetPreRollBars.describe({ type: 'setPreRollBars', payload: { bars: 3 } }).inverseAction
        ).toBeNull();
    });

    it('treats the stored clamped value as a no-op', () => {
        expect(handleSetPreRollBars.isNoop?.({ type: 'setPreRollBars', payload: { bars: 2 } })).toBe(true);
        expect(handleSetPreRollBars.isNoop?.({ type: 'setPreRollBars', payload: { bars: 3 } })).toBe(false);

        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, preRollBars: 8 });
        expect(handleSetPreRollBars.isNoop?.({ type: 'setPreRollBars', payload: { bars: 20 } })).toBe(true);
    });
});
