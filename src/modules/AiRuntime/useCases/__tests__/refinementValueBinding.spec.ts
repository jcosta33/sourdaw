import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingBasis } from '../../models/ProposalGroundingBasis';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { groundCompiledCommandBatch } from '../groundCompiledCommandBatch';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

/**
 * #4380: a terse refinement of a pending card inherits the card's grounded commands and binds only
 * the values its own clauses state. Authority comes from the request texts alone: the request that
 * made the card, the refinement, and the card's own grounding.
 *
 * P0 "turn Vocals down 3 dB" is one bounded command, which the chat commits without a card, so its
 * rows ground against the basis such a card carries; P1 and Pd rows that need a held card run the
 * chat route against the real stores, Command and CRDT document, with only the provider scripted.
 */

const P0 = 'turn Vocals down 3 dB';
const P1 = 'turn Vocals down 3 dB and turn Snare down 2 dB, leaving the Drum Bus unchanged';
const PD = 'set Reverb mix to 40%';

type ProviderCall = { name: string; arguments: Record<string, unknown> };

const vocalsBy = (deltaDb: number): ProviderCall => ({
    name: 'setTrackGain',
    arguments: { trackId: 'track-vocals', deltaDb },
});
const snareBy = (deltaDb: number): ProviderCall => ({
    name: 'setTrackGain',
    arguments: { trackId: 'track-snare', deltaDb },
});
const reverbMix = (value: number): ProviderCall => ({
    name: 'setDeviceParameter',
    arguments: { deviceId: 'device-reverb', paramId: 'mix', value },
});

const P0_PLAN: readonly ProviderCall[] = [vocalsBy(-3)];
const P1_PLAN: readonly ProviderCall[] = [vocalsBy(-3), snareBy(-2)];
const PD_PLAN: readonly ProviderCall[] = [reverbMix(40)];

type ProjectTrack = ProjectContext['tracks'][number];

function projectTrack(id: string, name: string, overrides: Partial<ProjectTrack> = {}): ProjectTrack {
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
        outputId: 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        ...overrides,
    };
}

const reverbDevice: ProjectTrack['devices'][number] = {
    id: 'device-reverb',
    type: 'Reverb',
    bypassed: false,
    parameters: [{ id: 'mix', name: 'Mix', type: 'float', value: 25, minValue: 0, maxValue: 100, unit: '%' }],
};

function projectContext(tracks: readonly ProjectTrack[]): ProjectContext {
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
        automationLanes: [],
        tracks: [...tracks],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'mix',
        playheadPosition: 0,
    };
}

const BASE_TRACKS: readonly ProjectTrack[] = [
    projectTrack('track-vocals', 'Vocals'),
    projectTrack('track-snare', 'Snare'),
    projectTrack('track-drum-bus', 'Drum Bus'),
    projectTrack('track-bass', 'Bass'),
    projectTrack('track-keys', 'Keys', { deviceCount: 1, devices: [reverbDevice] }),
];
const CONTEXT = projectContext(BASE_TRACKS);

function ground(
    prompt: string,
    calls: readonly ProviderCall[],
    refinementBasis?: ProposalGroundingBasis,
    context: ProjectContext = CONTEXT
) {
    return groundCompiledCommandBatch({
        toolCalls: calls,
        context,
        prompt,
        projectRevision: undefined,
        workflowCapabilityId: undefined,
        compilerEvidence: undefined,
        selectedCompilations: [],
        transformCommands: [],
        transformTargetIds: [],
        creativeAuthority: undefined,
        providerProposal: null,
        refinementBasis,
    });
}

/** The basis an ordinary card made from this request carries, as the planner records it. */
function cardBasis(prompt: string, calls: readonly ProviderCall[], context: ProjectContext = CONTEXT) {
    const grounded = ground(prompt, calls, undefined, context);
    if (grounded.status !== 'grounded' || grounded.groundingBasis === undefined) {
        throw new Error(`Expected "${prompt}" to ground as an ordinary card with a basis.`);
    }
    return grounded.groundingBasis;
}

