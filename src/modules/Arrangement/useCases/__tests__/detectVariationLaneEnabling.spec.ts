import { describe, expect, it } from 'vitest';

import { createTrack, type Track } from '../../models/Track';
import { detectVariationLaneEnabling } from '../detectVariationLaneEnabling';

function makeTrack(id: string, showVariationLanes: boolean, kind: Track['kind'] = 'audio'): Track {
    return {
        ...createTrack({ id, kind, name: id, initialDeviceId: `${id}-device`, initialAlternativeId: `${id}-alt` }),
        showVariationLanes,
    };
}

describe('detectVariationLaneEnabling', () => {
    it('only seeds on the first observation, even when lanes are already on', () => {
        const result = detectVariationLaneEnabling(null, [makeTrack('a', true), makeTrack('b', false)]);

        expect(result.enabledTrackIds).toEqual([]);
        expect([...result.shown]).toEqual([
            ['a', true],
            ['b', false],
        ]);
    });

    it('reports a track whose lanes went from off to on', () => {
        const before = detectVariationLaneEnabling(null, [makeTrack('a', false), makeTrack('b', false)]);

        const after = detectVariationLaneEnabling(before.shown, [makeTrack('a', false), makeTrack('b', true)]);

        expect(after.enabledTrackIds).toEqual(['b']);
    });

    it('does not report a track that appears with its lanes already on', () => {
        const before = detectVariationLaneEnabling(null, []);

        const after = detectVariationLaneEnabling(before.shown, [makeTrack('loaded', true)]);

        expect(after.enabledTrackIds).toEqual([]);
    });

    it('does not report lanes turning off, or lanes that stay on', () => {
        const before = detectVariationLaneEnabling(null, [makeTrack('a', true), makeTrack('b', true)]);

        const after = detectVariationLaneEnabling(before.shown, [makeTrack('a', false), makeTrack('b', true)]);

        expect(after.enabledTrackIds).toEqual([]);
    });

    it('does not count a toggle on a folder, which never shows lanes', () => {
        const before = detectVariationLaneEnabling(null, [makeTrack('f', false, 'folder')]);

        const after = detectVariationLaneEnabling(before.shown, [makeTrack('f', true, 'folder')]);

        expect(after.enabledTrackIds).toEqual([]);
    });
});
