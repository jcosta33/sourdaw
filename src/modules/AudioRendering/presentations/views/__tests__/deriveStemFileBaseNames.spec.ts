import { describe, it, expect } from 'vitest';

import { deriveStemFileBaseNames } from '../deriveStemFileBaseNames';

describe('deriveStemFileBaseNames', () => {
    it('should give two identically named tracks distinct filenames so the second stem does not overwrite the first', () => {
        const names = deriveStemFileBaseNames([
            { trackId: 'trk_aaaaaaaa', name: 'Bass' },
            { trackId: 'trk_bbbbbbbb', name: 'Bass' },
        ]);

        const first = names.get('trk_aaaaaaaa');
        const second = names.get('trk_bbbbbbbb');

        expect(first).toBe('Bass');
        expect(second).toBe('Bass_trk_bbbb');
        // The collision class: both used to compute the same `${name}.wav`, silently overwriting.
        expect(first).not.toBe(second);
    });

    it('should keep a unique name untouched (no gratuitous disambiguator)', () => {
        const names = deriveStemFileBaseNames([
            { trackId: 'trk_1', name: 'Drums' },
            { trackId: 'trk_2', name: 'Lead Synth' },
        ]);

        expect(names.get('trk_1')).toBe('Drums');
        expect(names.get('trk_2')).toBe('Lead Synth');
    });

    it('should sanitize filesystem-hostile characters to underscores (existing behaviour preserved)', () => {
        const names = deriveStemFileBaseNames([{ trackId: 'trk_1', name: 'Kick/Snare: v2' }]);

        expect(names.get('trk_1')).toBe('Kick_Snare_ v2');
    });

    it('should disambiguate names that collide only after sanitization', () => {
        const names = deriveStemFileBaseNames([
            { trackId: 'trk_leadaaa', name: 'Lead/Rhythm' },
            { trackId: 'trk_leadbbb', name: 'Lead_Rhythm' },
        ]);

        expect(names.get('trk_leadaaa')).toBe('Lead_Rhythm');
        expect(names.get('trk_leadbbb')).toBe('Lead_Rhythm_trk_lead');
        expect(names.get('trk_leadaaa')).not.toBe(names.get('trk_leadbbb'));
    });

    it('should fall back to the unique track id when a name is missing or blank', () => {
        const names = deriveStemFileBaseNames([
            { trackId: 'trk_1', name: '' },
            { trackId: 'trk_2', name: '   ' },
            { trackId: 'trk_3', name: undefined },
        ]);

        expect(names.get('trk_1')).toBe('trk_1');
        expect(names.get('trk_2')).toBe('trk_2');
        expect(names.get('trk_3')).toBe('trk_3');
    });

    it('should stay unique even when the name and the short-id disambiguator both collide', () => {
        const names = deriveStemFileBaseNames([
            { trackId: 'dupidsame_1', name: 'Pad' },
            { trackId: 'dupidsame_2', name: 'Pad' },
            { trackId: 'dupidsame_3', name: 'Pad' },
        ]);

        const values = [names.get('dupidsame_1'), names.get('dupidsame_2'), names.get('dupidsame_3')];

        expect(values[0]).toBe('Pad');
        expect(new Set(values).size).toBe(3);
    });
});