function refine(
    card: { prompt: string; calls: readonly ProviderCall[] },
    refinement: string,
    calls: readonly ProviderCall[],
    context: ProjectContext = CONTEXT
) {
    return ground(refinement, calls, cardBasis(card.prompt, card.calls, context), context);
}

function payloadOf(action: { payload?: unknown }): Record<string, unknown> {
    const { payload } = action;
    return typeof payload === 'object' && payload !== null ? Object.fromEntries(Object.entries(payload)) : {};
}

/** Each grounded command by type, target and the value arguments it carries, guards left out. */
function commandsOf(result: ReturnType<typeof ground>) {
    if (result.status !== 'grounded') {
        return result;
    }
    return result.actions.map((action) => {
        const payload = payloadOf(action);
        return {
            type: action.type,
            ...Object.fromEntries(
                ['trackId', 'deviceId', 'paramId', 'deltaDb', 'gainDb', 'gain', 'pan', 'value'].flatMap((key) =>
                    payload[key] === undefined ? [] : [[key, payload[key]]]
                )
            ),
        };
    });
}

const P0_CARD = { prompt: P0, calls: P0_PLAN };
const P1_CARD = { prompt: P1, calls: P1_PLAN };
const PD_CARD = { prompt: PD, calls: PD_PLAN };

