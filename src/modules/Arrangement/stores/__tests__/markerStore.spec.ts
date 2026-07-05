import { describe, expect, it } from 'vitest';

import { defaultMarkerStoreState, sanitize_marker_store_state } from '../markerStore';

describe('sanitize_marker_store_state', () => {
    it('should reset non-object persisted marker state', () => {
        expect(sanitize_marker_store_state('corrupt')).toEqual(defaultMarkerStoreState);
    });

    it('should preserve valid markers and sections while dropping malformed rows', () => {
        const valid_marker = { id: 'marker-1', beat: 4, name: 'Intro', color: '#ffffff' };
        const valid_section = {
            id: 'section-1',
            startBeat: 0,
            endBeat: 8,
            name: 'Verse',
            color: '#111111',
        };

        expect(
            sanitize_marker_store_state({
                markers: [
                    valid_marker,
                    { id: 'bad-marker', beat: Number.NaN, name: 'Bad', color: '#000000' },
                    { id: 'bad-color', beat: 2, name: 'Bad' },
                ],
                sections: [
                    valid_section,
                    { id: 'bad-section', startBeat: 8, endBeat: 4, name: 'Backwards', color: '#222222' },
                    { id: 'bad-beat', startBeat: Number.POSITIVE_INFINITY, endBeat: 12, name: 'Bad', color: '#333333' },
                ],
            })
        ).toEqual({ markers: [valid_marker], sections: [valid_section] });
    });

    it('should preserve valid markers when sections are corrupt', () => {
        const valid_marker = { id: 'marker-1', beat: 4, name: 'Intro', color: '#ffffff' };

        expect(sanitize_marker_store_state({ markers: [valid_marker], sections: 'corrupt' })).toEqual({
            markers: [valid_marker],
            sections: [],
        });
    });

    it('should preserve valid sections when markers are corrupt', () => {
        const valid_section = {
            id: 'section-1',
            startBeat: 0,
            endBeat: 8,
            name: 'Verse',
            color: '#111111',
        };

        expect(sanitize_marker_store_state({ markers: 'corrupt', sections: [valid_section] })).toEqual({
            markers: [],
            sections: [valid_section],
        });
    });

    it('should strip unknown fields from valid rows', () => {
        expect(
            sanitize_marker_store_state({
                markers: [{ id: 'marker-1', beat: 4, name: 'Intro', color: '#ffffff', stale: true }],
                sections: [
                    {
                        id: 'section-1',
                        startBeat: 0,
                        endBeat: 8,
                        name: 'Verse',
                        color: '#111111',
                        stale: true,
                    },
                ],
                stale: true,
            })
        ).toEqual({
            markers: [{ id: 'marker-1', beat: 4, name: 'Intro', color: '#ffffff' }],
            sections: [{ id: 'section-1', startBeat: 0, endBeat: 8, name: 'Verse', color: '#111111' }],
        });
    });
});
