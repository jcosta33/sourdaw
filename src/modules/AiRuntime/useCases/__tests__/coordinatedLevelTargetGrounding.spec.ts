import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { groundCompiledCommandBatch } from '../groundCompiledCommandBatch';

/**
 * One level change stated once for a coordinated list of named tracks.
 *
 * "Turn the Drums and the Bass down 3 dB" names two faders and one figure in a
 * single clause. The figure belongs to every member of the list under the same
 * unit, direction and absolute-or-relative reading a single target gets, and
 * each member has to resolve on its own whole name: a list that leaves one
 * member unresolved or ambiguous authorizes nothing, and the model's calls must
 * be exactly the listed tracks with exactly the stated figure.
 *
 * A list adds no grammar a single track lacks: the clause read with the list as
 * one track must already ground on that track, so a wording refused for one
 * track is refused for several.
 *
 * Any other clause that names a list member, for whatever control or purpose,
 * refuses the whole list: the list never decides which of its members such a
 * clause leaves to the stated change. A clause naming only tracks outside the
 * list leaves it to ground, and those tracks keep their own protections.
 */

type ProjectTrack = ProjectContext['tracks'][number];
type ProviderCalls = Parameters<typeof bridgeGroundedLlmToolCalls>[0]['calls'];

const NOT_GROUNDED = 'Provider action is not grounded in the user request';

function createTrack({
    id,
    name,
    kind = 'audio',
    clips = [],
}: {
    id: string;
    name: string;
    kind?: ProjectTrack['kind'];
    clips?: ProjectTrack['clips'];
}): ProjectTrack {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: kind === 'master' ? 'hw_out' : 'master',
        clipCount: clips.length,
        deviceCount: 0,
        clips,
        devices: [],
        sends: [],
    };
}

const drums = createTrack({ id: 'track-drums', name: 'Drums' });
const bass = createTrack({ id: 'track-bass', name: 'Bass' });
const bassDi = createTrack({ id: 'track-bass-di', name: 'Bass DI' });
const bassCommaDi = createTrack({ id: 'track-bass-comma-di', name: 'Bass, DI' });
const rockAndRoll = createTrack({ id: 'track-rock-and-roll', name: 'Rock and Roll' });
const keys = createTrack({ id: 'track-keys', name: 'Keys', kind: 'midi' });
const vocals = createTrack({ id: 'track-vocals', name: 'Vocals' });
const drumBus = createTrack({ id: 'track-drum-bus', name: 'Drum Bus', kind: 'bus' });
const master = createTrack({ id: 'master', name: 'Master', kind: 'master' });

const projectContext: ProjectContext = {
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
    tracks: [drums, bass, bassDi, keys, vocals, drumBus, master],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

/** The fixture with a second track whose whole name is also "Bass". */
const projectWithTwoBassTracks: ProjectContext = {
    ...projectContext,
    tracks: [...projectContext.tracks, createTrack({ id: 'track-bass-2', name: 'Bass' })],
};

const projectWithQuotedOverlap: ProjectContext = {
    ...projectContext,
    tracks: [...projectContext.tracks.filter((track) => track.id !== bassDi.id), bassCommaDi, rockAndRoll],
};

/** The fixture with a VCA group named "Strings": a project reference that names no track. */
const projectWithStringsGroup: ProjectContext = {
    ...projectContext,
    vcaGroups: [{ id: 'vca-strings', name: 'Strings', gain: 1, muted: false, trackIds: [keys.id] }],
};

function bridge(calls: ProviderCalls, prompt: string, context: ProjectContext = projectContext) {
    return bridgeGroundedLlmToolCalls({ calls, prompt, context, markerSignatures: [], sectionSignatures: [] });
}

function gainCall(trackId: string, value: Record<string, number>): ProviderCalls[number] {
    return { name: 'setTrackGain', arguments: { trackId, ...value } };
}

function gainAction(trackId: string, value: Record<string, number>) {
    return { type: 'setTrackGain', payload: { trackId, ...value } };
}

function groundedGainAction(track: ProjectTrack, value: Record<string, number>) {
    return {
        type: 'setTrackGain',
        payload: {
            trackId: track.id,
            ...value,
            expectedGain: track.gain,
            automationRecordingPolicy: 'suppressed',
        },
    };
}

function compileGainList(prompt: string, tracks: ProjectTrack[], context: ProjectContext = projectContext) {
    const compiled = compileArbitraryCommandList({
        context,
        revision: 'revision-coordinated-level',
        calls: [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: {
                        semantic: { classification: 'simple', uncertainty: [] },
                        objective: prompt,
                        constraints: [],
                        scope: {
                            targetIds: tracks.map((track) => track.id),
                            targetRanges: [],
                            protectedTargetIds: [],
                            protectedRanges: [],
                        },
                        capabilityIds: [],
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: [],
                        stoppingConditions: [],
                    },
                    list: {
                        schemaVersion: 1,
                        items: tracks.map((track) => ({
                            id: track.id,
                            name: 'setTrackGain',
                            arguments: { deltaDb: -3 },
                            selector: {
                                targetArgument: 'trackId',
                                entity: 'track',
                                where: { name: track.name },
                                quantity: { unit: 'targets', exactly: 1 },
                            },
                        })),
                    },
                },
            },
        ],
    });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        throw new Error(`Expected the list to compile: ${JSON.stringify(compiled)}`);
    }
    return compiled.compilerEvidence;
}

function bridgeCompiledGainList(prompt: string, tracks: ProjectTrack[], context: ProjectContext = projectContext) {
    const compilerEvidence = compileGainList(prompt, tracks, context);
    return bridgeGroundedLlmToolCalls({
        calls: compilerEvidence.commands,
        compilerEvidence,
        context,
        projectRevision: 'revision-coordinated-level',
        prompt,
    });
}

function groundGainList(
    prompt: string,
    tracks: ProjectTrack[],
    context: ProjectContext = projectContext,
    compiled = false
) {
    const compilerEvidence = compiled ? compileGainList(prompt, tracks, context) : undefined;
    return groundCompiledCommandBatch({
        toolCalls: compilerEvidence?.commands ?? tracks.map((track) => gainCall(track.id, { deltaDb: -3 })),
        compilerEvidence,
        context,
        prompt,
        projectRevision: 'revision-coordinated-level',
        workflowCapabilityId: undefined,
        selectedCompilations: [],
        transformCommands: [],
        transformTargetIds: [],
        creativeAuthority: undefined,
        providerProposal: null,
    });
}

