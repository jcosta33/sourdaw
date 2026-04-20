import { describe, it, expect } from 'vitest';

import { isProofDevice } from '../ProofNode';

describe('isProofDevice', () => {
    it('should return true only for the proof device type string', () => {
        expect(isProofDevice('proof')).toBe(true);
        expect(isProofDevice('dutch-oven')).toBe(false);
    });
});
