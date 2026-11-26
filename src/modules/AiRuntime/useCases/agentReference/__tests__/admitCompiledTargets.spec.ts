import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import {
    createCompiledTargetAdmission,
    type CompiledSelectorTerms,
    type CompiledTargetAuthority,
    type CompiledTargetCallTerms,
} from '../admitCompiledTargets';

function createTrack(id: string, name: string, overrides: Partial<ProjectContextTrack> = {}): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: overrides.devices?.length ?? 0,
        clips: [],
        devices: [],
        ...overrides,
    };
}

function createProjectContext(tracks: ProjectContextTrack[]): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 16,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 0.8,
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'mix',
        playheadPosition: 0,
    };
}

function createAdmission(prompt: string) {
    return createCompiledTargetAdmission({
        catalog: getExecutableAppActionGroundingCatalog(),
        compilerExcludedIds: new Set(),
        prompt,
        valueTexts: [],
    });
}

const ADMITTED: CompiledTargetAuthority = { status: 'admitted' };
const PROTECTED: CompiledTargetAuthority = { status: 'refused', reason: 'protected-or-excluded' };
const UNAUTHORIZED: CompiledTargetAuthority = { status: 'refused', reason: 'unauthorized' };

/**
 * Admits the calls in order through one batch admission, and each alone through a fresh one: a call
 * reusing a reading taken for other terms answers what the request said about those terms instead.
 */
function admitInOneBatch(prompt: string, calls: readonly CompiledTargetCallTerms[]) {
    const batch = createAdmission(prompt);
    return calls.map((call) => ({ batch: batch(call), fresh: createAdmission(prompt)(call) }));
}

const MUTE_PROMPT = 'Mute every track; leave Bass alone';

/** Bass protected by name, beside the same project once that track is called Synth. */
const namedBass = createProjectContext([createTrack('track-bass', 'Bass'), createTrack('track-keys', 'Keys')]);
const renamedBass = createProjectContext([createTrack('track-bass', 'Synth'), createTrack('track-keys', 'Keys')]);

function muteTerms(context: ProjectContext, targetId: string): CompiledTargetCallTerms {
    return { argument: 'trackId', capability: 'track', context, referenceResolved: true, targetIds: [targetId] };
}

describe('compiled target admission across one batch', () => {
    it('reads the request against the project each call names, never one an earlier call read', () => {
        const admission = createAdmission(MUTE_PROMPT);

        expect(admission(muteTerms(namedBass, 'track-bass'))).toEqual(PROTECTED);
        expect(admission(muteTerms(renamedBass, 'track-bass'))).toEqual(ADMITTED);
        expect(createAdmission(MUTE_PROMPT)(muteTerms(renamedBass, 'track-bass'))).toEqual(ADMITTED);
    });

    it('checks each call of one reading against its own targets', () => {
        const admission = createAdmission(MUTE_PROMPT);

        expect(admission(muteTerms(namedBass, 'track-keys'))).toEqual(ADMITTED);
        expect(admission(muteTerms(namedBass, 'track-bass'))).toEqual(PROTECTED);
    });

    it("reads a selector's name picks for the argument it resolves, never for another argument of its call", () => {
        // The selector picks tracks by "Guitar", which the request never states; it resolves only `trackId`.
        const guitarTracks: CompiledSelectorTerms = {
            targetArgument: 'trackId',
            match: { all: [{ nameIncludes: 'Guitar' }] },
        };
        const context = createProjectContext([
            createTrack('track-guitar-1', 'Guitar 1'),
            createTrack('bus-guitar', 'Guitar Bus', { kind: 'bus' }),
        ]);
        const call = (argument: string, targetId: string): CompiledTargetCallTerms => ({
            argument,
            capability: 'track',
            context,
            referenceResolved: false,
            selectorTerms: guitarTracks,
            targetIds: [targetId],
        });

        const verdicts = admitInOneBatch('Send every track to the bus', [
            call('trackId', 'track-guitar-1'),
            call('busId', 'bus-guitar'),
        ]);

        expect(verdicts).toEqual([
            { batch: UNAUTHORIZED, fresh: UNAUTHORIZED },
            { batch: ADMITTED, fresh: ADMITTED },
        ]);
    });

    it('reads the owner track each call depends on, never the owner an earlier call depended on', () => {
        // The selector picks devices by "EQ"; the request names the Vocals track as their owner.
        const equalizers: CompiledSelectorTerms = {
            targetArgument: 'deviceId',
            match: { all: [{ nameIncludes: 'EQ' }] },
        };
        const eqTrack = (id: string, name: string) =>
            createTrack(id, name, {
                devices: [{ id: `${id}-eq`, name: 'EQ', type: 'builtin-eq', bypassed: false }],
            });
        const context = createProjectContext([eqTrack('track-vocals', 'Vocals'), eqTrack('track-keys', 'Keys')]);
        const call = (dependencyId: string | undefined): CompiledTargetCallTerms => ({
            argument: 'deviceId',
            capability: 'device',
            context,
            dependencyId,
            referenceResolved: false,
            selectorTerms: equalizers,
            targetIds: ['track-keys-eq'],
        });
        const prompt = 'Bypass the EQ on Vocals';

        // A dependency fixes the owner, so the request's owner track no longer narrows the pick.
        expect(admitInOneBatch(prompt, [call('track-keys'), call(undefined)])).toEqual([
            { batch: ADMITTED, fresh: ADMITTED },
            { batch: UNAUTHORIZED, fresh: UNAUTHORIZED },
        ]);
        expect(admitInOneBatch(prompt, [call(undefined), call('track-keys')])).toEqual([
            { batch: UNAUTHORIZED, fresh: UNAUTHORIZED },
            { batch: ADMITTED, fresh: ADMITTED },
        ]);
    });
});