describe('one level change stated for a coordinated list of named tracks', () => {
    it.each([
        ['turn the Drums and the Bass down 3 dB'],
        ['turn Drums and Bass down 3 dB'],
        ['lower Drums and Bass by 3 dB'],
        ['please lower Drums and Bass by 3 dB'],
    ])('grounds "%s" on every listed track', (prompt) => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })], prompt);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 }), gainAction(bass.id, { deltaDb: -3 })]);
    });

    it.each([['set Drums, Bass and Keys volume to -6 dB'], ['set Drums, Bass, and Keys volume to -6 dB']])(
        'grounds an absolute level stated once for the three-member list "%s"',
        (prompt) => {
            const result = bridge(
                [
                    gainCall(drums.id, { gainDb: -6 }),
                    gainCall(bass.id, { gainDb: -6 }),
                    gainCall(keys.id, { gainDb: -6 }),
                ],
                prompt
            );

            expect(result.rejections).toEqual([]);
            expect(result.actions).toEqual([
                gainAction(drums.id, { gainDb: -6 }),
                gainAction(bass.id, { gainDb: -6 }),
                gainAction(keys.id, { gainDb: -6 }),
            ]);
        }
    );

    it('grounds an upward change stated for both members of a list', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: 2 }), gainCall(bass.id, { deltaDb: 2 })],
            'turn both Drums and Bass up 2 dB'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: 2 }), gainAction(bass.id, { deltaDb: 2 })]);
    });

    it.each(['turn Drums and track-bass down 3 dB', 'turn track-bass and Drums down 3 dB'])(
        'binds one shared decibel figure to each whole name or ID in "%s"',
        (prompt) => {
            const result = bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })], prompt);

            expect(result.rejections).toEqual([]);
            expect(result.actions).toEqual([
                gainAction(drums.id, { deltaDb: -3 }),
                gainAction(bass.id, { deltaDb: -3 }),
            ]);
        }
    );

    it.each([
        'turn "Drums" and "Bass" down 3dB',
        'turn “Drums” and “Bass” down 3dB',
        'set "Drums", "Bass", and "Keys" volume to -6 dB',
    ])('binds each complete quoted list member in "%s"', (prompt) => {
        const targets = prompt.startsWith('set ') ? [drums, bass, keys] : [drums, bass];
        const value: Record<string, number> = prompt.startsWith('set ') ? { gainDb: -6 } : { deltaDb: -3 };
        const result = bridge(
            targets.map((track) => gainCall(track.id, value)),
            prompt
        );
        const compiled = prompt.startsWith('set ') ? null : bridgeCompiledGainList(prompt, targets);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual(targets.map((track) => gainAction(track.id, value)));
        if (compiled) {
            expect(compiled.rejections).toEqual([]);
            expect(compiled.actions).toEqual(targets.map((track) => gainAction(track.id, value)));
        }
    });

    it.each(['turn "Drums" and "Bass DI" down 3dB', 'turn "Drums" and "Strings" down 3dB'])(
        'refuses a quoted member outside the complete requested set in "%s"',
        (prompt) => {
            const result = bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })], prompt);
            expect(result.actions).toEqual([]);
            expect(result.rejections).toHaveLength(2);
        }
    );

    it('refuses a quoted member that resolves to two tracks', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn "Drums" and "Bass" down 3dB',
            projectWithTwoBassTracks
        );
        expect(result.actions).toEqual([]);
        expect(result.rejections).toHaveLength(2);
    });

    it.each([
        ['turn Drums and "Bass, DI" down 3 dB', bassCommaDi],
        ['turn Drums and "Rock and Roll" down 3 dB', rockAndRoll],
    ])('binds a quoted member containing a separator as one exact target in "%s"', (prompt, quotedTrack) => {
        const tracks = [drums, quotedTrack];
        const calls = tracks.map((track) => gainCall(track.id, { deltaDb: -3 }));
        const expected = tracks.map((track) => gainAction(track.id, { deltaDb: -3 }));
        const expectedGrounded = tracks.map((track) => groundedGainAction(track, { deltaDb: -3 }));
        const direct = bridge(calls, prompt, projectWithQuotedOverlap);
        const atomicDirect = groundGainList(prompt, tracks, projectWithQuotedOverlap);
        const atomicCompiled = groundGainList(prompt, tracks, projectWithQuotedOverlap, true);
        const missing = groundGainList(prompt, [drums], projectWithQuotedOverlap);

        expect(direct.rejections).toEqual([]);
        expect(direct.actions).toEqual(expected);
        expect(atomicDirect.status).toBe('grounded');
        if (atomicDirect.status === 'grounded') {
            expect(atomicDirect.actions).toEqual(expectedGrounded);
        }
        expect(atomicCompiled.status).toBe('grounded');
        if (atomicCompiled.status === 'grounded') {
            expect(atomicCompiled.actions).toEqual(expectedGrounded);
        }
        expect(missing.status).toBe('rejected');
    });

    it('grounds a list beside a single-track level change in the same request', () => {
        const result = bridge(
            [
                gainCall(vocals.id, { deltaDb: 1 }),
                gainCall(drums.id, { deltaDb: -3 }),
                gainCall(bass.id, { deltaDb: -3 }),
            ],
            'turn Vocals up 1 dB and turn the Drums and the Bass down 3 dB'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            gainAction(vocals.id, { deltaDb: 1 }),
            gainAction(drums.id, { deltaDb: -3 }),
            gainAction(bass.id, { deltaDb: -3 }),
        ]);
    });

    it('grounds the list through a compiled command list', () => {
        const prompt = 'turn the Drums and the Bass down 3 dB';
        const result = bridgeCompiledGainList(prompt, [drums, bass]);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 }), gainAction(bass.id, { deltaDb: -3 })]);
    });

    it('applies the single-target reading rules to every member', () => {
        const prompt = 'turn the Drums and the Bass down 3 dB';

        const wrongDirection = bridge([gainCall(drums.id, { deltaDb: 3 }), gainCall(bass.id, { deltaDb: 3 })], prompt);
        const asDestination = bridge([gainCall(drums.id, { gainDb: -3 }), gainCall(bass.id, { gainDb: -3 })], prompt);
        const asAmplitude = bridge([gainCall(drums.id, { gain: 0.6 }), gainCall(bass.id, { gain: 0.6 })], prompt);

        expect(wrongDirection.actions).toEqual([]);
        expect(asDestination.actions).toEqual([]);
        expect(asAmplitude.actions).toEqual([]);
    });

    it.each([
        ['set Drums to -6 dB', { gainDb: -6 }],
        ['Drums up 2 dB', { deltaDb: 2 }],
    ])('grounds the single track worded as "%s"', (prompt, value) => {
        const result = bridge([gainCall(drums.id, value)], prompt);

        expect(result.actions).toEqual([gainAction(drums.id, value)]);
    });

    it('grounds a list worded "set ... to" as it grounds the same list worded with volume, and holds it to every member', () => {
        const prompt = 'set Drums, Bass and Keys to -6 dB';
        const value = { gainDb: -6 };

        const complete = bridge(
            [drums, bass, keys].map((track) => gainCall(track.id, value)),
            prompt
        );
        const missingMember = bridge(
            [drums, bass].map((track) => gainCall(track.id, value)),
            prompt
        );
        const differingMember = bridge(
            [gainCall(drums.id, value), gainCall(bass.id, value), gainCall(keys.id, { gainDb: -3 })],
            prompt
        );

        expect(complete.actions).toEqual([drums, bass, keys].map((track) => gainAction(track.id, value)));
        expect(missingMember.actions).toEqual([]);
        expect(differingMember.actions).toEqual([]);
    });

    describe.each([
        ['both Drums and Bass up 2 dB', [drums, bass], { deltaDb: 2 }],
        ['Drums, Keys and Bass up 2 dB', [drums, keys, bass], { deltaDb: 2 }],
        ['Drums and Bass down 3 dB', [drums, bass], { deltaDb: -3 }],
        ['Keys and Drums up 2 dB', [keys, drums], { deltaDb: 2 }],
        ['please Drums and Bass up 2 dB', [drums, bass], { deltaDb: 2 }],
    ])('the up/down list "%s"', (prompt, members, value) => {
        it('grounds a change for every member it lists', () => {
            const result = bridge(
                members.map((track) => gainCall(track.id, value)),
                prompt
            );

            expect(result.actions).toEqual(members.map((track) => gainAction(track.id, value)));
        });

        it('never grounds a change for only some of its members', () => {
            const subsets = members.map((_, omitted) => members.filter((__, index) => index !== omitted));
            const singles = members.map((track) => [track]);

            for (const subset of [...subsets, ...singles]) {
                const result = bridge(
                    subset.map((track) => gainCall(track.id, value)),
                    prompt
                );

                expect(result.actions).toEqual([]);
            }
        });
    });

    it('grounds nothing, whole or in part, for an up/down list "both" cannot join', () => {
        const prompt = 'both Drums, Keys and Bass up 2 dB';
        const value = { deltaDb: 2 };

        const whole = bridge(
            [drums, keys, bass].map((track) => gainCall(track.id, value)),
            prompt
        );
        const lastMember = bridge([gainCall(bass.id, value)], prompt);

        expect(whole.actions).toEqual([]);
        expect(lastMember.actions).toEqual([]);
    });

    it('never grounds the tail of a "both" list whose head clause is unread', () => {
        const prompt = 'turn both Drums, Bass and Keys down 3 dB';
        const value = { deltaDb: -3 };

        const tail = bridge(
            [bass, keys].map((track) => gainCall(track.id, value)),
            prompt
        );
        const whole = bridge(
            [drums, bass, keys].map((track) => gainCall(track.id, value)),
            prompt
        );

        expect(tail.actions).toEqual([]);
        expect(whole.actions).toEqual([]);
    });

    it('holds an up/down list to one figure for every member', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: 2 }), gainCall(bass.id, { deltaDb: 3 })],
            'Drums and Bass up 2 dB'
        );

        expect(result.actions).toEqual([]);
    });
});

