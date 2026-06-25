import { describe, it, expect } from 'vitest';

import { AUTO_TAG_RULES, autoTagSample, generatePathHash, getNextSampleId } from '../sampleTaggingHelpers';

describe('sampleTaggingHelpers', () => {
    describe('autoTagSample', () => {
        it('should tag a kick sample correctly', () => {
            const result = autoTagSample('heavy_kick.wav', '/samples/drums/kick/');
            expect(result.category).toBe('kicks');
            expect(result.tags.map((t) => t.name)).toContain('kick');
            expect(result.tags.map((t) => t.name)).toContain('low-end');
        });

        it('should tag a hi-hat sample correctly', () => {
            const result = autoTagSample('closed_hh.wav', '/samples/drums/hats/');
            expect(result.category).toBe('hi-hats');
            expect(result.tags.map((t) => t.name)).toContain('hi-hat');
        });

        it('should combine tags from multiple rules', () => {
            const result = autoTagSample('bass_loop.wav', '/samples/loops/');
            // Matches 'bass' and 'loop' rules
            const tagNames = result.tags.map((t) => t.name);
            expect(tagNames).toContain('bass');
            expect(tagNames).toContain('loop');
            expect(tagNames).toContain('low-end');
            expect(tagNames).toContain('rhythmic');
        });

        it('should return other category if no rules match', () => {
            const result = autoTagSample('unknown.wav', '/some/path/');
            expect(result.category).toBe('other');
            expect(result.tags).toEqual([]);
        });

        // Regression: rule patterns matched as substrings anywhere in the
        // name+path, so unrelated words triggered false auto-tags that then
        // propagated into the category filter and getAllTags. Patterns must
        // match whole tokens only.
        describe('does not match patterns buried inside unrelated words', () => {
            const falsePositives: Array<{ name: string; word: string; mustNotTag: string; mustNotCategory: string }> = [
                { name: 'whatever_take.wav', word: 'whatever (hat)', mustNotTag: 'hi-hat', mustNotCategory: 'hi-hats' },
                {
                    name: 'superconductor.wav',
                    word: 'superconductor (perc)',
                    mustNotTag: 'percussion',
                    mustNotCategory: 'percussion',
                },
                { name: 'notepad_recording.wav', word: 'notepad (pad)', mustNotTag: 'pad', mustNotCategory: 'pads' },
                {
                    name: 'drawstring_demo.wav',
                    word: 'drawstring (string)',
                    mustNotTag: 'strings',
                    mustNotCategory: 'strings',
                },
                { name: 'loophole_riff.wav', word: 'loophole (loop)', mustNotTag: 'loop', mustNotCategory: 'loops' },
                { name: 'bassoon_solo.wav', word: 'bassoon (bass)', mustNotTag: 'bass', mustNotCategory: 'bass' },
                { name: 'pleading_take.wav', word: 'pleading (lead)', mustNotTag: 'synth', mustNotCategory: 'synth' },
            ];

            for (const { name, word, mustNotTag, mustNotCategory } of falsePositives) {
                it(`does not tag "${word}" from "${name}"`, () => {
                    const result = autoTagSample(name, '/samples/misc/');
                    expect(result.tags.map((t) => t.name)).not.toContain(mustNotTag);
                    expect(result.category).not.toBe(mustNotCategory);
                });
            }
        });

        it('still matches a whole-word pattern across separators', () => {
            // underscore, dash and "no separator" spellings must keep matching
            expect(autoTagSample('perc_01.wav', '/x/').category).toBe('percussion');
            expect(autoTagSample('warm_pad.wav', '/x/').tags.map((t) => t.name)).toContain('pad');
            expect(autoTagSample('open hat.wav', '/x/').category).toBe('hi-hats');
            expect(autoTagSample('bass-drum.wav', '/x/').category).toBe('kicks');
            expect(autoTagSample('bassdrum.wav', '/x/').category).toBe('kicks');
        });
    });

    describe('AUTO_TAG_RULES table', () => {
        // The table is typed `as const`, so it is a readonly tuple whose
        // elements are readonly. These are type-level assertions only — never
        // executed (the body is unreachable), so the table is not mutated at
        // runtime (`as const` does not freeze). If the source reverts to a
        // mutable `Array<...>`, each `@ts-expect-error` becomes unused and the
        // typecheck fails (TS2578).
        function assertReadonlyAtCompileTime(): void {
            // @ts-expect-error the element's `category` is readonly — assignment is rejected.
            AUTO_TAG_RULES[0].category = 'other';
            // @ts-expect-error the element's `tags` is a readonly tuple — index assignment is rejected.
            AUTO_TAG_RULES[0].tags[0] = 'other';
        }

        it('is a readonly table (the compile-time guard above is referenced)', () => {
            expect(typeof assertReadonlyAtCompileTime).toBe('function');
        });
    });

    describe('generatePathHash', () => {
        it('should generate consistent hashes for the same input', () => {
            const f1 = generatePathHash('test.wav', '/path/a');
            const f2 = generatePathHash('test.wav', '/path/a');
            expect(f1).toBe(f2);
            expect(f1.startsWith('path-')).toBe(true);
        });

        it('should generate different hashes for different inputs', () => {
            const f1 = generatePathHash('test1.wav', '/path/a');
            const f2 = generatePathHash('test2.wav', '/path/a');
            expect(f1).not.toBe(f2);
        });
    });

    describe('getNextSampleId', () => {
        it('should produce a unique id each call', () => {
            const id1 = getNextSampleId();
            const id2 = getNextSampleId();
            expect(id1).not.toBe(id2);
            expect(id1.startsWith('sample-')).toBe(true);
            expect(id2.startsWith('sample-')).toBe(true);
        });
    });
});
