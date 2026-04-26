import { describe, it, expect } from 'vitest';

import { selectTrack } from '../timelineViewActions';
import * as selectTrackModule from '../toggleTrackState/selectTrack';

describe('timelineViewActions', () => {
    it('re-exports selectTrack from toggleTrackState', () => {
        expect(selectTrack).toBe(selectTrackModule.selectTrack);
    });
});