describe('binding a terse refinement to the pending card it refines', () => {
    describe('against a one-command level card (P0)', () => {
        it('row 1: "less, make it 1.5 dB" keeps the pending direction and admits -1.5 dB', () => {
            const result = refine(P0_CARD, 'less, make it 1.5 dB', [vocalsBy(-1.5)]);

            expect(commandsOf(result)).toEqual([{ type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 }]);
            expect(result.status === 'grounded' ? result.refinement?.keptDirectionActionIndexes : null).toEqual([0]);
        });

        it('row 1: refuses the sign or form the refinement did not keep', () => {
            expect(refine(P0_CARD, 'less, make it 1.5 dB', [vocalsBy(1.5)]).status).toBe('rejected');
            expect(
                refine(P0_CARD, 'less, make it 1.5 dB', [
                    { name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: -1.5 } },
                ]).status
            ).toBe('rejected');
            expect(
                refine(P0_CARD, 'less, make it 1.5 dB', [
                    { name: 'setTrackGain', arguments: { trackId: 'track-vocals', gain: 0.7 } },
                ]).status
            ).toBe('rejected');
        });

        it('row 2: "less, make it 4 dB" is more than the pending 3 dB and is refused', () => {
            const result = refine(P0_CARD, 'less, make it 4 dB', [vocalsBy(-4)]);

            expect(result).toMatchObject({ status: 'rejected', rejectionReason: expect.stringContaining('"less"') });
        });

        it('row 2: "less" still compares when the refinement text grounds the change by itself', () => {
            expect(refine(P0_CARD, 'less, turn Vocals down 4 dB', [vocalsBy(-4)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('"less"'),
            });
            expect(commandsOf(refine(P0_CARD, 'less, turn Vocals down 1.5 dB', [vocalsBy(-1.5)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
            ]);
        });

        it('row 3: a signed figure with no connector asks whether it is a level or a change', () => {
            const result = refine(P0_CARD, 'make it -6 dB', [vocalsBy(-6)]);

            expect(result.status).toBe('clarify');
            expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain('-6 dB');
        });

        it('row 4: "put Vocals at -6 dB" admits an absolute level in place of the change', () => {
            const result = refine(P0_CARD, 'put Vocals at -6 dB', [
                { name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: -6 } },
            ]);

            expect(commandsOf(result)).toEqual([{ type: 'setTrackGain', trackId: 'track-vocals', gainDb: -6 }]);
            expect(refine(P0_CARD, 'put Vocals at -6 dB', [vocalsBy(-6)]).status).toBe('rejected');
        });

        it('row 15c: "and the snare too" is refused, since nothing grounds a value for the Snare', () => {
            expect(refine(P0_CARD, 'and the snare too', [vocalsBy(-3), snareBy(-3)]).status).toBe('rejected');
            expect(refine(P0_CARD, 'and the snare too', [vocalsBy(-3)]).status).toBe('rejected');
        });

        it('row 16: a bare "less" asks how much less', () => {
            const result = refine(P0_CARD, 'less', [vocalsBy(-3)]);

            expect(result.status).toBe('clarify');
            expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain('How much less');
        });

        it('row 17: a track named "Less" neither hides the comparative nor becomes the target', () => {
            const context = projectContext([...BASE_TRACKS, projectTrack('track-less', 'Less')]);
            const lessGain = { name: 'setTrackGain', arguments: { trackId: 'track-less', deltaDb: -1.5 } };

            expect(commandsOf(refine(P0_CARD, 'less, make it 1.5 dB', [vocalsBy(-1.5)], context))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
            ]);
            expect(refine(P0_CARD, 'less, make it 4 dB', [vocalsBy(-4)], context).status).toBe('rejected');
            expect(refine(P0_CARD, 'less, make it 1.5 dB', [lessGain], context).status).toBe('rejected');
        });

        it('row 21: a refinement that restates the whole request still admits', () => {
            expect(commandsOf(refine(P0_CARD, 'turn Vocals down 3 dB', [vocalsBy(-3)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
            ]);
            expect(commandsOf(refine(P0_CARD, 'turn Vocals down 1.5 dB', [vocalsBy(-1.5)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
            ]);
        });
    });

    describe('against a two-command card that protects the Drum Bus (P1)', () => {
        it('row 5: "make it 1.5 dB" names neither change and asks which', () => {
            const result = refine(P1_CARD, 'make it 1.5 dB', [vocalsBy(-1.5), snareBy(-2)]);

            expect(result.status).toBe('clarify');
        });

        it('row 6: "make the vocals 1.5 dB" binds the Vocals and carries the Snare unchanged', () => {
            const result = refine(P1_CARD, 'make the vocals 1.5 dB', [vocalsBy(-1.5), snareBy(-2)]);

            expect(commandsOf(result)).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
            ]);
            expect(refine(P1_CARD, 'make the vocals 1.5 dB', [vocalsBy(-1.5), snareBy(-1.5)]).status).toBe('rejected');
        });

        it('row 7: "not the snare" removes the Snare and protects it', () => {
            const result = refine(P1_CARD, 'not the snare', [vocalsBy(-3)]);

            expect(commandsOf(result)).toEqual([{ type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 }]);
            expect(result.status === 'grounded' ? result.groundingBasis?.protectedUnchanged : null).toEqual(
                expect.arrayContaining([
                    { id: 'track-snare', name: 'Snare' },
                    { id: 'track-drum-bus', name: 'Drum Bus' },
                ])
            );
        });

        it('row 8: "not the snare" with the Snare kept is refused', () => {
            const result = refine(P1_CARD, 'not the snare', [vocalsBy(-3), snareBy(-2)]);

            expect(result).toMatchObject({ status: 'rejected', rejectionReason: expect.stringContaining('removes') });
        });

        it('row 8: a removal naming nothing on the card, or only part of a name, is refused', () => {
            expect(refine(P1_CARD, 'not the bass', [vocalsBy(-3), snareBy(-2)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('names no single'),
            });
            expect(refine(P1_CARD, 'not the snare drum', [vocalsBy(-3)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('names no single'),
            });
            expect(commandsOf(refine(P1_CARD, 'leave the snare alone', [vocalsBy(-3)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
            ]);
        });

        it('row 9: dropping the Vocals as well is refused as a silent omission', () => {
            expect(refine(P1_CARD, 'not the snare', [])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('omits'),
            });
            expect(refine(P1_CARD, 'make the vocals 1.5 dB', [vocalsBy(-1.5)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('omits'),
            });
        });

        it('row 10: a Bass pan nobody asked for is refused', () => {
            const result = refine(P1_CARD, 'make the vocals 1.5 dB', [
                vocalsBy(-1.5),
                snareBy(-2),
                { name: 'setTrackPan', arguments: { trackId: 'track-bass', pan: -30 } },
            ]);

            expect(result.status).toBe('rejected');
        });

        it('row 11: retargeting the Vocals change to another track is refused', () => {
            const bass = { name: 'setTrackGain', arguments: { trackId: 'track-bass', deltaDb: -1.5 } };

            expect(refine(P1_CARD, 'make the vocals 1.5 dB', [bass, snareBy(-2)]).status).toBe('rejected');
        });

        it('row 12: the Drum Bus the request left unchanged stays protected through the refinement', () => {
            const drumBus = { name: 'setTrackGain', arguments: { trackId: 'track-drum-bus', deltaDb: -1 } };
            const result = refine(P1_CARD, 'make the vocals 1.5 dB and turn the Drum Bus down 1 dB', [
                vocalsBy(-1.5),
                snareBy(-2),
                drumBus,
            ]);

            expect(result).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('"Drum Bus"'),
            });
        });

        it('row 15: a value change and a removal together admit', () => {
            expect(commandsOf(refine(P1_CARD, 'make the vocals 1.5 dB, not the snare', [vocalsBy(-1.5)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
            ]);
        });

        it('row 15b: an added pan grounds in the refinement text beside the inherited change', () => {
            const bassPan = { name: 'setTrackPan', arguments: { trackId: 'track-bass', pan: -30 } };
            const result = refine(P1_CARD, 'make the vocals 1.5 dB, not the snare, and pan Bass 30% left', [
                vocalsBy(-1.5),
                bassPan,
            ]);

            expect(commandsOf(result)).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
                { type: 'setTrackPan', trackId: 'track-bass', pan: -30 },
            ]);
            expect(result.status === 'grounded' ? result.refinement : null).toBeDefined();
        });

        it('row 19: an inherited command whose target left the project is refused', () => {
            const basis = cardBasis(P1, P1_PLAN);
            const withoutSnare = projectContext(BASE_TRACKS.filter((track) => track.id !== 'track-snare'));

            expect(ground('make the vocals 1.5 dB', [vocalsBy(-1.5), snareBy(-2)], basis, withoutSnare)).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('track-snare is no longer in the project'),
            });
        });

        it('row 19: an inherited target the request text no longer names uniquely is refused', () => {
            const basis = cardBasis(P1, P1_PLAN);
            const twoVocals = projectContext([...BASE_TRACKS, projectTrack('track-vocals-double', 'Vocals')]);

            expect(ground('make the snare 1 dB', [vocalsBy(-3), snareBy(-1)], basis, twoVocals)).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('no longer grounds'),
            });
        });

        it('row 21: a refinement restating the whole request admits', () => {
            expect(commandsOf(refine(P1_CARD, P1, [vocalsBy(-3), snareBy(-2)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
            ]);
        });
    });

    describe('against a device parameter card (Pd)', () => {
        it('admits a new percentage inside the parameter range', () => {
            expect(commandsOf(refine(PD_CARD, '50%', [reverbMix(50)]))).toEqual([
                { type: 'setDeviceParameter', deviceId: 'device-reverb', paramId: 'mix', value: 50 },
            ]);
        });

        it('row 13: "150%" is outside the Mix range and is refused', () => {
            expect(refine(PD_CARD, '150%', [reverbMix(150)]).status).toBe('rejected');
            expect(refine(PD_CARD, '150%', [reverbMix(100)]).status).toBe('rejected');
        });

        it('row 14: "3 dB" is not the unit the Mix parameter takes and is refused', () => {
            expect(refine(PD_CARD, '3 dB', [reverbMix(3)]).status).toBe('rejected');
        });
    });

    describe('row 20: without a basis', () => {
        it('grounds byte-identically to a call that names no refinement basis', () => {
            const requests: Array<[string, readonly ProviderCall[]]> = [
                [P0, P0_PLAN],
                [P1, P1_PLAN],
                ['less, make it 1.5 dB', [vocalsBy(-1.5)]],
                ['not the snare', [vocalsBy(-3)]],
                [PD, PD_PLAN],
            ];
            for (const [prompt, calls] of requests) {
                const withoutKey = bridgeGroundedLlmToolCalls({ calls, context: CONTEXT, prompt });
                const withUndefined = bridgeGroundedLlmToolCalls({
                    calls,
                    context: CONTEXT,
                    prompt,
                    refinementBasis: undefined,
                });

                expect(JSON.stringify(withUndefined)).toBe(JSON.stringify(withoutKey));
                expect(withoutKey).not.toHaveProperty('refinement');
                expect(withoutKey).not.toHaveProperty('clarification');
            }
        });

        it('refuses a terse refinement exactly as an unrelated request', () => {
            expect(ground('less, make it 1.5 dB', [vocalsBy(-1.5)]).status).toBe('rejected');
        });
    });
});

const runtimeMocks = vi.hoisted(() => ({
    generateWebLlmCompletion: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
    resolveToasterPadBinding: vi.fn(() => null),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({ getBackendChain: () => ['webllm'] }));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({ resolveBackend: () => 'webllm' }));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackMute: runtimeMocks.setTrackMute,
    setTrackPan: runtimeMocks.setTrackPan,
    setTrackSoloGate: runtimeMocks.setTrackSoloGate,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
}));

