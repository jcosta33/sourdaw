import { describe, it, expect } from 'vitest';

import { DEFAULT_TUNER_STATE as MODEL_DEFAULT } from '../../models/ScoringState';
import { DEFAULT_TUNER_STATE as STORE_DEFAULT } from '../scoringStore';

describe('scoringStore type/const dedup', () => {
    // The store must re-export the canonical definitions from models/ScoringState
    // rather than maintaining its own byte-identical copies. A duplicate copy is a
    // distinct object literal, so referential identity is the seam that proves the
    // two paths resolve to one source and cannot silently drift apart.
    it('re-exports the same DEFAULT_TUNER_STATE reference as the model', () => {
        expect(STORE_DEFAULT).toBe(MODEL_DEFAULT);
    });
});
