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
        ['Mute Vocals and Keys, then pan them like Drums on their own', 'pan them like Drums on their own'],
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
