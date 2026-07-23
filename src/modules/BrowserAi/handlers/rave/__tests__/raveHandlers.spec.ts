import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadModel } from '../../../useCases/rave/loadModel';
import { setTransferBlend } from '../../../useCases/rave/setTransferBlend';
import { handleLoadRaveModel } from '../handleLoadRaveModel';
import { handleSetRaveBlend } from '../handleSetRaveBlend';

vi.mock('../../../useCases/rave/loadModel', () => ({ loadModel: vi.fn() }));
vi.mock('../../../useCases/rave/setTransferBlend', () => ({ setTransferBlend: vi.fn() }));

describe('raveHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleLoadRaveModel should delegate to loadModel', () => {
        void handleLoadRaveModel.execute({ type: 'loadRaveModel', payload: { modelId: 'rave-1' } });
        expect(loadModel).toHaveBeenCalledWith('rave-1');
    });

    it('handleSetRaveBlend should delegate to setTransferBlend', () => {
        void handleSetRaveBlend.execute({ type: 'setRaveBlend', payload: { blend: 0.5 } });
        expect(setTransferBlend).toHaveBeenCalledWith(0.5);
    });

    it('handleLoadRaveModel should describe its label', () => {
        expect(handleLoadRaveModel.describe({ type: 'loadRaveModel', payload: { modelId: 'rave-1' } })).toEqual({
            label: 'Load RAVE Model',
        });
    });

    it('handleSetRaveBlend should describe its label', () => {
        expect(handleSetRaveBlend.describe({ type: 'setRaveBlend', payload: { blend: 0.5 } })).toEqual({
            label: 'Set RAVE Timbre Blend',
        });
    });
});