function storeTrack(id: string, name: string): Track {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

type ProposalScript = {
    calls: readonly ProviderCall[];
    refines?: () => string;
    beforeProposal?: () => void;
    /** What the provider's plan says its batch leaves unchanged; a first card restates its request's protections. */
    protectedTargetIds?: readonly string[];
};

function asCommandBatchProposal(script: ProposalScript): ProviderCall {
    const { calls } = script;
    const refines = script.refines?.();
    const proposal: ProviderCall = {
        name: 'command.batch.propose',
        arguments: {
            commands: calls.map((call) => ({ name: call.name, arguments: call.arguments })),
            plan: {
                semantic: { classification: 'simple', uncertainty: [] },
                objective: 'Apply the requested level changes.',
                constraints: [],
                scope: {
                    targetIds: [
                        ...new Set(
                            calls.flatMap((call) =>
                                typeof call.arguments.trackId === 'string' ? [call.arguments.trackId] : []
                            )
                        ),
                    ],
                    targetRanges: [],
                    protectedTargetIds: Array.from(script.protectedTargetIds ?? []),
                    protectedRanges: [],
                },
                capabilityIds: [...new Set(calls.map((call) => call.name))],
                assetIds: [],
                alternatives: [],
                validationStrategy: ['Validate exact track identities and values.'],
                stoppingConditions: ['Stop if any target precondition fails.'],
            },
        },
    };
    if (refines !== undefined) {
        proposal.arguments.refines = refines;
    }
    return proposal;
}

/** Each planning run is a discovery turn and a proposal turn; a run past the last script repeats it. */
function scriptProvider(scripts: readonly ProposalScript[]): void {
    let turn = 0;
    runtimeMocks.generateWebLlmCompletion.mockImplementation(() => {
        turn += 1;
        const script = scripts[Math.min(Math.floor((turn - 1) / 2), scripts.length - 1)];
        if (script === undefined) {
            throw new Error('Expected a scripted planning run.');
        }
        if (turn % 2 === 1) {
            const names = [...new Set(script.calls.map((call) => call.name))];
            return Promise.resolve(
                JSON.stringify([{ name: 'agent.catalog.discover', arguments: { category: 'command', names } }])
            );
        }
        script.beforeProposal?.();
        return Promise.resolve(JSON.stringify([asCommandBatchProposal(script)]));
    });
}

async function sendChatMessage(prompt: string) {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt);
}