const vocals = createTrack('track-vocals', 'Vocals');
const keys = createTrack('track-keys', 'Keys');
const drums = createTrack('track-drums', 'Drums');
const mix = createProjectContext([vocals, keys, drums]);
const band = createProjectContext([createTrack('track-bass', 'Bass'), keys, drums]);

function roleTrack(id: string, name: string, role: string, devices: ProjectContextTrack['devices'] = []) {
    return createTrack(id, name, {
        devices,
        canonicalRole: { role, source: 'authored', evidence: 'authored-role' },
    });
}

const leadVox = roleTrack('track-lead-vox', 'Lead Vox', 'lead vocal', [
    { id: 'device-lead-eq', name: 'EQ', type: 'builtin-eq', bypassed: false },
]);
const backingVox = roleTrack('track-bv', 'BV', 'backing vocal', [
    { id: 'device-bv-eq', name: 'EQ', type: 'builtin-eq', bypassed: false },
]);
const untagged = createTrack('track-untagged', 'Untagged');
const roles = createProjectContext([leadVox, backingVox, untagged]);

/** Where the prompt states the clause, as the direct route hands a call its instruction. */
function clauseOf(prompt: string, clause: string): { start: number; end: number } {
    const start = prompt.indexOf(clause);
    if (start < 0) {
        throw new Error(`"${clause}" is not in "${prompt}"`);
    }
    return { start, end: start + clause.length };
}

function trackNamed(name: string): CompiledSelectorTerms {
    return { targetArgument: 'trackId', where: { name } };
}

function pickTerms(
    selectorTerms: CompiledSelectorTerms,
    targetIds: readonly string[],
    instruction: { start: number; end: number } | undefined,
    context: ProjectContext = mix
): CompiledTargetCallTerms {
    return {
        argument: 'trackId',
        capability: 'track',
        context,
        referenceResolved: false,
        selectorTerms,
        instruction,
        targetIds,
    };
}

function admitPick(
    prompt: string,
    clause: string,
    terms: (instruction: { start: number; end: number }) => CompiledTargetCallTerms
) {
    return createAdmission(prompt)(terms(clauseOf(prompt, clause)));
}