describe('a coordinated level list refuses calls that do not match it exactly', () => {
    const prompt = 'turn the Drums and the Bass down 3 dB';

    it('refuses a call for a track the list does not name', () => {
        const result = bridge(
            [
                gainCall(drums.id, { deltaDb: -3 }),
                gainCall(bass.id, { deltaDb: -3 }),
                gainCall(keys.id, { deltaDb: -3 }),
            ],
            prompt
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses calls that leave a listed track out', () => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([{ name: 'setTrackGain', reason: NOT_GROUNDED }]);
    });

    it('refuses every call when the listed tracks are given different values', () => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -2 })], prompt);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { index: 0, name: 'setTrackGain', reason: NOT_GROUNDED },
            { index: 1, name: 'setTrackGain', reason: NOT_GROUNDED },
        ]);
    });

    it('refuses the same track called twice in place of the second member', () => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(drums.id, { deltaDb: -3 })], prompt);

        expect(result.actions).toEqual([]);
    });

    it('refuses a track whose name a member only contains', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn the Drums and the Bass DI down 3 dB'
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses a member whose whole reference names another object and only contains a track name', () => {
        // "Bass DI" is one reference, the VCA group's name, and no track carries it, so nothing
        // longer takes the contained "Bass" away from the track resolver's exact-name evidence.
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn the Drums and the Bass DI down 3 dB',
            {
                ...projectContext,
                tracks: [drums, bass, keys],
                vcaGroups: [{ id: 'vca-bass-di', name: 'Bass DI', gain: 1, muted: false, trackIds: [bass.id] }],
            }
        );

        expectNotGrounded(result, 2);
    });

    it('refuses a first member with an unresolved word before a known name', () => {
        const result = bridge(
            [gainCall(bass.id, { deltaDb: -3 }), gainCall(drums.id, { deltaDb: -3 })],
            'lower Acoustic Bass and Drums by 3 dB',
            { ...projectContext, tracks: [bass, drums] }
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses the whole list when one member names two tracks', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            prompt,
            projectWithTwoBassTracks
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses the whole list when one member names no track', () => {
        const unresolvedPrompt = 'turn the Drums and the Strings down 3 dB';

        const unknownWord = bridge([gainCall(drums.id, { deltaDb: -3 })], unresolvedPrompt);
        const withGuess = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(keys.id, { deltaDb: -3 })],
            unresolvedPrompt
        );
        const groupReference = bridge([gainCall(drums.id, { deltaDb: -3 })], unresolvedPrompt, projectWithStringsGroup);

        expect(unknownWord.actions).toEqual([]);
        expect(withGuess.actions).toEqual([]);
        expect(groupReference.actions).toEqual([]);
    });

    it('refuses a list that reaches the master fader through a track call', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(master.id, { deltaDb: -3 })],
            'turn the Drums and the Master down 3 dB'
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses track fader calls for a list whose change names a send', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn the Drums and the Bass send down 3 dB'
        );

        expect(result.actions).toEqual([]);
    });
});

function expectNotGrounded(result: ReturnType<typeof bridge>, callCount: number) {
    expect(result.actions).toEqual([]);
    expect(result.rejections).toMatchObject(
        Array.from({ length: callCount }, (_, index) => ({ index, name: 'setTrackGain', reason: NOT_GROUNDED }))
    );
}

