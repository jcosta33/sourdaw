import { describe, it, expect, vi } from 'vitest';
import { selectTrack } from '../timelineViewActions';
import * as selectTrackModule from '#/modules/Arrangement/useCases/toggleTrackState/selectTrack';

describe('timelineViewActions', () => {
    it('re-exports selectTrack from toggleTrackState', () => {
        expect(selectTrack).toBe(selectTrackModule.selectTrack);
    });
});