describe('a compiled pick reads the request less the other instructions that name their own tracks', () => {
    it('admits Keys for "Mute Vocals. Keys too.", whose second sentence gives no instruction', () => {
        expect(
            admitPick('Mute Vocals. Keys too.', 'Mute Vocals', (instruction) =>
                pickTerms(trackNamed('Keys'), ['track-keys'], instruction)
            )
        ).toEqual(ADMITTED);
    });

    it.each([
        ['Mute Vocals and Keys, then pan them like Drums', 'pan them like Drums'],
        ['Mute Vocals and Keys, then lower their volume like Drums', 'lower their volume like Drums'],
        ['Mute Vocals and Keys, then pan those like Drums', 'pan those like Drums'],
        ['Mute Keys, then pan it like Drums', 'pan it like Drums'],
        ['Mute Keys, then pan that track like Drums', 'pan that track like Drums'],
        ['Mute Vocals and Keys, then pan them like Drums with its width', 'pan them like Drums with its width'],
    ])('admits Keys for "%s", which refers back before it names Drums', (prompt, clause) => {
        expect(
            admitPick(prompt, clause, (instruction) => pickTerms(trackNamed('Keys'), ['track-keys'], instruction))
        ).toEqual(ADMITTED);
    });

    it('refuses Keys for "Mute Keys, then pan Drums like it", which names Drums before referring back', () => {
        expect(
            admitPick('Mute Keys, then pan Drums like it', 'pan Drums like it', (instruction) =>
                pickTerms(trackNamed('Keys'), ['track-keys'], instruction)
            )
        ).toEqual(UNAUTHORIZED);
    });

    it('refuses Keys for "mute Keys and set the pad to 60%", whose own instruction refers back to nothing', () => {
        const padMix = createProjectContext([keys, createTrack('track-synth-pad', 'Synth Pad')]);
        const prompt = 'mute Keys and set the pad to 60%';

        expect(
            admitPick(prompt, 'set the pad to 60%', (instruction) =>
                pickTerms(trackNamed('Keys'), ['track-keys'], instruction, padMix)
            )
        ).toEqual(UNAUTHORIZED);
    });

    it.each([['track-vocals'], ['track-keys']])(
        'admits %s for "Mute Vocals and Keys, then pan them left", which refers back to both',
        (targetId) => {
            const name = targetId === 'track-vocals' ? 'Vocals' : 'Keys';

            expect(
                admitPick('Mute Vocals and Keys, then pan them left', 'pan them left', (instruction) =>
                    pickTerms(trackNamed(name), [targetId], instruction)
                )
            ).toEqual(ADMITTED);
        }
    );

    describe('another instruction stating a track by fragment counts as naming it', () => {
        const padMix = createProjectContext([keys, createTrack('track-synth-pad', 'Synth Pad')]);
        const padFragment: CompiledSelectorTerms = {
            targetArgument: 'trackId',
            match: { all: [{ nameIncludes: 'pad' }] },
        };

        it('refuses the pad for "set Keys volume to 75% and mute the pad"', () => {
            expect(
                admitPick('set Keys volume to 75% and mute the pad', 'set Keys volume to 75%', (instruction) =>
                    pickTerms(padFragment, ['track-synth-pad'], instruction, padMix)
                )
            ).toEqual(UNAUTHORIZED);
        });

        it('refuses the choir for "set Keys volume to 75% and mute the choir", a fragment no role states', () => {
            const choirMix = createProjectContext([keys, createTrack('track-warm-choir', 'Warm Choir')]);
            const choirFragment: CompiledSelectorTerms = {
                targetArgument: 'trackId',
                match: { all: [{ nameIncludes: 'choir' }] },
            };

            expect(
                admitPick('set Keys volume to 75% and mute the choir', 'set Keys volume to 75%', (instruction) =>
                    pickTerms(choirFragment, ['track-warm-choir'], instruction, choirMix)
                )
            ).toEqual(UNAUTHORIZED);
        });

        it('refuses Keys for "Mute Keys, then mute the kick, then pan it left", whose "it" is the kick', () => {
            const kickMix = createProjectContext([keys, roleTrack('track-bd', 'BD', 'kick')]);
            const prompt = 'Mute Keys, then mute the kick, then pan it left';

            expect(
                admitPick(prompt, 'pan it left', (instruction) =>
                    pickTerms(trackNamed('Keys'), ['track-keys'], instruction, kickMix)
                )
            ).toEqual(UNAUTHORIZED);
        });

        it('admits the pad for "set the pad to 60% and mute Keys"', () => {
            expect(
                admitPick('set the pad to 60% and mute Keys', 'set the pad to 60%', (instruction) =>
                    pickTerms(padFragment, ['track-synth-pad'], instruction, padMix)
                )
            ).toEqual(ADMITTED);
        });
    });

    describe('a back-reference reads only the nearest earlier instruction naming tracks', () => {
        it('refuses Keys for "pan them left, then mute Keys", whose "them" has nothing before it', () => {
            expect(
                admitPick('pan them left, then mute Keys', 'pan them left', (instruction) =>
                    pickTerms(trackNamed('Keys'), ['track-keys'], instruction)
                )
            ).toEqual(UNAUTHORIZED);
        });

        it.each([
            ['Mute Vocals. Mute Keys. Pan them left.', 'Pan them left', 'Vocals', ADMITTED],
            ['Mute Vocals. Mute Keys. Pan them left.', 'Pan them left', 'Keys', ADMITTED],
            ['Mute Vocals. Mute Keys. Pan it left.', 'Pan it left', 'Vocals', UNAUTHORIZED],
            ['Mute Vocals. Mute Keys. Pan it left.', 'Pan it left', 'Keys', ADMITTED],
            ['Mute Vocals, then mute Keys, then pan both left', 'pan both left', 'Vocals', ADMITTED],
            ['Mute Vocals, then pan both Keys and Drums left', 'pan both Keys and Drums left', 'Vocals', UNAUTHORIZED],
        ])('reads "%s" for the "%s" call on %s', (prompt, clause, name, verdict) => {
            expect(
                admitPick(prompt, clause, (instruction) =>
                    pickTerms(trackNamed(name), [`track-${name.toLowerCase()}`], instruction)
                )
            ).toEqual(verdict);
        });

        it('refuses Keys for "Mute Keys, then pan It left", whose "It" names a track', () => {
            const itMix = createProjectContext([keys, createTrack('track-it', 'It')]);

            expect(
                admitPick('Mute Keys, then pan It left', 'pan It left', (instruction) =>
                    pickTerms(trackNamed('Keys'), ['track-keys'], instruction, itMix)
                )
            ).toEqual(UNAUTHORIZED);
        });

        it('admits Keys for "Mute Keys, then pan the choir like it", whose "choir" starts no word of Bigchoir', () => {
            const choirMix = createProjectContext([keys, createTrack('track-bigchoir', 'Bigchoir')]);

            expect(
                admitPick('Mute Keys, then pan the choir like it', 'pan the choir like it', (instruction) =>
                    pickTerms(trackNamed('Keys'), ['track-keys'], instruction, choirMix)
                )
            ).toEqual(ADMITTED);
        });

        it('admits Keys for the "pan left" call of "Mute Keys, then pan left and it right"', () => {
            expect(
                admitPick('Mute Keys, then pan left and it right', 'pan left', (instruction) =>
                    pickTerms(trackNamed('Keys'), ['track-keys'], instruction)
                )
            ).toEqual(ADMITTED);
        });

        it('refuses Drums for "mute Vocals and Drums, then set Keys volume to 75%", whose mute runs past "and"', () => {
            const prompt = 'mute Vocals and Drums, then set Keys volume to 75%';

            expect(
                admitPick(prompt, 'set Keys volume to 75%', (instruction) =>
                    pickTerms(trackNamed('Drums'), ['track-drums'], instruction)
                )
            ).toEqual(UNAUTHORIZED);
        });

        it('admits Vocals for "Mute Vocals, then set the tempo to 120, then pan them left"', () => {
            const prompt = 'Mute Vocals, then set the tempo to 120, then pan them left';

            expect(
                admitPick(prompt, 'pan them left', (instruction) =>
                    pickTerms(trackNamed('Vocals'), ['track-vocals'], instruction)
                )
            ).toEqual(ADMITTED);
        });

        it('admits Bass for a list line that holds a later clause, read back to as one instruction', () => {
            const prompt = 'Mute these tracks:\nBass, then solo Keys\npan them left';

            expect(
                admitPick(prompt, 'pan them left', (instruction) =>
                    pickTerms(trackNamed('Bass'), ['track-bass'], instruction, band)
                )
            ).toEqual(ADMITTED);
        });
    });

    describe('a colon list runs to the first line giving an instruction', () => {
        it('refuses Keys for a turn-down whose list holds the line "mute Keys" before more names', () => {
            const prompt = 'Turn down these tracks by 3 dB:\nBass\nmute Keys\nDrums';

            expect(
                admitPick(prompt, 'Turn down these tracks by 3 dB', (instruction) =>
                    pickTerms(trackNamed('Keys'), ['track-keys'], instruction, band)
                )
            ).toEqual(UNAUTHORIZED);
        });

        it("refuses Keys for a turn-down after another instruction's list that names Keys", () => {
            const prompt = 'Mute these tracks:\nKeys\nDrums\nturn down Bass by 3 dB';

            expect(
                admitPick(prompt, 'turn down Bass by 3 dB', (instruction) =>
                    pickTerms(trackNamed('Keys'), ['track-keys'], instruction, band)
                )
            ).toEqual(UNAUTHORIZED);
        });

        it('admits Bass for "Turn these down by 3 dB, then mute Keys" over lines no colon introduces', () => {
            const prompt = 'Turn these down by 3 dB, then mute Keys\nBass\nDrums';

            expect(
                admitPick(prompt, 'Turn these down by 3 dB', (instruction) =>
                    pickTerms(trackNamed('Bass'), ['track-bass'], instruction, band)
                )
            ).toEqual(ADMITTED);
        });
    });

    it('reads each instruction of one batch apart, whatever start or end the two share', () => {
        const prompt = 'set Vocals volume to 75% and mute Keys';
        const whole = { start: 0, end: prompt.length };
        const keysPick = trackNamed('Keys');
        const vocalsPick = trackNamed('Vocals');

        expect(
            admitInOneBatch(prompt, [
                pickTerms(keysPick, ['track-keys'], whole),
                pickTerms(keysPick, ['track-keys'], clauseOf(prompt, 'set Vocals volume to 75%')),
            ])
        ).toEqual([
            { batch: ADMITTED, fresh: ADMITTED },
            { batch: UNAUTHORIZED, fresh: UNAUTHORIZED },
        ]);
        expect(
            admitInOneBatch(prompt, [
                pickTerms(vocalsPick, ['track-vocals'], whole),
                pickTerms(vocalsPick, ['track-vocals'], { start: prompt.indexOf('mute Keys'), end: prompt.length }),
            ])
        ).toEqual([
            { batch: ADMITTED, fresh: ADMITTED },
            { batch: UNAUTHORIZED, fresh: UNAUTHORIZED },
        ]);
    });
});

