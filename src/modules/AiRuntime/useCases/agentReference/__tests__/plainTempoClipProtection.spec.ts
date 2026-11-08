import { afterEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { normalizeTrack } from '#/modules/Arrangement/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type ProposalProtectionFacts } from '../../../models/ProposalGroundingBasis';
import { type SemanticCommandListItem } from '../../../models/SemanticCommandList';
import {
    pendingActionConfirmationStore,
    proposePendingActionConfirmation,
} from '../../../stores/pendingActionConfirmationStore';
import { tryParameterizedPath } from '../../../transformers/promptParser/parsing';
import { readApprovedProtectionFailure } from '../../agentRequestOrchestration/readApprovedProtectionFailure';
import { compileArbitraryCommandList } from '../../compileArbitraryCommandList';
import { groundCompiledCommandBatch } from '../../groundCompiledCommandBatch';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';
import { proposalCommandShape } from '../proposalCommandShape';
import { proposalProtection } from '../proposalProtection';

type Track = ProjectContext['tracks'][number];
type Call = Parameters<typeof bridgeGroundedLlmToolCalls>[0]['calls'][number];

registerDeviceEnginePorts();

function track(id: string, name: string, clips: Track['clips'] = []): Track {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        outputId: 'master',
        clipCount: clips.length,
        deviceCount: 0,
        clips,
        devices: [],
        sends: [],
    };
}

const guitarTake = {
    id: 'guitar-clip-1',
    name: 'Guitar Take',
    type: 'audio',
    startBeat: 0,
    endBeat: 8,
    gain: 1,
    noteCount: 0,
} satisfies Track['clips'][number];
const otherTake = { ...guitarTake, id: 'guitar-clip-2', name: 'Other Take', startBeat: 8, endBeat: 16 };
const context: ProjectContext = {
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
    masterGain: 1,
    tracks: [track('guitar', 'Guitar', [guitarTake, otherTake]), track('bass', 'Bass'), track('empty', 'Empty')],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};
const tempo: Call = { name: 'setTempo', arguments: { bpm: 96 } };
const gain: Call = { name: 'setTrackGain', arguments: { trackId: 'guitar', gain: 0.5 } };
const tempoAction = { type: 'setTempo', payload: { bpm: 96 } } as const;
const facts: ProposalProtectionFacts = {
    protectedUnchanged: [{ id: guitarTake.id, name: guitarTake.name }],
    protectedControls: [],
};
const revision = 'plain-tempo-clip-protection';

function bridge(calls: readonly Call[], prompt: string, project = context) {
    return bridgeGroundedLlmToolCalls({ calls, prompt, context: project });
}

function ground(
    calls: readonly Call[],
    prompt: string,
    extra: Partial<Parameters<typeof groundCompiledCommandBatch>[0]> = {}
) {
    return groundCompiledCommandBatch({
        toolCalls: calls,
        context,
        prompt,
        projectRevision: revision,
        compilerEvidence: undefined,
        workflowCapabilityId: undefined,
        selectedCompilations: [],
        transformCommands: [],
        transformTargetIds: [],
        creativeAuthority: undefined,
        providerProposal: null,
        ...extra,
    });
}

function compile(calls: readonly Call[], prompt: string) {
    const compiled = compileArbitraryCommandList({
        context,
        revision,
        calls: [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: {
                        semantic: { classification: 'simple', uncertainty: [] },
                        objective: prompt,
                        constraints: [],
                        scope: { targetIds: ['guitar'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                        capabilityIds: [],
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: [],
                        stoppingConditions: [],
                    },
                    list: {
                        schemaVersion: 1,
                        items: calls.map((call, index) => {
                            const item: SemanticCommandListItem = {
                                id: `item-${index}`,
                                name: call.name,
                                arguments: Object.fromEntries(
                                    Object.entries(call.arguments).filter(([key]) => key !== 'trackId')
                                ),
                            };
                            if (call.arguments.trackId !== undefined) {
                                item.selector = {
                                    targetArgument: 'trackId',
                                    entity: 'track',
                                    where: { name: 'Guitar' },
                                    quantity: { unit: 'targets', exactly: 1 },
                                };
                            }
                            return item;
                        }),
                    },
                },
            },
        ],
    });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        throw new Error(`Expected an admitted compiled list: ${JSON.stringify(compiled)}`);
    }
    return compiled.compilerEvidence;
}

