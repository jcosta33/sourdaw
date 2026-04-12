import { describe, it, expect } from 'vitest';
import { isScoringDevice } from '../ScoringNode';

describe('isScoringDevice', () => {
    it('should return true only for the native-scoring device type string', () => {
        expect(isScoringDevice('native-scoring')).toBe(true);
        expect(isScoringDevice('proof')).toBe(false);
    });
});