describe('a role-family pick admits only the roles the request narrows the family to', () => {
    const vocalFamily: CompiledSelectorTerms = { targetArgument: 'trackId', match: { all: [{ roleFamily: 'vocal' }] } };

    function familyTerms(selectorTerms: CompiledSelectorTerms, targetIds: readonly string[], argument = 'trackId') {
        return { ...pickTerms(selectorTerms, targetIds, undefined, roles), argument };
    }

    it('refuses a set holding a backing vocal for "group the lead vocal"', () => {
        expect(
            createAdmission('group the lead vocal')(familyTerms(vocalFamily, ['track-lead-vox', 'track-bv']))
        ).toEqual(UNAUTHORIZED);
    });

    it('admits a backing vocal for "turn down the vocals and the lead vocal", which names the family itself', () => {
        expect(
            createAdmission('turn down the vocals and the lead vocal')(familyTerms(vocalFamily, ['track-bv']))
        ).toEqual(ADMITTED);
    });

    it('admits both vocals for "turn down the lead vocal and the backing vocals by 3 dB", which states both roles', () => {
        expect(
            createAdmission('turn down the lead vocal and the backing vocals by 3 dB')(
                familyTerms(vocalFamily, ['track-lead-vox', 'track-bv'])
            )
        ).toEqual(ADMITTED);
    });

    it('refuses the backing vocal for "turn down the lead vocals by 3 dB", the role in its plural', () => {
        expect(createAdmission('turn down the lead vocals by 3 dB')(familyTerms(vocalFamily, ['track-bv']))).toEqual(
            UNAUTHORIZED
        );
    });

    it('refuses a track with no canonical role for "turn down the lead vocal"', () => {
        expect(createAdmission('turn down the lead vocal')(familyTerms(vocalFamily, ['track-untagged']))).toEqual(
            UNAUTHORIZED
        );
    });

    it('reads a family any of the match predicates picks by', () => {
        const anyVocal: CompiledSelectorTerms = {
            targetArgument: 'trackId',
            match: { any: [{ roleFamily: 'vocal' }] },
        };

        expect(createAdmission('turn down the lead vocal')(familyTerms(anyVocal, ['track-bv']))).toEqual(UNAUTHORIZED);
    });

    describe('a narrower role binds only the targets its own family reaches', () => {
        const kick = roleTrack('track-kick', 'Kick', 'kick');
        const band = createProjectContext([leadVox, backingVox, kick, keys]);
        const anyOf = (
            ...predicates: NonNullable<NonNullable<CompiledSelectorTerms['match']>['any']>
        ): CompiledSelectorTerms => ({ targetArgument: 'trackId', match: { any: predicates } });

        it('admits the lead vocal and the kick for "turn down the lead vocal and the drums by 3 dB"', () => {
            const terms = pickTerms(
                anyOf({ roleFamily: 'vocal' }, { roleFamily: 'drums' }),
                ['track-lead-vox', 'track-kick'],
                undefined,
                band
            );

            expect(createAdmission('turn down the lead vocal and the drums by 3 dB')(terms)).toEqual(ADMITTED);
        });

        it('admits the lead vocal and Keys for "turn down the lead vocal and Keys by 3 dB"', () => {
            const terms = pickTerms(
                anyOf({ roleFamily: 'vocal' }, { nameIncludes: 'Keys' }),
                ['track-lead-vox', 'track-keys'],
                undefined,
                band
            );

            expect(createAdmission('turn down the lead vocal and Keys by 3 dB')(terms)).toEqual(ADMITTED);
        });

        it('refuses the backing vocal beside the kick for "turn down the lead vocal and the drums by 3 dB"', () => {
            const terms = pickTerms(
                anyOf({ roleFamily: 'vocal' }, { roleFamily: 'drums' }),
                ['track-bv', 'track-kick'],
                undefined,
                band
            );

            expect(createAdmission('turn down the lead vocal and the drums by 3 dB')(terms)).toEqual(UNAUTHORIZED);
        });
    });

    it("reads a selector's family only for the argument it resolves", () => {
        expect(createAdmission('turn down the lead vocal')(familyTerms(vocalFamily, ['track-bv'], 'busId'))).toEqual(
            ADMITTED
        );
    });

    it('reads the role of the track owning a device the family pick reaches', () => {
        const vocalEqs: CompiledSelectorTerms = {
            targetArgument: 'deviceId',
            match: { all: [{ roleFamily: 'vocal' }] },
        };
        const eqTerms = (targetId: string): CompiledTargetCallTerms => ({
            argument: 'deviceId',
            capability: 'device',
            context: roles,
            referenceResolved: false,
            selectorTerms: vocalEqs,
            targetIds: [targetId],
        });
        const admission = createAdmission('bypass the EQ on the lead vocal');

        expect(admission(eqTerms('device-lead-eq'))).toEqual(ADMITTED);
        expect(admission(eqTerms('device-bv-eq'))).toEqual(UNAUTHORIZED);
    });
});

