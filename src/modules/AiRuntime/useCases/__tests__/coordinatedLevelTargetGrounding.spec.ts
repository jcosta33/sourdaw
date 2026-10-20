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
        ['set Drums to -6 dB', 'set Drums, Bass and Keys to -6 dB', [drums, bass, keys], { gainDb: -6 }],
        ['Drums up 2 dB', 'both Drums and Bass up 2 dB', [drums, bass], { deltaDb: 2 }],
    ])('refuses a list worded as "%s" refuses its single track', (singlePrompt, listPrompt, tracks, value) => {
        const single = bridge([gainCall(drums.id, value)], singlePrompt);
        const list = bridge(
            tracks.map((track) => gainCall(track.id, value)),
            listPrompt
        );

        expect(single.actions).toEqual([]);
        expect(list.actions).toEqual([]);
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

describe('a coordinated level list keeps the protections of tracks outside it', () => {
    it('reads a protection naming no list member as the two-clause form reads it', () => {
        const calls = [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })];
        const restriction = 'do not change pan, solo, and fader of Strings';

        expect(bridge(calls, `turn Drums and Bass down 3 dB; ${restriction}`)).toEqual(
            bridge(calls, `turn Drums down 3 dB and Bass down 3 dB; ${restriction}`)
        );
    });

    it('does not protect Bass from gain when the separate restriction names Bass DI', () => {
        const result = bridge(
            [gainCall(drums.id, { deltaDb: -3 }), gainCall(bass.id, { deltaDb: -3 })],
            'turn Drums and Bass down 3 dB; leave Bass DI pan and fader unchanged'
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
