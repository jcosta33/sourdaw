import { describe, expect, it } from 'vitest';

import { SidechainCycleError } from '../RoutingErrors';

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
