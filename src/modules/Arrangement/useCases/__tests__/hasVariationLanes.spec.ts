import { describe, expect, it } from 'vitest';

import { createTrack, type Track } from '../../models/Track';
import { hasVariationLanes } from '../hasVariationLanes';

function makeTrack(kind: Track['kind'], showVariationLanes: boolean): Track {
    return {
        ...createTrack({
            id: kind,
            kind,
            name: kind,
            initialDeviceId: `${kind}-device`,
            initialAlternativeId: `${kind}-alt`,
        }),
        showVariationLanes,
    };
}

describe('hasVariationLanes', () => {
    it('is true when any laneable track has its lanes on', () => {
        expect(hasVariationLanes([makeTrack('audio', false), makeTrack('midi', true)])).toBe(true);
    });

    it('is false with no tracks or every toggle off', () => {
        expect(hasVariationLanes([])).toBe(false);
        expect(hasVariationLanes([makeTrack('audio', false)])).toBe(false);
    });

    it('ignores a folder or master row, which never hosts lanes', () => {
        expect(hasVariationLanes([makeTrack('folder', true), makeTrack('master', true)])).toBe(false);
    });
});
