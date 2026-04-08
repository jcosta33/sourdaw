import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setTimeSignature } from './setTimeSignature';
import { getTransportState, updateTransportState } from '../repositories/transport';
import { defaultTransportState } from '../models/TransportState';

describe('setTimeSignature', () => {
    it('should ignore invalid numerator or denominator', () => {
        const update = vi.fn();
        injectDependencies(setTimeSignature, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setTimeSignature(0, 4);
        setTimeSignature(4, 3);

        expect(update).not.toHaveBeenCalled();
    });

    it('should update numerator and denominator when valid', () => {
        const update = vi.fn();
        injectDependencies(setTimeSignature, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setTimeSignature(6, 8);

        expect(update).toHaveBeenCalledWith({
            timeSignatureNumerator: 6,
            timeSignatureDenominator: 8,
        });
    });
});
