import { describe, it, expect } from 'vitest';
import { isProofChamberDevice } from '../ProofChamberNode';

describe('isProofChamberDevice', () => {
    it('should return true only for the dutch-oven device type string', () => {
        expect(isProofChamberDevice('dutch-oven')).toBe(true);
        expect(isProofChamberDevice('proof')).toBe(false);
    });
});