describe('a coordinated level list refuses itself when another clause names a member', () => {
    it.each([
        'turn the Drums and the Bass down 3 dB but not the Bass',
        'turn the Drums and the Bass down 3 dB but leave the Bass alone',
        'turn the Drums and the Bass down 3 dB but leave the Bass pan alone',
        'turn the Drums and the Bass down 3 dB and mute the Bass later',
        'turn the Drums and the Bass down 3 dB and keep the Bass',
        'turn the Drums and the Bass down 3 dB, but leave the Bass gain unchanged',
        'turn the Drums and the Bass down 3 dB, but do not mute Bass',
        'turn the Drums and the Bass down 3 dB; solo everything with the exception of Bass',
        'turn Drums and Bass down 3 dB; do not change Drums gain and Bass pan',
        'turn Drums and Bass down 3 dB; do not change the pan and solo and fader of "Bass"',
        'turn Drums and Bass down 3 dB; leave track-bass pan and fader unchanged',
        'turn Drums and Bass down 3 dB; do not change Vocals gain after adjusting Bass pan',
        'turn Drums and Bass down 3 dB; do not mute Bass once gain is adjusted',
        'turn Drums and Bass down 3 dB; do not change Bass pan and Strings fader',
        'set Drums and Bass volume to -6 dB; leave Bass pan and solo and fader unchanged',
    ])('refuses every call for the list in "%s"', (prompt) => {
        const value: Record<string, number> = prompt.startsWith('set ') ? { gainDb: -6 } : { deltaDb: -3 };

        expectNotGrounded(bridge([gainCall(drums.id, value), gainCall(bass.id, value)], prompt), 2);
        expectNotGrounded(bridge([gainCall(drums.id, value)], prompt), 1);
        expectNotGrounded(bridge([gainCall(bass.id, value)], prompt), 1);
    });

    it.each([
        'turn the Drums and the Bass down 3 dB but not the Bass',
        'turn Drums and Bass down 3 dB; leave Bass pan and fader alone',
        'turn Drums and Bass down 3 dB; do not change Vocals gain after adjusting Bass pan',
    ])('refuses the list through the compiled and atomic routes in "%s"', (prompt) => {
        for (const compiled of [
            bridgeCompiledGainList(prompt, [drums, bass]),
            bridgeCompiledGainList(prompt, [drums]),
        ]) {
            expect(compiled.actions).toEqual([]);
            expect(compiled.rejections).not.toEqual([]);
        }
        expect(groundGainList(prompt, [drums, bass]).status).toBe('rejected');
        expect(groundGainList(prompt, [drums]).status).toBe('rejected');
        expect(groundGainList(prompt, [drums, bass], projectContext, true).status).toBe('rejected');
        expect(groundGainList(prompt, [drums], projectContext, true).status).toBe('rejected');
    });

    it('refuses the list when another clause names a member as the selected track', () => {
        const prompt = 'turn the Drums and the Bass down 3 dB but leave this track alone';
        const bassSelected = { ...projectContext, selectedTrackId: bass.id };

        expectNotGrounded(
            bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })], prompt, bassSelected),
            2
        );
        expectNotGrounded(bridge([gainCall(drums.id, { deltaDb: -3 })], prompt, bassSelected), 1);
    });

    it.each([
        'except Bass',
        'excluding Bass',
        'besides Bass',
        'minus Bass',
        'other than Bass',
        'rather than Bass',
        'apart from Bass',
        'save for Bass',
        'with exception of Bass',
        'with the exception of Bass',
        'all but Bass',
        'not including Bass',
        'keep Bass unchanged',
        'preserve Bass',
        'retain Bass',
    ])('refuses the whole list when the restriction phrase "%s" names a member', (restriction) => {
        const prompt = `turn the Drums and the Bass down 3 dB, ${restriction}`;

        expectNotGrounded(bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })], prompt), 2);
        expectNotGrounded(bridge([gainCall(drums.id, { deltaDb: -3 })], prompt), 1);
    });
});

describe('a coordinated level list refuses itself when a member is singled out without a name', () => {
    it.each([
        'turn the Drums and the Bass down 3 dB but not the second one',
        'turn the Drums and the Bass down 3 dB but not the latter',
        'turn the Drums and the Bass down 3 dB except the last one',
        'turn the Drums and the Bass down 3 dB, excluding the second',
        'turn the Drums and the Bass down 3 dB and leave the other alone',
        'turn the Drums and the Bass down 3 dB but leave one of them alone',
        'turn the Drums and the Bass down 3 dB and 6 dB respectively',
        'turn the Drums and the Bass down 3 dB and 6 dB',
        'turn the Drums and the Bass down 3 dB, 6 dB',
        'turn the Drums and the Bass down 3 dB, the latter by 6',
        'turn the Drums and the Bass down 3 dB (6 dB for the second)',
        'turn the Drums and the Bass down 3 dB, and 6 dB for the second',
        'turn Drums and Bass down 3 dB, then up 1 dB',
    ])('refuses every call for the list in "%s"', (prompt) => {
        expectNotGrounded(bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })], prompt), 2);
    });

    it.each([
        'turn the Drums and the Bass down 3 dB and pan the Keys left',
        'turn the Drums and the Bass down 3 dB and leave the Keys alone',
    ])('grounds the list when the other clause names a track outside it in "%s"', (prompt) => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })], prompt);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 }), gainAction(bass.id, { deltaDb: -3 })]);
    });

    it('refuses a member singled out without a name through a compiled command list', () => {
        const compiled = bridgeCompiledGainList('turn the Drums and the Bass down 3 dB but not the second one', [
            drums,
            bass,
        ]);

        expect(compiled.actions).toEqual([]);
        expect(compiled.rejections).not.toEqual([]);
    });

    it('grounds a compiled list when the other clause names a track outside it', () => {
        const compiled = bridgeCompiledGainList('turn the Drums and the Bass down 3 dB and pan the Keys left', [
            drums,
            bass,
        ]);

        expect(compiled.rejections).toEqual([]);
        expect(compiled.actions).toEqual([gainAction(drums.id, { deltaDb: -3 }), gainAction(bass.id, { deltaDb: -3 })]);
    });
});

