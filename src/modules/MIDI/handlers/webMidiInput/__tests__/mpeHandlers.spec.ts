import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDisableMpe } from '../handleDisableMpe';
import { handleEnableMpe } from '../handleEnableMpe';

const setMpeEnabledMock = vi.hoisted(() => vi.fn());

vi.mock('../../../useCases/webMidiInput/setMpeEnabled', () => ({ setMpeEnabled: setMpeEnabledMock }));

describe('WebMIDI MPE handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should enable MPE input handling', () => {
        handleEnableMpe.execute({ type: 'enableMpe', payload: undefined });

        expect(setMpeEnabledMock).toHaveBeenCalledWith(true);
    });

    it('should disable MPE input handling', () => {
        handleDisableMpe.execute({ type: 'disableMpe', payload: undefined });

        expect(setMpeEnabledMock).toHaveBeenCalledWith(false);
    });
});
