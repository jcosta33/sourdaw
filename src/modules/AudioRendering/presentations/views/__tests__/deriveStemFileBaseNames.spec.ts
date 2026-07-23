import { describe, it, expect } from 'vitest';

import { deriveStemFileBaseNames, type StemFileNameTrack } from '../deriveStemFileBaseNames';

// Helper: run the derivation from a stable track list, exporting a stem for every track.
function baseNamesFor(orderedTracks: readonly StemFileNameTrack[]): Map<string, string> {
    return deriveStemFileBaseNames({
        stemTrackIds: orderedTracks.map((track) => track.id),
        orderedTracks,
    });
}

describe('deriveStemFileBaseNames', () => {
    it('should give two identically named tracks distinct filenames so the second stem does not overwrite the first', () => {
        const names = baseNamesFor([
            { id: 'trk_aaaaaaaa', name: 'Bass' },
            { id: 'trk_bbbbbbbb', name: 'Bass' },
        ]);

        const first = names.get('trk_aaaaaaaa');
        const second = names.get('trk_bbbbbbbb');

        expect(first).toBe('Bass');
        expect(second).toBe('Bass_trk_bbbb');
        // The collision class: both used to compute the same `${name}.wav`, silently overwriting.
        expect(first).not.toBe(second);
    });

    it('should treat names that differ only in case as colliding (safe on APFS / NTFS)', () => {
        const names = baseNamesFor([
            { id: 'trk_upper', name: 'Bass' },
            { id: 'trk_lower', name: 'bass' },
        ]);

        const upper = names.get('trk_upper');
        const lower = names.get('trk_lower');

        // Original casing is preserved on the first claimant...
        expect(upper).toBe('Bass');
        // ...but the case-variant is disambiguated rather than emitting a second `bass` that
        // would resolve to the same file on a case-insensitive filesystem.
        expect(lower).toBe('bass_trk_lowe');
        expect(upper!.toLowerCase()).not.toBe(lower!.toLowerCase());
    });

    it('should keep a unique name untouched (no gratuitous disambiguator)', () => {
        const names = baseNamesFor([
            { id: 'trk_1', name: 'Drums' },
            { id: 'trk_2', name: 'Lead Synth' },
        ]);

        expect(names.get('trk_1')).toBe('Drums');
        expect(names.get('trk_2')).toBe('Lead Synth');
    });

    it('should sanitize filesystem-hostile characters to underscores (existing behaviour preserved)', () => {
        const names = baseNamesFor([{ id: 'trk_1', name: 'Kick/Snare: v2' }]);

        expect(names.get('trk_1')).toBe('Kick_Snare_ v2');
    });

    it('should disambiguate names that collide only after sanitization', () => {
        const names = baseNamesFor([
            { id: 'trk_leadaaa', name: 'Lead/Rhythm' },
            { id: 'trk_leadbbb', name: 'Lead_Rhythm' },
        ]);

        expect(names.get('trk_leadaaa')).toBe('Lead_Rhythm');
        expect(names.get('trk_leadbbb')).toBe('Lead_Rhythm_trk_lead');
        expect(names.get('trk_leadaaa')).not.toBe(names.get('trk_leadbbb'));
    });

    it('should fall back to the unique track id when a name is missing or blank', () => {
        const names = baseNamesFor([
            { id: 'trk_1', name: '' },
            { id: 'trk_2', name: '   ' },
            { id: 'trk_3', name: undefined },
        ]);

        expect(names.get('trk_1')).toBe('trk_1');
        expect(names.get('trk_2')).toBe('trk_2');
        expect(names.get('trk_3')).toBe('trk_3');
    });

    it('should stay unique even when the name and the short-id disambiguator both collide', () => {
        const names = baseNamesFor([
            { id: 'dupidsame_1', name: 'Pad' },
            { id: 'dupidsame_2', name: 'Pad' },
            { id: 'dupidsame_3', name: 'Pad' },
        ]);

        const values = [names.get('dupidsame_1'), names.get('dupidsame_2'), names.get('dupidsame_3')];

        expect(values[0]).toBe('Pad');
        expect(new Set(values).size).toBe(3);
    });

    it('should produce an identical mapping regardless of stem render-completion order', () => {
        // Stable project-store order. The bounded-concurrency pool completes stems in an
        // arbitrary order, so the stems map can be iterated either way — the filename each
        // track receives must not depend on which stem finished first.
        const orderedTracks: StemFileNameTrack[] = [
            { id: 'trk_kick_1', name: 'Kick' },
            { id: 'trk_kick_2', name: 'Kick' },
            { id: 'trk_snare', name: 'Snare' },
        ];

        const completionOrderA = ['trk_kick_1', 'trk_kick_2', 'trk_snare'];
        const completionOrderB = ['trk_snare', 'trk_kick_2', 'trk_kick_1'];

        const mappingA = deriveStemFileBaseNames({ stemTrackIds: completionOrderA, orderedTracks });
        const mappingB = deriveStemFileBaseNames({ stemTrackIds: completionOrderB, orderedTracks });

        const asObject = (map: Map<string, string>): Record<string, string> => Object.fromEntries(map);

        expect(asObject(mappingA)).toEqual(asObject(mappingB));
        // And the bare name goes to the store-order-first track, not the first to finish.
        expect(mappingA.get('trk_kick_1')).toBe('Kick');
        expect(mappingA.get('trk_kick_2')).toBe('Kick_trk_kick');
        expect(mappingA.get('trk_snare')).toBe('Snare');
    });
});