describe('a coordinated level list keeps the protections of tracks outside it', () => {
    it.each([
        'turn Drums and Bass down 3 dB; do not change pan, solo, and fader of Strings',
        'turn Drums and Bass down 3 dB; leave Bass DI pan and fader unchanged',
    ])('refuses the list when a clause of a restriction names no track in "%s"', (prompt) => {
        // "solo" and "fader unchanged" are clauses of their own that name no track outside the
        // list, so they could be singling out a member; the list grounds nothing.
        expectNotGrounded(bridge([gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })], prompt), 2);
    });

    it('does not protect Bass from gain when the separate restriction names Bass DI', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn Drums and Bass down 3 dB; leave Bass DI pan unchanged'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 }), gainAction(bass.id, { deltaDb: -3 })]);
    });

    it.each([
        ['turn Drums and Bass down 3 dB; leave Vocals fader unchanged after adjusting Keys pan', projectContext],
        [
            'turn the Drums and the Bass down 3 dB but leave this track alone',
            { ...projectContext, selectedTrackId: keys.id },
        ],
    ])('grounds both listed tracks when another clause names only a track outside it in "%s"', (prompt, context) => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            prompt,
            context
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 }), gainAction(bass.id, { deltaDb: -3 })]);
    });

    it('grounds the list beside a change for a track another clause names', () => {
        const result = bridge(
            [
                gainCall(drums.id, { deltaDb: -3 }),
                gainCall(bass.id, { deltaDb: -3 }),
                { name: 'setTrackPan', arguments: { trackId: keys.id, pan: -50 } },
            ],
            'turn the Drums and the Bass down 3 dB and pan the Keys left'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            gainAction(drums.id, { deltaDb: -3 }),
            gainAction(bass.id, { deltaDb: -3 }),
            { type: 'setTrackPan', payload: { trackId: keys.id, pan: -50 } },
        ]);
    });

    it('keeps quoted restriction vocabulary inert', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn the Drums and the Bass down 3 dB and rename Vocals to "with the exception of Bass"'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 }), gainAction(bass.id, { deltaDb: -3 })]);
    });

    it('refuses a protected track the list does not name', () => {
        const result = bridge(
            [
                gainCall(drums.id, { deltaDb: -3 }),
                gainCall(bass.id, { deltaDb: -3 }),
                gainCall(drumBus.id, { deltaDb: -3 }),
            ],
            'turn the Drums and the Bass down 3 dB and leave the Drum Bus alone'
        );

        expect(result.actions).not.toContainEqual(gainAction(drumBus.id, { deltaDb: -3 }));
    });

    it('grounds the list when the protection names a track outside it', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn the Drums and the Bass down 3 dB and leave the Drum Bus alone'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 }), gainAction(bass.id, { deltaDb: -3 })]);
    });
});

/**
 * An explicit protection is only as good as the references it binds. One holding a concrete reference
 * that binds to nothing (a quoted or capitalized name no object carries, a position, a selection phrase
 * with nothing selected) cannot be enforced, so the request grounds nothing: an incomplete protection
 * is a rejection, never an empty permission set, for one target, a coordinated list and every route
 * alike. Anything else a protection holds is no target and never refuses: a quality, the rest of the
 * mix, a project setting, filler, a kind noun beside a name, or the selected clip.
 */