function expectGrounded(calls: readonly Call[], prompt: string) {
    expect(bridge(calls, prompt)).toMatchObject({
        actions: calls.map((call) => ({ type: call.name, payload: call.arguments })),
        rejections: [],
    });
    expect(ground(calls, prompt)).toMatchObject({ status: 'grounded' });
}

function expectProtected(calls: readonly Call[], prompt: string, name = guitarTake.name) {
    expect(bridge(calls, prompt)).toEqual({
        actions: [],
        rejections: [
            { index: 0, name: '<batch>', reason: `Request changes "${name}", which a protection in it leaves alone` },
        ],
    });
    expect(ground(calls, prompt)).toMatchObject({
        status: 'rejected',
        rejectionReason: expect.stringContaining(`Request changes "${name}"`),
    });
}

afterEach(() => {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    pendingActionConfirmationStore.set({ confirmations: [] });
});

describe('project clip effect protection controls', () => {
    it('admits the actual plain and compiled tempo and gain commands without protection', () => {
        for (const [calls, prompt] of [
            [[tempo], 'set tempo to 96 bpm'],
            [[tempo, gain], 'set tempo to 96 bpm and make Guitar quieter'],
        ] satisfies Array<[Call[], string]>) {
            expectGrounded(calls, prompt);
            const evidence = compile(calls, prompt);
            expect(ground(evidence.commands, prompt, { compilerEvidence: evidence })).toMatchObject({
                status: 'grounded',
            });
        }
    });

    it('keeps clip protection distinct from its track gain and other clip edits', () => {
        expectProtected(
            [{ name: 'setClipGain', arguments: { clipId: guitarTake.id, gain: 0.5 } }],
            'set Guitar Take gain to 0.5; leave Guitar Take unchanged'
        );
        expectGrounded([gain], 'make Guitar quieter; leave Guitar Take unchanged');
        expectGrounded(
            [{ name: 'setClipGain', arguments: { clipId: otherTake.id, gain: 0.5 } }],
            'set Other Take gain to 0.5; leave Guitar Take unchanged'
        );
        expectProtected([gain], 'make Guitar quieter; leave Guitar unchanged', 'Guitar');
    });

    it('keeps fader restrictions and unrelated project timing separate from clip effects', () => {
        expectGrounded([tempo], 'set tempo to 96 bpm; leave Guitar fader unchanged');
        expectGrounded(
            [{ name: 'setTrackPan', arguments: { trackId: 'guitar', pan: 20 } }],
            'pan Guitar 20 right; leave Guitar fader unchanged'
        );
        expectProtected([gain], 'make Guitar quieter; leave Guitar fader unchanged', 'Guitar');
        expectGrounded(
            [{ name: 'setTimeSignature', arguments: { numerator: 3, denominator: 4 } }],
            'set time signature to 3/4; leave Guitar Take unchanged'
        );
        expectGrounded(
            [{ name: 'setLoopRegion', arguments: { startBeat: 8, endBeat: 16 } }],
            'set the loop from beat 8 to beat 16; leave Guitar Take unchanged'
        );
        expectGrounded([tempo], 'set tempo to 96 bpm; leave Empty unchanged');
        expect(proposalProtection.findChange([{ type: 'stopPlayback' }], facts, context)).toBeNull();
    });

    it('keeps the complete literal tempo grammar from executing a protected or mixed prefix', () => {
        expect(tryParameterizedPath('set tempo to 96', context)).toEqual([tempoAction]);
        expect(tryParameterizedPath('set tempo to 96; leave Guitar Take unchanged', context)).toEqual([]);
        expect(tryParameterizedPath('set tempo to 96 and make Guitar quieter', context)).toEqual([]);
    });
});