describe('a role-family pick needs its family stated in its own instruction', () => {
    const kick = roleTrack('track-kick', 'Kick', 'kick');
    const kit = createProjectContext([keys, kick]);
    const drumFamily = (match: 'all' | 'any', targetArgument = 'trackId'): CompiledSelectorTerms => ({
        targetArgument,
        match: { [match]: [{ roleFamily: 'drums' }] },
    });

    it.each([['all' as const], ['any' as const]])(
        'refuses the kick for "set Keys volume to 75% and mute the drums" through match.%s',
        (match) => {
            expect(
                admitPick('set Keys volume to 75% and mute the drums', 'set Keys volume to 75%', (instruction) =>
                    pickTerms(drumFamily(match), ['track-kick'], instruction, kit)
                )
            ).toEqual(UNAUTHORIZED);
        }
    );

    it('refuses the kick for "set Keys volume to 75% and mute the drum tracks", whose family word modifies its noun', () => {
        expect(
            admitPick('set Keys volume to 75% and mute the drum tracks', 'set Keys volume to 75%', (instruction) =>
                pickTerms(drumFamily('all'), ['track-kick'], instruction, kit)
            )
        ).toEqual(UNAUTHORIZED);
    });

    it('refuses the kick as a member of "create VCA group for Keys and mute the drums"', () => {
        expect(
            admitPick('create VCA group for Keys and mute the drums', 'create VCA group for Keys', (instruction) => ({
                ...pickTerms(drumFamily('any', 'trackIds'), ['track-kick'], instruction, kit),
                argument: 'trackIds',
            }))
        ).toEqual(UNAUTHORIZED);
    });

    it('admits the kick for "turn down the drum tracks by 3 dB and mute the drums", which states the family itself', () => {
        const prompt = 'turn down the drum tracks by 3 dB and mute the drums';

        expect(
            admitPick(prompt, 'turn down the drum tracks by 3 dB', (instruction) =>
                pickTerms(drumFamily('all'), ['track-kick'], instruction, kit)
            )
        ).toEqual(ADMITTED);
    });

    it('admits the kick for "turn down the lead vocal and the kit by 3 dB", whose vocal role narrows no drum', () => {
        const prompt = 'turn down the lead vocal and the kit by 3 dB';

        expect(
            admitPick(prompt, prompt, (instruction) => pickTerms(drumFamily('all'), ['track-kick'], instruction, kit))
        ).toEqual(ADMITTED);
    });

    it('admits the kick for "turn the drums down 3 dB"', () => {
        expect(
            admitPick('turn the drums down 3 dB', 'turn the drums down 3 dB', (instruction) =>
                pickTerms(drumFamily('all'), ['track-kick'], instruction, kit)
            )
        ).toEqual(ADMITTED);
    });
});
