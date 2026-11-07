import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { getProjectContext } from '../getProjectContext';
import { compilePerceptualConstraints } from '../perceptualConstraints/compilePerceptualConstraints';
import { readRequestMixDescriptors } from '../readRequestMixDescriptors';

import { createTrack } from './trackFixture';

registerDeviceEnginePorts();

function readDescriptors(prompt: string) {
    const context = getProjectContext();
    return readRequestMixDescriptors({
        prompt,
        catalog: getMixRecipeCatalog(),
        context,
        reading: compilePerceptualConstraints(prompt, context),
    });
}

beforeEach(() => {
    trackStore.set({
        tracks: [
            createTrack({ id: 'track-drums', name: 'Drums' }),
            createTrack({ id: 'track-vocal', name: 'Vocal' }),
            createTrack({ id: 'track-bass', name: 'Bass' }),
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
});

afterEach(() => {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
});

describe('reading the characters a whole-project request asks for', () => {
    it.each([
        ['make this mix warmer and more open', ['warm']],
        ['add more punch and width', ['punchy', 'wide']],
        ['make this mix not only warmer but also wider', ['warm', 'wide']],
        // The catalog's own "less muddy" term names the de-mudding character, so it stays read.
        ['make it warmer and less muddy', ['warm', 'muddy']],
        // An `and` that opens a new instruction ends the kept clause before it.
        ['keep the drums punchy and make the vocal warmer', ['warm']],
    ])('reads "%s" as %j', (prompt, expected) => {
        expect(readDescriptors(prompt)).toEqual(expected);
    });

    // A withheld, reduced or kept quality is left out: never planned as an increase, and never read
    // as another character in its place ("less warm" is not "dark").
    it.each([
        ["make this mix warmer but don't let the vocal get brighter", ['warm']],
        ['make the drums less punchy and the bass less warm', []],
        ['keep the drums punchy and the vocal warm', []],
        ['make it darker, not brighter', ['dark']],
        ['warm it up without making it any wider', ['warm']],
        ['make it not only warmer', []],
        ['make it not only warmer but also not wider', ['warm']],
        ['do not make it not only warmer but also wider', []],
        ['without making it not only warmer but also wider', []],
        ['do not make it warmer but make it wider', ['wide']],
    ])('leaves out what "%s" withholds, reduces or keeps', (prompt, expected) => {
        expect(readDescriptors(prompt)).toEqual(expected);
    });

    describe.each(['rather than', 'instead of', 'as opposed to'])('%s exclusions', (opening) => {
        it.each([
            [`make this mix warmer ${opening} wider`, ['warm']],
            [`${opening} making it wider, make this mix warmer`, ['warm']],
            [`make this mix warmer ${opening} wider and brighter`, ['warm']],
            [`make this mix warmer ${opening} wider and make it brighter`, ['warm', 'bright']],
            [`make this mix warmer ${opening} wider; make it punchier`, ['warm', 'punchy']],
            [`make this mix warmer ${opening} wider but punchier`, ['warm', 'punchy']],
            [`make this mix warmer ${opening}`, ['warm']],
            [`${opening}. Make it wider`, ['wide']],
            [`make this mix warmer. ${opening} wider`, ['warm']],
            [`do not make this mix warmer ${opening} wider`, []],
            [`keep this mix warmer ${opening} wider`, []],
            [`make this mix less warm ${opening} wider`, []],
            [`make this mix warmer ${opening.toUpperCase().replaceAll(' ', '  ')} wider`, ['warm']],
        ])('preserves the polarity and clause boundaries of "%s"', (prompt, expected) => {
            expect(readDescriptors(prompt)).toEqual(expected);
        });

        it.each(['only', 'just', 'merely', 'simply', 'solely', 'exclusively'])(
            'keeps a complete not %s correlative additive beside an exclusion',
            (focus) => {
                expect(readDescriptors(`make this mix not ${focus} warmer but also punchier ${opening} wider`)).toEqual(
                    ['warm', 'punchy']
                );
                expect(readDescriptors(`make this mix not ${focus} warmer ${opening} wider but also punchier`)).toEqual(
                    ['warm', 'punchy']
                );
            }
        );

        it('does not read an exclusion inside a track name or quotation as grammar', () => {
            trackStore.set({
                tracks: [createTrack({ id: 'named', name: `Warmer ${opening} wider` })],
                selectedTrackId: null,
                ghostClips: [],
            });
            expect(readDescriptors(`make Warmer ${opening} wider punchier`)).toEqual(['punchy']);
            expect(readDescriptors(`make "warmer ${opening} wider" punchier`)).toEqual(['punchy']);
            expect(readDescriptors(`make this mix warmer ${opening} "wider and make it brighter"`)).toEqual(['warm']);
        });
    });

    it.each(['over', 'versus'])("does not treat the ambiguous comparison '%s' as an exclusion", (comparison) => {
        expect(readDescriptors(`make this mix warmer ${comparison} wider`)).toEqual(['warm', 'wide']);
    });

    describe.each(['not only', 'not just', 'not merely', 'not simply', 'not solely', 'not exclusively'])(
        '%s correlatives',
        (opening) => {
            describe.each([' but', ' but also', ', but', ', but also'])('the correlative connector %s', (connector) => {
                const pair = `${opening} warmer${connector} wider`;

                it.each([
                    [`make this mix ${pair}`, ['warm', 'wide']],
                    [`make this mix ${opening} less warm${connector} wider`, ['wide']],
                    [`make this mix ${opening} warmer${connector} less wide`, ['warm']],
                    [
                        `MAKE this mix ${opening.toUpperCase().replace(' ', '  ')} warmer ${connector.toUpperCase()} wider`,
                        ['warm', 'wide'],
                    ],
                    [`do not make this mix ${pair}`, []],
                    [`without making this mix ${pair}`, []],
                    [`keep this mix ${pair}`, []],
                    [`make this mix ${opening} warmer${connector} not wider`, ['warm']],
                    [`make this mix ${opening} not warmer${connector} wider`, ['wide']],
                    [`make this mix ${opening} warmer${connector} keep it wide`, ['warm']],
                    [`do not make this mix ${pair}; make it punchier`, ['punchy']],
                    [`keep this mix ${pair} and make it punchier`, ['punchy']],
                ])('preserves the polarity of "%s"', (prompt, expected) => {
                    expect(readDescriptors(prompt)).toEqual(expected);
                });

                it('keeps name and quotation masking ahead of descriptor discovery', () => {
                    trackStore.set({
                        tracks: [createTrack({ id: 'named', name: 'Warmer' })],
                        selectedTrackId: null,
                        ghostClips: [],
                    });
                    expect(readDescriptors(`make this mix ${opening} Warmer${connector} wider`)).toEqual(['wide']);
                    expect(readDescriptors(`do not make this mix ${opening} Warmer${connector} wider`)).toEqual([]);
                    expect(readDescriptors(`make this mix ${opening} "warmer"${connector} wider`)).toEqual(['wide']);
                    expect(readDescriptors(`do not make this mix ${opening} "warmer"${connector} wider`)).toEqual([]);
                    expect(
                        readDescriptors(`do not make this mix ${opening} "warmer, not darker"${connector} wider`)
                    ).toEqual([]);
                    trackStore.set({
                        tracks: [createTrack({ id: 'named', name: 'Warmer but darker' })],
                        selectedTrackId: null,
                        ghostClips: [],
                    });
                    expect(
                        readDescriptors(`do not make this mix ${opening} Warmer but darker${connector} wider`)
                    ).toEqual([]);
                });

                it('does not read the second named operand as a new instruction', () => {
                    trackStore.set({
                        tracks: [createTrack({ id: 'named', name: 'Make Warmer' })],
                        selectedTrackId: null,
                        ghostClips: [],
                    });
                    expect(readDescriptors(`make this mix ${opening} darker${connector} Make Warmer`)).toEqual([
                        'dark',
                    ]);
                    expect(readDescriptors(`do not make this mix ${opening} darker${connector} Make Warmer`)).toEqual(
                        []
                    );
                    expect(readDescriptors(`make this mix ${opening} darker${connector} "make warmer"`)).toEqual([
                        'dark',
                    ]);
                    expect(readDescriptors(`do not make this mix ${opening} darker${connector} "make warmer"`)).toEqual(
                        []
                    );
                    trackStore.set({
                        tracks: [createTrack({ id: 'named', name: 'Also Warmer' })],
                        selectedTrackId: null,
                        ghostClips: [],
                    });
                    expect(readDescriptors(`make this mix ${opening} darker${connector} Also Warmer`)).toEqual([
                        'dark',
                    ]);
                    expect(readDescriptors(`do not make this mix ${opening} darker${connector} Also Warmer`)).toEqual(
                        []
                    );
                });
            });

            it.each([
                [`make it ${opening} warmer but also`, []],
                [`make it ${opening} warmer, but`, []],
                [`make it ${opening} warmer. But wider`, ['wide']],
                [`make it ${opening} warmer and make it wider`, ['wide']],
                ['do not make it warmer, but make it wider', ['wide']],
                [`make it ${opening} warmer but make it wider`, ['wide']],
            ])('does not join incomplete or independent clauses in "%s"', (prompt, expected) => {
                expect(readDescriptors(prompt)).toEqual(expected);
            });
        }
    );
});