describe('targetless project clip effect protections', () => {
    it.each([
        [[tempo], 'set tempo to 96 bpm'],
        [[tempo, gain], 'set tempo to 96 bpm and make Guitar quieter'],
    ] satisfies Array<[Call[], string]>)(
        'refuses the whole plain batch %j when it protects its clip',
        (calls, prompt) => {
            const before = structuredClone(context);
            expectProtected(calls, `${prompt}; leave Guitar Take unchanged`);
            expect(context).toEqual(before);
        }
    );

    it('refuses tempo alone for a protected whole track with audio descendants', () => {
        expectProtected([tempo], 'set tempo to 96 bpm; leave Guitar unchanged', 'Guitar');
    });

    it.each([
        [[tempo], 'set tempo to 96 bpm'],
        [[tempo, gain], 'set tempo to 96 bpm and make Guitar quieter'],
    ] satisfies Array<[Call[], string]>)(
        'refuses retained compiler evidence %j when a clip protection is added later',
        (calls, prompt) => {
            const evidence = compile(calls, prompt);
            expect(ground(evidence.commands, prompt, { compilerEvidence: evidence })).toMatchObject({
                status: 'grounded',
            });
            expect(
                ground(evidence.commands, `${prompt}; leave Guitar Take unchanged`, { compilerEvidence: evidence })
            ).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('Request changes "Guitar Take"'),
            });
        }
    );

    it.each([
        [[tempo], 'set tempo to 96 bpm; leave Guitar Take unchanged'],
        [[tempo, gain], 'set tempo to 96 bpm and make Guitar quieter; leave Guitar Take unchanged'],
    ] satisfies Array<[Call[], string]>)(
        'refuses the original protected request %j after compiling that same request',
        (calls, prompt) => {
            const evidence = compile(calls, prompt);
            expect(evidence.commands).toEqual(calls);
            expect(ground(evidence.commands, prompt, { compilerEvidence: evidence })).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('Request changes "Guitar Take"'),
            });
        }
    );

    it('retains the original protection facts for bound requests and prior-fact grounding', () => {
        const original = 'make Guitar quieter; leave Guitar Take unchanged';
        const initial = ground([gain], original);
        if (initial.status !== 'grounded') {
            throw new Error(`Expected the original clip-preserving gain to ground: ${JSON.stringify(initial)}`);
        }
        expect(initial.protectionFacts).toEqual(facts);
        const captured = {
            request: 'set tempo to 96 bpm; leave Guitar Take unchanged',
            facts: initial.protectionFacts,
            resolvedTrackClauses: [],
        };
        const before = structuredClone(captured);
        expect(ground([tempo], captured.request, { requestProtections: captured })).toMatchObject({
            status: 'rejected',
            rejectionReason: expect.stringContaining('Request changes "Guitar Take"'),
        });
        expect(ground([tempo], captured.request, { refinementProtections: initial.protectionFacts })).toMatchObject({
            status: 'rejected',
            rejectionReason: expect.stringContaining('Request changes "Guitar Take"'),
        });
        expect(ground([tempo], 'set tempo to 97 bpm', { requestProtections: captured })).toMatchObject({
            status: 'rejected',
            rejectionReason: expect.stringContaining('Stored protections belong to a different request'),
        });
        expect(captured).toEqual(before);
    });

    it('retains an earlier request protection when a refinement adds tempo', () => {
        for (const protectedUnchanged of [[], facts.protectedUnchanged]) {
            const initial = ground(
                [gain],
                protectedUnchanged.length === 0
                    ? 'make Guitar quieter'
                    : 'make Guitar quieter; leave Guitar Take unchanged'
            );
            if (initial.status !== 'grounded' || initial.groundingBasis === undefined) {
                throw new Error(`Expected a real admitted pending basis: ${JSON.stringify(initial)}`);
            }
            const result = ground([gain, tempo], 'make Guitar quieter and set tempo to 96 bpm', {
                refinementBasis: initial.groundingBasis,
            });
            if (protectedUnchanged.length === 0) {
                expect(result).toMatchObject({ status: 'grounded' });
            } else {
                expect(result).toMatchObject({
                    status: 'rejected',
                    rejectionReason: expect.stringContaining('Refined proposal changes "Guitar Take"'),
                });
            }
        }
    });

    it('reaches inactive alternatives and their whole owners without freezing empty tracks or faders', () => {
        const inactive: ProjectContext = {
            ...context,
            tracks: [{ ...track('guitar', 'Guitar'), alternativeClipIds: [guitarTake.id] }, track('empty', 'Empty')],
        };
        expect(proposalProtection.findChange([tempoAction], facts, inactive)).toEqual(facts.protectedUnchanged[0]);
        expect(
            proposalProtection.findChange(
                [tempoAction],
                { protectedUnchanged: [{ id: 'guitar', name: 'Guitar' }], protectedControls: [] },
                inactive
            )
        ).toEqual({ id: 'guitar', name: 'Guitar' });
        expect(
            proposalProtection.findChange(
                [tempoAction],
                { protectedUnchanged: [{ id: 'empty', name: 'Empty' }], protectedControls: [] },
                inactive
            )
        ).toBeNull();
        expect(
            proposalProtection.findChange(
                [tempoAction],
                { protectedUnchanged: [], protectedControls: [{ trackId: 'guitar', operations: ['setTrackGain'] }] },
                inactive
            )
        ).toBeNull();
        expect(
            bridgeGroundedLlmToolCalls({
                calls: [tempo],
                prompt: 'set tempo to 96 bpm',
                context: inactive,
                requestProtections: { request: 'set tempo to 96 bpm', facts, resolvedTrackClauses: [] },
            })
        ).toEqual({
            actions: [],
            rejections: [
                {
                    index: 0,
                    name: '<batch>',
                    reason: 'Request changes "Guitar Take", which a protection in it leaves alone',
                },
            ],
        });
    });

    it('keeps quoted compound protections and unresolved members on the real plain route', () => {
        const compound: ProjectContext = {
            ...context,
            tracks: [track('guitar', 'Guitar', [{ ...guitarTake, name: 'Alpha and Omega' }])],
        };
        expect(bridge([tempo], 'set tempo to 96 bpm; leave "Alpha and Omega" unchanged', compound)).toEqual({
            actions: [],
            rejections: [
                {
                    index: 0,
                    name: '<batch>',
                    reason: 'Request changes "Alpha and Omega", which a protection in it leaves alone',
                },
            ],
        });
        expect(bridge([tempo], 'set tempo to 96 bpm; leave Guitar Take and "Missing Take" unchanged')).toEqual({
            actions: [],
            rejections: [
                {
                    index: 0,
                    name: '<batch>',
                    reason: 'Protection names "Missing Take", which resolves to no track, clip, device or group, so the request is refused',
                },
            ],
        });
        const ambiguous: ProjectContext = {
            ...context,
            tracks: [
                track('guitar', 'Guitar', [{ ...guitarTake, name: 'Shared Take' }]),
                track('bass', 'Bass', [{ ...otherTake, name: 'Shared Take' }]),
            ],
        };
        const retained = ground(
            [{ name: 'setTimeSignature', arguments: { numerator: 3, denominator: 4 } }],
            'set time signature to 3/4; leave Shared Take unchanged',
            { context: ambiguous }
        );
        expect(retained).toMatchObject({
            status: 'grounded',
            protectionFacts: {
                protectedUnchanged: [
                    { id: guitarTake.id, name: 'Shared Take' },
                    { id: otherTake.id, name: 'Shared Take' },
                ],
            },
        });
        expect(bridge([tempo], 'set tempo to 96 bpm; leave Shared Take unchanged', ambiguous)).toEqual({
            actions: [],
            rejections: [
                {
                    index: 0,
                    name: '<batch>',
                    reason: 'Request changes "Shared Take", which a protection in it leaves alone',
                },
            ],
        });
        expectGrounded([tempo], 'set tempo to 96 bpm; keep it punchy');
    });

    it('checks immutable approval facts against real current project context', () => {
        trackStore.set({
            tracks: [
                normalizeTrack({
                    id: 'guitar',
                    name: 'Guitar',
                    kind: 'audio',
                    clips: [
                        {
                            ...guitarTake,
                            trackId: 'guitar',
                            audioBufferId: 'guitar-buffer',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            color: '',
                            locked: false,
                            muted: false,
                        },
                    ],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        pendingActionConfirmationStore.set({ confirmations: [] });
        const confirmation = proposePendingActionConfirmation({
            id: 'tempo-protection',
            prompt: 'set tempo to 96 bpm',
            assistantMessageId: 'tempo-message',
            actions: [tempoAction],
            actionLabels: ['Set tempo to 96 BPM'],
            projectRevision: revision,
            protectionFacts: facts,
        });
        if (confirmation === null) {
            throw new Error('Expected a real pending confirmation');
        }
        const before = structuredClone(confirmation);
        expect(readApprovedProtectionFailure(confirmation)).toBe(
            'The approved proposal changes "Guitar Take", which its captured request leaves unchanged.'
        );
        expect(confirmation).toEqual(before);
        expect(
            readApprovedProtectionFailure({
                ...confirmation,
                approvalSnapshot: {
                    ...confirmation.approvalSnapshot,
                    protectionFacts: { protectedUnchanged: [], protectedControls: [] },
                },
            })
        ).toBeNull();
        expect(proposalCommandShape.controlOwnerIds('setTempo', { bpm: 96 }, context)).toEqual([]);
    });
});