describe('an explicit protection naming a reference that binds to nothing refuses the request', () => {
    const unresolvedProtections: Array<[string, string, ProjectContext]> = [
        ['do not change pan, solo, and fader of Strings', 'Strings', projectContext],
        ['leave Keys as well as the first track alone', 'first track', projectContext],
        ['leave Keys along with the second track alone', 'second track', projectContext],
        ['leave Keys as well as the last one alone', 'last one', projectContext],
        ['leave the Keys alone except the second one', 'second one', projectContext],
        ['leave Keys and Ghost alone', 'Ghost', projectContext],
        ['leave Ghost alone', 'Ghost', projectContext],
        ['leave the Kick alone', 'Kick', projectContext],
        ["leave Ghost's fader alone", 'Ghost', projectContext],
        ['leave Ghost and keep Keys alone', 'Ghost', projectContext],
        ['leave Ghost then Keys alone', 'Ghost', projectContext],
        ['leave Ghost; keep Keys alone', 'Ghost', projectContext],
        ['without touching Ghost', 'Ghost', projectContext],
        ['leave Ghost be', 'Ghost', projectContext],
        ['leave track 3 alone', 'track 3', projectContext],
    ];

    function expectRefusedNamingReference(result: ReturnType<typeof bridge>, reference: string) {
        expect(result.actions).toEqual([]);
        expect(result.rejections).toEqual([
            { index: 0, name: '<batch>', reason: expect.stringContaining(`"${reference}"`) },
        ]);
    }

    it.each(unresolvedProtections)(
        'refuses one target when the protection "%s" cannot bind %s',
        (protection, reference, context) => {
            const prompt = `turn the Drums down 3 dB; ${protection}`;

            expectRefusedNamingReference(bridge([gainCall(drums.id, { deltaDb: -3 })], prompt, context), reference);
        }
    );

    it.each(unresolvedProtections.map(([protection, , context]) => ({ protection, context })))(
        'refuses a coordinated list when the protection "$protection" cannot bind',
        ({ protection, context }) => {
            const prompt = `turn the Drums and the Bass down 3 dB and ${protection}`;
            const result = bridge(
                [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
                prompt,
                context
            );

            // A list already refuses a clause naming a track beside it, so the reason may be either.
            expect(result.actions).toEqual([]);
            expect(result.rejections).not.toEqual([]);
        }
    );

    it.each([
        ['turn the Drums down 3 dB and leave Keys as well as the first track alone', [drums]],
        ['turn the Drums and the Bass down 3 dB and leave Keys plus it alone', [drums, bass]],
    ])('refuses the compiled and atomic routes in "%s"', (prompt, tracks) => {
        const compiled = bridgeCompiledGainList(prompt, tracks);

        expect(compiled.actions).toEqual([]);
        expect(compiled.rejections).not.toEqual([]);
        expect(groundGainList(prompt, tracks).status).toBe('rejected');
        expect(groundGainList(prompt, tracks, projectContext, true).status).toBe('rejected');
    });

    it('names every unbound reference of the request', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 })],
            'turn the Drums down 3 dB and leave Ghost alone; do not change the fader of the second one'
        );

        expect(result.rejections).toEqual([
            { index: 0, name: '<batch>', reason: expect.stringMatching(/"Ghost", "second one"/u) },
        ]);
    });

    it.each([
        'turn the Drums down 3 dB and leave Keys as well as the Vocals alone',
        'turn the Drums down 3 dB and leave Keys, Vocals and the Drum Bus alone',
        'turn the Drums down 3 dB; do not change pan, solo, and fader of Keys',
        'turn the Drums down 3 dB and leave "Bass DI" and Keys unchanged',
        'turn the Drums down 3 dB; with Keys unchanged',
        'turn the Drums down 3 dB and Keys stays as is',
        'turn the Drums down 3 dB, no changes to Keys',
        'turn the Drums down 3 dB; without touching Keys',
        'turn the Drums down 3 dB and leave Keys untouched',
        'turn the Drums down 3 dB and leave Keys be',
        'turn the Drums down 3 dB; Keys should not change',
        'turn the Drums down 3 dB but not the Keys',
        'turn the Drums down 3 dB and leave Keys and keep Vocals alone',
    ])('still grounds the asked change when every protected reference binds in "%s"', (prompt) => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
    });

    it.each([
        // qualities and aesthetics
        'keep it warm',
        'keep the groove intact',
        "don't change the vibe",
        'leave the Tone alone',
        // the rest of the mix
        'keep the rest alone',
        'leave anything else alone',
        'leave the rest of the song alone',
        'keep everything else unchanged except the Keys',
        // project settings
        'keep the tempo as is',
        'keep the BPM the same',
        // filler and kind nouns around a bound name
        'leave my Keys alone',
        'leave the Keys track and the Vocals channel alone',
        'keep the Keys at the same level',
        'leave the Drum Bus alone',
        // notes, markers and the selected clip
        "don't edit the Keys MIDI",
        'keep the selected clip as is',
        // the keep, leave and alone words outside any protection
        'keep going',
        'keep it simple',
        'leave it at that',
        'leave room for the Keys',
        'rename Vocals to "leave Ghost alone"',
    ])('does not refuse the asked change over "%s", which names no target', (extra) => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 })], `turn the Drums down 3 dB; ${extra}`);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
    });

    it.each([
        'turn the Drums down 3 dB and leave Rock and Roll alone',
        'turn the Drums down 3 dB and leave "Rock and Roll" unchanged',
        'turn the Drums down 3 dB, leave Keys and Rock and Roll alone',
    ])('binds a name that holds a stop word whole in "%s"', (prompt) => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt, projectWithQuotedOverlap);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
    });

    it.each([
        ['turn the Drums down 3 dB and leave Keys as well as the Vocals alone', vocals],
        ['turn the Drums down 3 dB and leave Keys along with the Bass alone', bass],
        ['turn the Drums down 3 dB; do not change pan, solo, and fader of Keys', keys],
    ])('still refuses an extra call on a track the bound protection names in "%s"', (prompt, protectedTrack) => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(protectedTrack.id, { deltaDb: -3 })],
            prompt
        );

        expect(result.actions).not.toContainEqual(gainAction(protectedTrack.id, { deltaDb: -3 }));
    });

    it('binds a selection phrase through the selected track, and protects that track', () => {
        const prompt = 'turn the Drums down 3 dB and leave this track alone';
        const bassSelected = { ...projectContext, selectedTrackId: bass.id };
        const drumsSelected = { ...projectContext, selectedTrackId: drums.id };

        const protectsOther = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt, bassSelected);
        expect(protectsOther.rejections).toEqual([]);
        expect(protectsOther.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
        expect(bridge([gainCall(bass.id, { deltaDb: -3 })], prompt, bassSelected).actions).toEqual([]);
        expect(bridge([gainCall(drums.id, { deltaDb: -3 })], prompt, drumsSelected).actions).toEqual([]);
    });

    it.each(['leave this track alone', 'leave the selected track alone'])(
        'refuses a selection phrase when nothing is selected in "%s"',
        (protection) => {
            const result = bridge([gainCall(drums.id, { deltaDb: -3 })], `turn the Drums down 3 dB; ${protection}`);

            expect(result.actions).toEqual([]);
            expect(result.rejections).toEqual([
                { index: 0, name: '<batch>', reason: expect.stringContaining('resolves to no') },
            ]);
        }
    );

    it('protects only the control a protection names on the selected track', () => {
        const drumsSelected = { ...projectContext, selectedTrackId: drums.id };
        const prompt = 'turn the Drums down 3 dB; keep its pan as is';
        const faderProtected = 'turn the Drums down 3 dB; keep its fader as is';

        const gainChange = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt, drumsSelected);
        expect(gainChange.rejections).toEqual([]);
        expect(gainChange.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
        expect(bridge([gainCall(drums.id, { deltaDb: -3 })], faderProtected, drumsSelected).actions).toEqual([]);
    });

    it('protects the member tracks of a VCA group a protection names, and only those', () => {
        const prompt = (track: string) => `turn ${track} down 3 dB; do not change pan, solo, and fader of Strings`;

        const member = bridge([gainCall(keys.id, { deltaDb: -3 })], prompt('Keys'), projectWithStringsGroup);
        expect(member.actions).toEqual([]);
        expect(member.rejections).toEqual([{ index: 0, name: '<batch>', reason: expect.stringContaining('"Keys"') }]);

        const outsider = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt('Drums'), projectWithStringsGroup);
        expect(outsider.rejections).toEqual([]);
        expect(outsider.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
    });

    it.each([
        ['turn the Drums down 3 dB except for the Intro', 'Intro'],
        ['turn the Drums down 3 dB but not in the Bridge', 'Bridge'],
        ['turn the Drums down 3 dB; Ghost stays as is', 'Ghost'],
        ['turn the Drums down 3 dB; Piano and Ghost stay as they are', 'Piano'],
        ['turn the Drums down 3 dB with Ghost unchanged', 'Ghost'],
    ])('refuses the protection form in "%s" naming %s', (prompt, reference) => {
        expectRefusedNamingReference(bridge([gainCall(drums.id, { deltaDb: -3 })], prompt), reference);
    });

    it('refuses a subject after a colon whose protection names no object', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 })],
            'turn the Drums down 3 dB: Ghost should not change'
        );

        expect(result.actions).toEqual([]);
    });

    it('does not refuse an unrelated name beside a change to another track', () => {
        const result = bridge(
            [gainCall(vocals.id, { deltaDb: -2 })],
            'lower the Vocals by 2 dB and Sarah likes the Keys as is'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(vocals.id, { deltaDb: -2 })]);
    });

    it.each([
        'turn the Drums down 3 dB; keep Spotify loudness in mind',
        'turn the Drums down 3 dB; and keep Mike happy',
        "turn the Drums down 3 dB; don't change the Keys until Friday",
        "turn the Drums down 3 dB; don't touch the Keys, Sam is still editing them",
        'turn the Drums down 3 dB and Sarah likes the Keys as is',
        'turn the Drums down 3 dB; Leave The Keys Alone',
        'turn the Drums down 3 dB; Keep Everything Else The Same',
        'turn the Drums down 3 dB; keep the Low End intact',
        'turn the Drums down 3 dB; keep the Abbey Road vibe intact',
        'turn the Drums down 3 dB; keep the Bass Mono as is',
        'turn the Drums down 3 dB; keep the "warm" sound as is',
        "turn the Drums down 3 dB; don't change the 'vibe'",
        'turn the Drums down 3 dB; keep "Ghost" as is',
        'turn the Drums down 3 dB; Drums stays punchy',
    ])('does not refuse the asked change over a name that is no object in "%s"', (prompt) => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
    });

    describe('"it" and "its" point at the request\'s one named target', () => {
        it.each([
            'turn the Drums down 3 dB but keep its pan as is',
            'turn the Drums down 3 dB, then leave it alone',
            "turn the Drums down 3 dB and don't touch it",
        ])('grounds the asked change with nothing selected in "%s"', (prompt) => {
            const result = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt);

            expect(result.rejections).toEqual([]);
            expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
        });

        it('keeps the pan of that target, so a pan change in the batch refuses', () => {
            const pan = { name: 'setTrackPan', arguments: { trackId: drums.id, pan: -20 } };
            const unprotected = bridge(
                [gainCall(drums.id, { deltaDb: -3 }), pan],
                'turn the Drums down 3 dB and pan the Drums 20% left'
            );
            expect(unprotected.rejections).toEqual([]);

            const protectedPan = bridge(
                [gainCall(drums.id, { deltaDb: -3 }), pan],
                'turn the Drums down 3 dB and pan the Drums 20% left but keep its pan as is'
            );
            expect(protectedPan.actions).toEqual([]);
            expect(protectedPan.rejections).toEqual([
                { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Drums"') },
            ]);
        });

        it('leaves the pronoun to the selection only when the request names no target', () => {
            const selected = { ...projectContext, selectedTrackId: bass.id };
            const named = bridge(
                [gainCall(drums.id, { deltaDb: -3 })],
                'turn the Drums down 3 dB; keep its fader as is',
                selected
            );
            expect(named.actions).toEqual([]);
            expect(named.rejections).toEqual([
                { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Drums"') },
            ]);
        });
    });

    describe('forms that protect the selected track', () => {
        const drumsSelected = { ...projectContext, selectedTrackId: drums.id };

        it.each([
            "turn the Drums down 3 dB; leave the selected track's fader alone",
            'turn the Drums down 3 dB; leave the selected track’s fader alone',
            "turn the Drums down 3 dB; keep this track's volume as is",
            'turn the Drums down 3 dB; keep the selected track settings as is',
            'turn the Drums down 3 dB; leave the selected track sends and fader alone',
            'turn the Drums down 3 dB with the selected track unchanged',
            'turn the Drums down 3 dB except the selected track',
        ])('refuses a change to the selected track in "%s"', (prompt) => {
            const result = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt, drumsSelected);

            expect(result.actions).toEqual([]);
            expect(result.rejections).toEqual([
                { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Drums"') },
            ]);
        });

        it.each([
            "turn the Drums down 3 dB; leave the selected track's fader alone",
            'turn the Drums down 3 dB; keep the selected track settings as is',
            'turn the Drums down 3 dB with the selected track unchanged',
            'turn the Drums down 3 dB except the selected track',
        ])('refuses the form as unbound with nothing selected in "%s"', (prompt) => {
            expect(bridge([gainCall(drums.id, { deltaDb: -3 })], prompt).actions).toEqual([]);
        });

        it('keeps a selected track a send protection names, not its fader', () => {
            const result = bridge(
                [gainCall(drums.id, { deltaDb: -3 })],
                'turn the Drums down 3 dB; leave the selected track sends alone',
                drumsSelected
            );

            expect(result.rejections).toEqual([]);
            expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
        });

        it('reads an "along with" list that names the selected track', () => {
            const keysSelected = { ...projectContext, selectedTrackId: keys.id };
            const result = bridge(
                [gainCall(keys.id, { deltaDb: -3 })],
                'turn the Keys down 3 dB and leave Drums along with this track alone',
                keysSelected
            );

            expect(result.actions).toEqual([]);
            expect(result.rejections).toEqual([
                { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Keys"') },
            ]);
        });

        it('lets a carve-out exempt the selected track from the protection it follows', () => {
            const keysSelected = { ...projectContext, selectedTrackId: keys.id };
            const result = bridge(
                [gainCall(keys.id, { deltaDb: -3 })],
                'turn the Keys down 3 dB and leave Bass alone except this track',
                keysSelected
            );

            expect(result.rejections).toEqual([]);
            expect(result.actions).toEqual([gainAction(keys.id, { deltaDb: -3 })]);
        });
    });

    describe('a capital at a sentence start carries no signal', () => {
        it.each([
            'turn the Drums down 3 dB. Ghost stays as is.',
            'Ghost stays as is, turn the Drums down 3 dB',
            'Turn the Drums down 3 dB. Levels unchanged.',
            'Turn the Drums down 3 dB. Width stays as is.',
            'Turn the Drums down 3 dB. Rest as is.',
            'Turn the Drums down 3 dB. Others unchanged.',
            'Turn the Drums down 3 dB. Automation stays as is.',
            'turn the Drums down 3 dB; leave the Levels alone',
            'turn the Drums down 3 dB; keep the Fx as is',
            'turn the Drums down 3 dB; keep the Low End as is',
            'turn the Drums down 3 dB; keep the Stereo Image the same',
            'turn the Drums down 3 dB; keep the Sidechain unchanged',
            "turn the Drums down 3 dB; don't touch the Equalizer",
            'turn the Drums down 3 dB; keep the Meter as is',
            'turn the Drums down 3 dB; do not change the Time Signature',
            'turn the Drums down 3 dB and Keep Everything Else The Same',
        ])('grounds the asked change in "%s" with nothing selected', (prompt) => {
            const result = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt);

            expect(result.rejections).toEqual([]);
            expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
        });

        it.each([
            ['turn the Drums down 3 dB; do not change pan, solo, and fader of Strings', 'Strings'],
            ['turn the Drums down 3 dB and leave the Kick alone', 'Kick'],
            ['turn the Drums down 3 dB; Leave Ghost alone', 'Ghost'],
            ['turn the Drums down 3 dB; keep the Ghost track as is', 'Ghost'],
            ['turn the Drums down 3 dB. The Ghost track stays as is.', 'Ghost'],
        ])('still refuses the unbound object in "%s"', (prompt, reference) => {
            expectRefusedNamingReference(bridge([gainCall(drums.id, { deltaDb: -3 })], prompt), reference);
        });
    });

    describe('a singular or plural variant of an object name binds to the object and protects it', () => {
        it('refuses a change to the object the variant names', () => {
            const result = bridge(
                [gainCall(vocals.id, { deltaDb: -3 })],
                'turn the Vocals down 3 dB; leave the Vocal alone'
            );

            expect(result.actions).toEqual([]);
            expect(result.rejections).toEqual([
                { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Vocals"') },
            ]);
        });

        it.each(['leave the Vocal alone', 'keep the Drum Bus the same as the Vocal', 'leave the Lead Vocal alone'])(
            'neither refuses nor ignores it, so a change to another track grounds in "%s"',
            (protection) => {
                const result = bridge([gainCall(drums.id, { deltaDb: -3 })], `turn the Drums down 3 dB; ${protection}`);

                expect(result.rejections).toEqual([]);
                expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
            }
        );
    });

    describe('intact exempts only a quality', () => {
        const bassSelected = { ...projectContext, selectedTrackId: bass.id };

        it('refuses the selected track kept intact on the bridge route', () => {
            const result = bridge(
                [gainCall(bass.id, { deltaDb: -3 })],
                'turn the Bass down 3 dB; keep the selected track intact',
                bassSelected
            );

            expect(result.actions).toEqual([]);
            expect(result.rejections).toEqual([
                { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Bass"') },
            ]);
        });

        it('refuses the selected track kept intact on the atomic route', () => {
            const prompt = 'turn the Bass down 3 dB; keep the selected track intact';

            expect(groundGainList(prompt, [bass], bassSelected).status).toBe('rejected');
            expect(groundGainList(prompt, [bass], bassSelected, true).status).toBe('rejected');
        });

        it.each(['keep Strings intact', 'Strings stays intact'])(
            'refuses a change to a group member in "%s" on the bridge and atomic routes',
            (protection) => {
                const prompt = `turn the Keys down 3 dB; ${protection}`;
                const result = bridge([gainCall(keys.id, { deltaDb: -3 })], prompt, projectWithStringsGroup);

                expect(result.actions).toEqual([]);
                expect(result.rejections).toEqual([
                    { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Keys"') },
                ]);
                expect(groundGainList(prompt, [keys], projectWithStringsGroup).status).toBe('rejected');
                expect(groundGainList(prompt, [keys], projectWithStringsGroup, true).status).toBe('rejected');
            }
        );

        it('refuses an unbound selection phrase closed by intact', () => {
            expectRefusedNamingReference(
                bridge(
                    [gainCall(drums.id, { deltaDb: -3 })],
                    'turn the Drums down 3 dB; keep the selected track intact'
                ),
                'the selected track'
            );
        });

        it('grounds a quality closed by intact', () => {
            const prompt = 'turn the Drums down 3 dB; keep the Low End intact';
            const result = bridge([gainCall(drums.id, { deltaDb: -3 })], prompt);

            expect(result.rejections).toEqual([]);
            expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
            expect(groundGainList(prompt, [drums]).status).toBe('grounded');
        });
    });

    describe('a protection verb after a semicolon or colon is a request', () => {
        it.each(['turn the Keys down 3 dB; Leave Strings alone', 'turn the Keys down 3 dB: Keep Strings unchanged'])(
            'refuses a change to a group member in "%s"',
            (prompt) => {
                const result = bridge([gainCall(keys.id, { deltaDb: -3 })], prompt, projectWithStringsGroup);

                expect(result.actions).toEqual([]);
                expect(result.rejections).toEqual([
                    { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Keys"') },
                ]);
            }
        );

        it('refuses a change to the selected track', () => {
            const bassSelected = { ...projectContext, selectedTrackId: bass.id };
            const result = bridge(
                [gainCall(bass.id, { deltaDb: -3 })],
                'turn the Bass down 3 dB; Leave the selected track alone',
                bassSelected
            );

            expect(result.actions).toEqual([]);
        });

        it('refuses a name no object carries', () => {
            expectRefusedNamingReference(
                bridge([gainCall(drums.id, { deltaDb: -3 })], 'turn the Drums down 3 dB; Leave Ghost alone'),
                'Ghost'
            );
        });
    });

    describe('rules the closed forms leave unpinned', () => {
        const keysSelected = { ...projectContext, selectedTrackId: keys.id };
        const bassSelected = { ...projectContext, selectedTrackId: bass.id };

        it('reads a selection phrase only in a closed form: "leave this track" with no closer grounds', () => {
            const result = bridge(
                [gainCall(keys.id, { deltaDb: -3 })],
                'turn the Keys down 3 dB and leave this track',
                keysSelected
            );

            expect(result.rejections).toEqual([]);
            expect(result.actions).toEqual([gainAction(keys.id, { deltaDb: -3 })]);
        });

        it('maps "faders" to the gain control, so a pan change on that track still grounds', () => {
            const pan = { name: 'setTrackPan', arguments: { trackId: bass.id, pan: -20 } };
            const prompt = (verb: string) => `${verb}; keep the selected track's faders as is`;

            const panned = bridge([pan], prompt('pan the Bass 20% left'), bassSelected);
            expect(panned.rejections).toEqual([]);
            expect(panned.actions).toHaveLength(1);

            const leveled = bridge(
                [gainCall(bass.id, { deltaDb: -3 })],
                prompt('turn the Bass down 3 dB'),
                bassSelected
            );
            expect(leveled.actions).toEqual([]);
            expect(leveled.rejections).toEqual([
                { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Bass"') },
            ]);
        });

        it('lets "except its pan" exempt a control, so a pan change on the target grounds', () => {
            const pan = { name: 'setTrackPan', arguments: { trackId: drums.id, pan: -20 } };
            const result = bridge(
                [gainCall(drums.id, { deltaDb: -3 }), pan],
                'turn the Drums down 3 dB and pan the Drums 20% left and leave Bass alone except its pan'
            );

            expect(result.rejections).toEqual([]);
            expect(result.actions).toHaveLength(2);
        });
    });

    describe('a VCA group an exclusion names', () => {
        const refusesMember = (result: ReturnType<typeof bridge>) => {
            expect(result.actions).toEqual([]);
            expect(result.rejections).toEqual([
                { index: 0, name: '<batch>', reason: expect.stringContaining('Request changes "Keys"') },
            ]);
        };

        it.each(['turn the Keys down 3 dB except Strings', 'turn the Keys down 3 dB but not Strings'])(
            'refuses a change to a member track on the bridge route in "%s"',
            (prompt) => {
                refusesMember(bridge([gainCall(keys.id, { deltaDb: -3 })], prompt, projectWithStringsGroup));
            }
        );

        it.each(['turn the Keys down 3 dB except Strings', 'turn the Keys down 3 dB but not Strings'])(
            'refuses a change to a member track on the atomic route in "%s"',
            (prompt) => {
                expect(groundGainList(prompt, [keys], projectWithStringsGroup).status).toBe('rejected');
                expect(groundGainList(prompt, [keys], projectWithStringsGroup, true).status).toBe('rejected');
            }
        );

        it('grounds a change to a track outside the excluded group', () => {
            const result = bridge(
                [gainCall(drums.id, { deltaDb: -3 })],
                'turn the Drums down 3 dB except Strings',
                projectWithStringsGroup
            );

            expect(result.rejections).toEqual([]);
            expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
        });

        it('does not protect a group a carve-out exempts from a protection it follows', () => {
            const result = bridge(
                [gainCall(keys.id, { deltaDb: -3 })],
                'turn the Keys down 3 dB and leave Bass alone except Strings',
                projectWithStringsGroup
            );

            expect(result.rejections).toEqual([]);
        });
    });
});

describe('level requests outside a coordinated list ground as before', () => {
    it('grounds the two-clause form', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn Drums down 3 dB and Bass down 3 dB'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 }), gainAction(bass.id, { deltaDb: -3 })]);
    });

    it('grounds a single named track', () => {
        const result = bridge([gainCall(drums.id, { deltaDb: -3 })], 'turn the Drums down 3 dB');

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([gainAction(drums.id, { deltaDb: -3 })]);
    });

    it('still refuses a second call beside a single named track', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn the Drums down 3 dB'
        );

        expect(result.actions).not.toContainEqual(gainAction(bass.id, { deltaDb: -3 }));
    });
});