function proposedIds(): string[] {
    return (pendingActionConfirmationStore.value?.confirmations ?? [])
        .filter((confirmation) => confirmation.status === 'proposed')
        .map((confirmation) => confirmation.id);
}

function onlyProposedId(): string {
    const ids = proposedIds();
    if (ids.length !== 1) {
        throw new Error(`Expected exactly one pending card, found ${String(ids.length)}.`);
    }
    return ids[0]!;
}

function lastAssistantText(): string {
    const message = chatStore.value?.messages.findLast((candidate) => candidate.role === 'assistant');
    return `${message?.content ?? ''} ${message?.error ?? ''}`;
}

function pendingLevels(confirmationId: string) {
    return (getPendingActionConfirmation(confirmationId)?.actions ?? []).map((action) => {
        const payload = payloadOf(action);
        return { type: action.type, trackId: payload.trackId, deltaDb: payload.deltaDb, gainDb: payload.gainDb };
    });
}

function getTrack(id: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === id);
    if (!track) {
        throw new Error(`Expected track ${id}`);
    }
    return track;
}

describe('refining a held card through the chat', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('refinement value binding test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: vi.fn(() => Promise.resolve()), on: vi.fn(() => () => undefined) });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [
                storeTrack('track-vocals', 'Vocals'),
                storeTrack('track-snare', 'Snare'),
                storeTrack('track-drum-bus', 'Drum Bus'),
                storeTrack('track-bass', 'Bass'),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        clearUndoHistory();
        resetAiWorkflowCommandPreflightFixture();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('row 6: replaces the card with the bound Vocals change, diffs it, and applies it once', async () => {
        let pendingId = '';
        scriptProvider([
            { calls: P1_PLAN, protectedTargetIds: ['track-drum-bus'] },
            { calls: [vocalsBy(-1.5), snareBy(-2)], refines: () => pendingId },
        ]);
        await sendChatMessage(P1);
        pendingId = onlyProposedId();
        expect(getPendingActionConfirmation(pendingId)?.approvalSnapshot.groundingBasis?.rootText).toBe(P1);

        await sendChatMessage('make the vocals 1.5 dB');

        const replacementId = onlyProposedId();
        expect(replacementId).not.toBe(pendingId);
        expect(getPendingActionConfirmation(replacementId)).toMatchObject({ supersedes: pendingId });
        expect(pendingLevels(replacementId)).toEqual([
            { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5, gainDb: undefined },
            { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2, gainDb: undefined },
        ]);
        expect(getAgentApprovalView({ confirmationId: replacementId })?.previousProposalDiff).toMatchObject({
            changes: [{ kind: 'changed', fields: [{ field: 'deltaDb', previous: '-3 dB', next: '-1.5 dB' }] }],
            unchangedCount: 1,
        });
        expect(getPendingActionConfirmation(replacementId)?.actionLabels[0]).toContain(
            'direction kept from the pending proposal'
        );

        await expect(confirmPendingChatActions({ confirmationId: replacementId })).resolves.toEqual({
            status: 'executed',
        });
        expect(getTrack('track-vocals').gain).toBeCloseTo(10 ** (-1.5 / 20), 6);
        expect(getTrack('track-snare').gain).toBeCloseTo(10 ** (-2 / 20), 6);
    });

    it('row 7: "not the snare" removes the Snare row and protects both the Snare and the Drum Bus', async () => {
        let pendingId = '';
        scriptProvider([
            { calls: P1_PLAN, protectedTargetIds: ['track-drum-bus'] },
            { calls: [vocalsBy(-3)], refines: () => pendingId },
        ]);
        await sendChatMessage(P1);
        pendingId = onlyProposedId();

        await sendChatMessage('not the snare');

        const replacementId = onlyProposedId();
        expect(replacementId).not.toBe(pendingId);
        expect(pendingLevels(replacementId)).toEqual([
            { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3, gainDb: undefined },
        ]);
        const replacement = getPendingActionConfirmation(replacementId);
        expect(replacement?.protectedUnchanged.map((object) => object.id)).toEqual(
            expect.arrayContaining(['track-snare', 'track-drum-bus'])
        );
        expect(replacement?.approvalSnapshot.commandBatch?.authority.scope.protectedTargetIds).toEqual(
            expect.arrayContaining(['track-snare', 'track-drum-bus'])
        );
        expect(getAgentApprovalView({ confirmationId: replacementId })?.previousProposalDiff).toMatchObject({
            changes: [{ kind: 'removed', actionType: 'setTrackGain' }],
            unchangedCount: 1,
        });
    });

    it('row 12: refuses a refinement that changes the Drum Bus the request left unchanged', async () => {
        let pendingId = '';
        const drumBus = { name: 'setTrackGain', arguments: { trackId: 'track-drum-bus', deltaDb: -1 } };
        scriptProvider([
            { calls: P1_PLAN, protectedTargetIds: ['track-drum-bus'] },
            { calls: [vocalsBy(-1.5), snareBy(-2), drumBus], refines: () => pendingId },
        ]);
        await sendChatMessage(P1);
        pendingId = onlyProposedId();

        await sendChatMessage('make the vocals 1.5 dB and turn the Drum Bus down 1 dB');

        expect(proposedIds()).toEqual([pendingId]);
        expect(lastAssistantText()).toContain('Drum Bus');
    });

    it('row 18: a refinement of a refinement keeps the root text and every protection', async () => {
        let pendingId = '';
        const drumBus = { name: 'setTrackGain', arguments: { trackId: 'track-drum-bus', deltaDb: -1 } };
        scriptProvider([
            { calls: P1_PLAN, protectedTargetIds: ['track-drum-bus'] },
            { calls: [vocalsBy(-3)], refines: () => pendingId },
            { calls: [vocalsBy(-1.5)], refines: () => pendingId },
            { calls: [vocalsBy(-1.5), drumBus], refines: () => pendingId },
        ]);
        await sendChatMessage(P1);
        pendingId = onlyProposedId();
        await sendChatMessage('not the snare');
        pendingId = onlyProposedId();

        await sendChatMessage('less, make it 1.5 dB');

        const secondRefinementId = onlyProposedId();
        expect(secondRefinementId).not.toBe(pendingId);
        expect(pendingLevels(secondRefinementId)).toEqual([
            { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5, gainDb: undefined },
        ]);
        const basis = getPendingActionConfirmation(secondRefinementId)?.approvalSnapshot.groundingBasis;
        expect(basis?.rootText).toBe(P1);
        expect(basis?.protectedUnchanged.map((object) => object.id)).toEqual(
            expect.arrayContaining(['track-snare', 'track-drum-bus'])
        );
        pendingId = secondRefinementId;

        await sendChatMessage('make the vocals 1.5 dB and turn the Drum Bus down 1 dB');

        expect(proposedIds()).toEqual([secondRefinementId]);
        expect(lastAssistantText()).toContain('Drum Bus');
    });

    it('row 19: refuses an inherited command whose target was deleted from the project', async () => {
        let pendingId = '';
        scriptProvider([
            { calls: P1_PLAN, protectedTargetIds: ['track-drum-bus'] },
            { calls: [vocalsBy(-1.5), snareBy(-2)], refines: () => pendingId },
        ]);
        await sendChatMessage(P1);
        pendingId = onlyProposedId();
        const current = trackStore.value;
        trackStore.set({ ...current!, tracks: current!.tracks.filter((track) => track.id !== 'track-snare') });

        await sendChatMessage('make the vocals 1.5 dB');

        expect(proposedIds().filter((id) => id !== pendingId)).toEqual([]);
        expect(getPendingActionConfirmation(pendingId)?.supersededBy).toBeNull();
        expect(lastAssistantText()).toContain('track-snare is no longer in the project');
    });
});
