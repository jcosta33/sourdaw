import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { setPlayheadFromClick } from './setPlayheadFromClick';

describe('setPlayheadFromClick', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not update transport when transport snapshot is null', () => {
        const getTransportState = vi.fn().mockReturnValue(null);
        const updateTransportState = vi.fn();
        injectDependencies(setPlayheadFromClick, { getTransportState, updateTransportState });

        setPlayheadFromClick(100);

        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('maps canvas x to playhead beats using timeline view state', () => {
        const getTransportState = vi.fn().mockReturnValue(defaultTransportState);
        const updateTransportState = vi.fn();
        injectDependencies(setPlayheadFromClick, { getTransportState, updateTransportState });

        setPlayheadFromClick(24);

        expect(updateTransportState).toHaveBeenCalledWith({ playheadPosition: 2 });
    });
});
