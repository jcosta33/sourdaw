import { describe, it, expect, beforeEach } from 'vitest';

import {
    __resetGainEnvelopesForTest,
    getEnvelope,
} from '#/modules/Arrangement/stores/gainEnvelopeStore';

import { resetClipGainEnvelope } from '../resetClipGainEnvelope';

describe('resetClipGainEnvelope', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('writes a default envelope to the store', () => {
        resetClipGainEnvelope('c1');

        expect(getEnvelope('c1')?.enabled).toBe(true);
        expect(getEnvelope('c1')?.points).toHaveLength(1);
    });
});
