import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setTempo } from './setTempo';
import { getTransportState, updateTransportState } from '../repositories/transport';
import { defaultTransportState } from '../models/TransportState';

describe('setTempo', () => {
    it('should throw when bpm is out of range', () => {
        const update = vi.fn();
        injectDependencies(setTempo, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        expect(() => setTempo(10)).toThrow();
        expect(() => setTempo(400)).toThrow();
        expect(update).not.toHaveBeenCalled();
    });

    it('should patch tempo when bpm is valid', () => {
        const update = vi.fn();
        injectDependencies(setTempo, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setTempo(140);

        expect(update).toHaveBeenCalledWith({ tempo: 140 });
    });
});
