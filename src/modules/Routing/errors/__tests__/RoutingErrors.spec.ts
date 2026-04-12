import { describe, expect, it } from 'vitest';

import { DuplicateSidechainRouteError, SidechainCycleError } from '../RoutingErrors';

describe('SidechainCycleError', () => {
    it('carries track ids and a stable name', () => {
        const err = new SidechainCycleError('a', 'b');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('SidechainCycleError');
        expect(err.sourceTrackId).toBe('a');
        expect(err.targetTrackId).toBe('b');
        expect(err.message).toContain('a');
        expect(err.message).toContain('b');
    });
});

describe('DuplicateSidechainRouteError', () => {
    it('carries source track and target device ids', () => {
        const err = new DuplicateSidechainRouteError('track-1', 'dev-2');
        expect(err.name).toBe('DuplicateSidechainRouteError');
        expect(err.sourceTrackId).toBe('track-1');
        expect(err.targetDeviceId).toBe('dev-2');
        expect(err.message).toContain('track-1');
        expect(err.message).toContain('dev-2');
    });
});
