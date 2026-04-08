import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeSetTempo, executeStopPlayback } from './transportHandlers';

describe('transportHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeSetTempo forwards bpm to setTempo', () => {
        const setTempo = vi.fn();
        injectDependencies(executeSetTempo, { setTempo });

        executeSetTempo({ type: 'setTempo', payload: { bpm: 120 } });

        expect(setTempo).toHaveBeenCalledWith(120);
    });

    it('executeStopPlayback calls stopPlayback', () => {
        const stopPlayback = vi.fn();
        injectDependencies(executeStopPlayback, { stopPlayback });

        executeStopPlayback();

        expect(stopPlayback).toHaveBeenCalled();
    });
});
