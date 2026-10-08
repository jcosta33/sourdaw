import { describe, expect, it } from 'vitest';

import {
    beginCrumbsPairedReconcile,
    endCrumbsPairedReconcile,
    hasUnsettledCrumbsPairedReconcile,
} from '../sampleLoadGate';

/**
 * The paired-reconcile hold's contract, pinned directly: concurrent paired
 * reconciles for one device nest, and the mirror releases only when the LAST
 * of them settles — the first settle of a collapsed pair must not expose the
 * second's mid-pair state to the persistence mirror.
 */
describe('sampleLoadGate paired-reconcile hold', () => {
    it('holds between a begin and its end', () => {
        beginCrumbsPairedReconcile('gate-dev-1');
        expect(hasUnsettledCrumbsPairedReconcile('gate-dev-1')).toBe(true);

        endCrumbsPairedReconcile('gate-dev-1');
        expect(hasUnsettledCrumbsPairedReconcile('gate-dev-1')).toBe(false);
    });

    it('keeps the hold while a concurrent paired reconcile is still unsettled', () => {
        beginCrumbsPairedReconcile('gate-dev-2');
        beginCrumbsPairedReconcile('gate-dev-2');

        endCrumbsPairedReconcile('gate-dev-2');
        expect(hasUnsettledCrumbsPairedReconcile('gate-dev-2')).toBe(true);

        endCrumbsPairedReconcile('gate-dev-2');
        expect(hasUnsettledCrumbsPairedReconcile('gate-dev-2')).toBe(false);
    });

    it('tracks devices independently', () => {
        beginCrumbsPairedReconcile('gate-dev-3');
        beginCrumbsPairedReconcile('gate-dev-4');

        endCrumbsPairedReconcile('gate-dev-3');
        expect(hasUnsettledCrumbsPairedReconcile('gate-dev-3')).toBe(false);
        expect(hasUnsettledCrumbsPairedReconcile('gate-dev-4')).toBe(true);
    });
});
