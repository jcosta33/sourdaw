import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    defaultVcaGroupState,
    markerStore,
    trackStore,
    vcaGroupStore,
    type Clip,
    type Track,
} from '#/modules/Arrangement/stores';
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
import { canonicalJson } from '#/utils/canonicalDigest';
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
import { validateRefinedProposalActions } from '../../validators/admitProposalRefinement';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { proposalCommandShape } from '../agentReference/proposalCommandShape';
import { readStoredCardRemoval } from '../agentReference/readStoredCardRemoval';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
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
            expect(refine(P0_CARD, 'less, turn Vocals down 1.5 dB, more', [vocalsBy(-1.5)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('both less and more'),
            });
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

        it('row 6: an inherited call changes nothing but the value its clause binds', () => {
            const vocalsWithExtra = {
                name: 'setTrackGain',
                arguments: { trackId: 'track-vocals', deltaDb: -1.5, automationRecordingPolicy: 'suppressed' },
            };

            expect(refine(P1_CARD, 'make the vocals 1.5 dB', [vocalsWithExtra, snareBy(-2)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('automationRecordingPolicy'),
            });
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

        it('row 8: a removal holds even when the refinement text grounds the kept command by itself', () => {
            const result = refine(P1_CARD, 'turn Vocals down 3 dB and turn Snare down 2 dB, but drop the snare gain', [
                vocalsBy(-3),
                snareBy(-2),
            ]);

            expect(result).toMatchObject({ status: 'rejected', rejectionReason: expect.stringContaining('removes') });
        });

        it('row 8: a removal naming only part of a name is refused or asked, and "not" an object off the card protects it', () => {
            const bassKept = refine(P1_CARD, 'not the bass', [vocalsBy(-3), snareBy(-2)]);

            expect(commandsOf(bassKept)).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
            ]);
            expect(bassKept.status === 'grounded' ? bassKept.groundingBasis?.protectedUnchanged : null).toEqual(
                expect.arrayContaining([{ id: 'track-bass', name: 'Bass' }])
            );
            expect(refine(P1_CARD, 'drop the bass', [vocalsBy(-3), snareBy(-2)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('names no single'),
            });
            expect(refine(P1_CARD, 'not the snare drum', [vocalsBy(-3)]).status).toBe('clarify');
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

        it('row 15: a value bound to a command the same refinement removes is refused', () => {
            expect(refine(P1_CARD, 'make the snare 1 dB, not the snare', [vocalsBy(-3)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining(
                    '1 dB in "make the snare 1 dB" can only mean a pending change'
                ),
            });
        });

        it('a figure binds only among the commands the refinement keeps', () => {
            const result = refine(P1_CARD, 'not the vocals, make it 1 dB', [snareBy(-1)]);

            expect(commandsOf(result)).toEqual([{ type: 'setTrackGain', trackId: 'track-snare', deltaDb: -1 }]);
            expect(result.status === 'grounded' ? result.refinement?.keptDirectionActionIndexes : null).toEqual([0]);
            expect(refine(P1_CARD, 'not the vocals, make it 1 dB', [snareBy(-2)]).status).toBe('rejected');
        });

        it('a figure whose only pending change of its unit is removed is refused by that figure', () => {
            const bassPan = { name: 'setTrackPan', arguments: { trackId: 'track-bass', pan: -30 } };
            const card = { prompt: 'turn Vocals down 3 dB and pan Bass 30% left', calls: [vocalsBy(-3), bassPan] };
            const result = refine(card, 'not the vocals, make it 1 dB', [bassPan]);

            expect(result).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining(
                    '1 dB in "make it 1 dB" can only mean a pending change the refinement removes'
                ),
            });
            expect(result.status === 'rejected' ? result.rejectionReason : '').not.toContain('leaves out');
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

        it('a batch a specialized workflow decides inherits nothing from the card', () => {
            const workflowBatch = groundCompiledCommandBatch({
                toolCalls: [vocalsBy(-1.5), snareBy(-2)],
                context: CONTEXT,
                prompt: 'make the vocals 1.5 dB',
                projectRevision: undefined,
                workflowCapabilityId: 'drum-routing',
                compilerEvidence: undefined,
                selectedCompilations: [],
                transformCommands: [],
                transformTargetIds: [],
                creativeAuthority: undefined,
                providerProposal: null,
                refinementBasis: cardBasis(P1, P1_PLAN),
            });

            expect(workflowBatch.status).toBe('rejected');
        });

        it('calls of one type and an empty target tuple each continue the pending command of their own payload', () => {
            const marker = (name: string, beat: number): ProviderCall => ({
                name: 'addMarker',
                arguments: { name, beat },
            });
            const card = {
                prompt: 'add a marker at beat 0 named Verse and add a marker at beat 16 named Chorus',
                calls: [marker('Verse', 0), marker('Chorus', 16)],
            };
            const basis = cardBasis(card.prompt, card.calls);
            const markerKey = canonicalJson(['addMarker', []]);
            expect(
                basis.commands.map((command) => proposalCommandShape.targetKey(command.type, command.payload))
            ).toEqual([markerKey, markerKey]);

            // The target tuple names neither marker, so each call continues the one pending marker
            // whose payload it carries, in whatever order the batch lists them.
            const result = ground('thanks', [marker('Chorus', 16), marker('Verse', 0)], basis);

            const commands = result.status === 'grounded' ? result.groundingBasis?.commands : undefined;

            expect(ground('thanks', card.calls).status).toBe('rejected');
            expect(result.status).toBe('grounded');
            expect(commands?.map((command) => [command.source, command.sourceCallIndex])).toEqual([
                [0, 1],
                [0, 0],
            ]);
        });

        it('row 18: the chain keeps its root request even once no command reads it', () => {
            const restated = 'turn Vocals down 1.5 dB and turn Snare down 2 dB';
            const result = refine(P1_CARD, restated, [vocalsBy(-1.5), snareBy(-2)]);
            const basis = result.status === 'grounded' ? result.groundingBasis : undefined;

            expect(basis?.commands.map((command) => basis.sources[command.source]?.text)).toEqual([restated, restated]);
            expect(basis?.sources.map((source) => source.text)).toEqual([P1, restated]);
            expect(basis?.rootText).toBe(P1);
        });

        it('row 21: a refinement restating the whole request admits', () => {
            expect(commandsOf(refine(P1_CARD, P1, [vocalsBy(-3), snareBy(-2)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
            ]);
        });
    });

    describe('reading the direction a refinement states against a pending boost', () => {
        const UP_CARD = { prompt: 'turn Vocals up 3 dB', calls: [vocalsBy(3)] };

        it('"by minus 1.5 dB" and "by −1.5 dB" read the spoken and typeset minus as the sign', () => {
            for (const refinement of ['make it by minus 1.5 dB', 'make it by −1.5 dB']) {
                expect(commandsOf(refine(UP_CARD, refinement, [vocalsBy(-1.5)]))).toEqual([
                    { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
                ]);
                expect(refine(UP_CARD, refinement, [vocalsBy(1.5)]).status).toBe('rejected');
            }
        });

        it('"make it minus 1.5 dB" and "make it −1.5 dB" ask, as a signed figure with no connector does', () => {
            for (const refinement of ['make it minus 1.5 dB', 'make it −1.5 dB', 'make it -1.5 dB']) {
                for (const calls of [[vocalsBy(1.5)], [vocalsBy(-1.5)]]) {
                    const result = refine(UP_CARD, refinement, calls);

                    expect(result.status).toBe('clarify');
                    expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain('-1.5 dB');
                }
            }
        });

        it('reads an en dash, a non-breaking hyphen or a spaced hyphen after "by" as the minus sign', () => {
            for (const refinement of ['by –1.5 dB', 'by ‑1.5 dB', 'by - 1.5 dB', 'make it by – 1.5 dB']) {
                expect(commandsOf(refine(UP_CARD, refinement, [vocalsBy(-1.5)]))).toEqual([
                    { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
                ]);
                expect(refine(UP_CARD, refinement, [vocalsBy(1.5)]).status).toBe('rejected');
            }
        });

        it('asks about a dash-signed figure with no connector, as it asks about "-1.5 dB"', () => {
            for (const refinement of ['make it –1.5 dB', 'make it ‑1.5 dB', 'make it - 1.5 dB']) {
                for (const calls of [[vocalsBy(1.5)], [vocalsBy(-1.5)]]) {
                    const result = refine(UP_CARD, refinement, calls);

                    expect(result.status).toBe('clarify');
                    expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain('-1.5 dB');
                }
            }
        });

        it('"drop it 1.5 dB" reads "drop" as down, as any level request does, and admits -1.5 dB', () => {
            expect(commandsOf(refine(UP_CARD, 'drop it 1.5 dB', [vocalsBy(-1.5)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
            ]);
            expect(refine(UP_CARD, 'drop it 1.5 dB', [vocalsBy(1.5)]).status).toBe('rejected');
        });

        it('"bump it 1.5 dB" states a word that may be a direction and asks instead of keeping the boost', () => {
            for (const calls of [[vocalsBy(1.5)], [vocalsBy(-1.5)]]) {
                const result = refine(UP_CARD, 'bump it 1.5 dB', calls);

                expect(result.status).toBe('clarify');
                expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain('"bump"');
            }
        });

        it('a clause with no direction cue still keeps the pending boost', () => {
            for (const refinement of ['less, make it 1.5 dB', 'make it 1.5 dB']) {
                const result = refine(UP_CARD, refinement, [vocalsBy(1.5)]);

                expect(commandsOf(result)).toEqual([{ type: 'setTrackGain', trackId: 'track-vocals', deltaDb: 1.5 }]);
                expect(result.status === 'grounded' ? result.refinement?.keptDirectionActionIndexes : null).toEqual([
                    0,
                ]);
                expect(refine(UP_CARD, refinement, [vocalsBy(-1.5)]).status).toBe('rejected');
            }
        });
    });

    describe('a negated clause removes the change it names, or asks, and never binds a value', () => {
        const UP_CARD = { prompt: 'turn Vocals up 3 dB', calls: [vocalsBy(3)] };
        const AT_CARD = {
            prompt: 'put Vocals at -6 dB',
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: -6 } }],
        };
        const vocalsAt = (gainDb: number): ProviderCall => ({
            name: 'setTrackGain',
            arguments: { trackId: 'track-vocals', gainDb },
        });
        const snareAt = (gainDb: number): ProviderCall => ({
            name: 'setTrackGain',
            arguments: { trackId: 'track-snare', gainDb },
        });

        function statusOf(
            card: { prompt: string; calls: readonly ProviderCall[] },
            refinement: string,
            calls: readonly ProviderCall[]
        ) {
            return { refinement, calls, status: refine(card, refinement, calls).status };
        }

        it('against a pending boost, a negated cut, lower, turn-down or louder asks', () => {
            const refinements = [
                "don't cut it 2 dB",
                'do not lower it by 2 dB',
                'never turn it down 2 dB',
                'not louder than 2 dB',
            ];
            for (const refinement of refinements) {
                for (const calls of [[vocalsBy(-2)], [vocalsBy(2)]]) {
                    expect(statusOf(UP_CARD, refinement, calls)).toEqual({ refinement, calls, status: 'clarify' });
                }
            }
        });

        it('against a pending cut, "don\'t raise it 2 dB" asks rather than admitting +2 dB', () => {
            for (const calls of [[vocalsBy(2)], [vocalsBy(-2)]]) {
                const result = refine(P0_CARD, "don't raise it 2 dB", calls);

                expect(result.status).toBe('clarify');
                expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain(
                    '"don\'t raise it 2 dB" says what not to do'
                );
            }
        });

        it('against a pending absolute level, "don\'t drop it 3 dB" asks rather than landing at -9 dB', () => {
            for (const calls of [[vocalsAt(-9)], [vocalsAt(-3)]]) {
                expect(statusOf(AT_CARD, "don't drop it 3 dB", calls)).toMatchObject({ status: 'clarify' });
            }
        });

        it('"not", "except", "except for" or "without" before a pending track removes its change and protects it', () => {
            for (const refinement of [
                'not the snare',
                'except the snare',
                'except for the snare',
                'without the snare',
            ]) {
                const result = refine(P1_CARD, refinement, [vocalsBy(-3)]);

                expect({ refinement, commands: commandsOf(result) }).toEqual({
                    refinement,
                    commands: [{ type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 }],
                });
                expect(result.status === 'grounded' ? result.groundingBasis?.protectedUnchanged : null).toEqual(
                    expect.arrayContaining([{ id: 'track-snare', name: 'Snare' }])
                );
                expect({ refinement, status: refine(P1_CARD, refinement, P1_PLAN).status }).toEqual({
                    refinement,
                    status: 'rejected',
                });
            }
        });

        it('any other negated clause naming an object or stating a figure asks, whatever the batch keeps', () => {
            const refinements = [
                "don't raise Snare",
                "don't turn Snare up 2 dB",
                'never boost Snare',
                'do not change the snare',
                "don't drop the snare",
                "don't turn the snare down 2 dB",
                "don't turn the bass down 2 dB",
                'make the vocals 1.5 dB, not the snare at 2 dB',
                'make the vocals 1.5 dB, except the snare at 2 dB',
            ];
            for (const refinement of refinements) {
                for (const calls of [[vocalsBy(-3)], P1_PLAN, [vocalsBy(-1.5)], [vocalsBy(-1.5), snareAt(2)]]) {
                    expect(statusOf(P1_CARD, refinement, calls)).toEqual({ refinement, calls, status: 'clarify' });
                }
            }
        });

        it('a negation with an operation word removes only that operation of the object it names, keeping its pan', () => {
            const snarePan = { name: 'setTrackPan', arguments: { trackId: 'track-snare', pan: -30 } };
            const card = {
                prompt: 'turn Vocals down 3 dB, turn Snare down 2 dB and pan Snare 30% left',
                calls: [vocalsBy(-3), snareBy(-2), snarePan],
            };
            const result = refine(card, 'not the snare gain', [vocalsBy(-3), snarePan]);

            expect(commandsOf(result)).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                { type: 'setTrackPan', trackId: 'track-snare', pan: -30 },
            ]);
            expect(refine(card, 'not the snare gain', [vocalsBy(-3)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('omits a pending setTrackPan'),
            });
        });

        it('a negation with no figure naming nothing in the project is left alone, and one naming an object off the card protects it', () => {
            for (const restated of [`${P1}, not too loud`, `${P1} without changing anything else`]) {
                expect({ restated, commands: commandsOf(refine(P1_CARD, restated, P1_PLAN)) }).toEqual({
                    restated,
                    commands: [
                        { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                        { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
                    ],
                });
            }
            const bassProtected = refine(P1_CARD, `${P1}, but not the Bass`, P1_PLAN);

            expect(bassProtected.status).toBe('grounded');
            expect(
                bassProtected.status === 'grounded' ? bassProtected.groundingBasis?.protectedUnchanged : null
            ).toEqual(expect.arrayContaining([{ id: 'track-bass', name: 'Bass' }]));
            expect(refine(P1_CARD, `${P1}, not at 2 dB`, P1_PLAN).status).toBe('clarify');
        });
    });

    describe('a removal names its object by the full name it states first', () => {
        const drumBusBy = (deltaDb: number): ProviderCall => ({
            name: 'setTrackGain',
            arguments: { trackId: 'track-drum-bus', deltaDb },
        });

        it('"leave Drum Bus alone" names the Drum Bus, never what is left once its generic noun is read off', () => {
            const card = {
                prompt: 'turn Vocals down 3 dB and turn Snare down 2 dB, leave Drum Bus alone',
                calls: P1_PLAN,
            };
            for (const refinement of [
                'turn Vocals down 3 dB and turn Snare down 1 dB, leave Drum Bus alone',
                'turn Vocals down 3 dB and turn Snare down 1 dB, leave the Drum Bus alone',
            ]) {
                const result = refine(card, refinement, [vocalsBy(-3), snareBy(-1)]);

                expect({ refinement, commands: commandsOf(result) }).toEqual({
                    refinement,
                    commands: [
                        { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                        { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -1 },
                    ],
                });
            }
        });

        it('"drop the Drum Bus gain" reads its operation word off only because the full name names nothing', () => {
            const card = {
                prompt: 'turn Vocals down 3 dB and turn Drum Bus down 2 dB',
                calls: [vocalsBy(-3), drumBusBy(-2)],
            };

            expect(commandsOf(refine(card, 'turn Vocals down 3 dB, drop the Drum Bus gain', [vocalsBy(-3)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
            ]);
        });

        it('"Bass Mute" names the Bass Mute track, never the mute of the Bass track', () => {
            const context = projectContext([...BASE_TRACKS, projectTrack('track-bass-mute', 'Bass Mute')]);
            const bassMuteCut: ProviderCall = {
                name: 'setTrackGain',
                arguments: { trackId: 'track-bass-mute', deltaDb: -3 },
            };
            const bassMute: ProviderCall = { name: 'muteTrack', arguments: { trackId: 'track-bass', muted: true } };
            const card = { prompt: 'turn Bass Mute down 3 dB and mute track-bass', calls: [bassMuteCut, bassMute] };
            for (const refinement of ['drop Bass Mute', 'not Bass Mute', 'leave Bass Mute alone']) {
                expect({ refinement, commands: commandsOf(refine(card, refinement, [bassMute], context)) }).toEqual({
                    refinement,
                    commands: [{ type: 'muteTrack', trackId: 'track-bass' }],
                });
                expect({ refinement, status: refine(card, refinement, [bassMuteCut], context).status }).toEqual({
                    refinement,
                    status: 'rejected',
                });
            }
        });
    });

    describe('a comparative checks the bound value against the pending one', () => {
        const AT_CARD = {
            prompt: 'put Vocals at -6 dB',
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: -6 } }],
        };
        const vocalsAt = (gainDb: number): ProviderCall => ({
            name: 'setTrackGain',
            arguments: { trackId: 'track-vocals', gainDb },
        });

        it('against a pending mix of 40% (now 25%), "more" asks for above 40% and "less" for below it', () => {
            const rows: Array<[string, number, string]> = [
                ['more, make it 5%', 5, 'rejected'],
                ['less, 5%', 5, 'grounded'],
                ['less, make it 10%', 10, 'grounded'],
                ['more, make it 60%', 60, 'grounded'],
                ['less, make it 60%', 60, 'rejected'],
            ];
            for (const [refinement, value, status] of rows) {
                expect({ refinement, status: refine(PD_CARD, refinement, [reverbMix(value)]).status }).toEqual({
                    refinement,
                    status,
                });
            }
        });

        it('against a pending level of -6 dB (now about -1.9 dB), "less" lands below -6 dB and "more" above it', () => {
            const rows: Array<[string, number, string]> = [
                ['less, put it at -9 dB', -9, 'grounded'],
                ['more, put it at -9 dB', -9, 'rejected'],
                ['more, put it at -3 dB', -3, 'grounded'],
                ['less, put it at -3 dB', -3, 'rejected'],
            ];
            for (const [refinement, gainDb, status] of rows) {
                expect({ refinement, status: refine(AT_CARD, refinement, [vocalsAt(gainDb)]).status }).toEqual({
                    refinement,
                    status,
                });
            }
        });

        it('against a pending move of -3 dB, "less" and "more" compare how far it moves', () => {
            expect(refine(P0_CARD, 'more, make it 4 dB', [vocalsBy(-4)]).status).toBe('grounded');
            expect(refine(P0_CARD, 'more, make it 1.5 dB', [vocalsBy(-1.5)]).status).toBe('rejected');
        });

        it('a landing has no move to compare with a pending move, so "less, at -1 dB" is refused', () => {
            expect(refine(P0_CARD, 'less, at -1 dB', [vocalsAt(-1)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('"less" cannot be compared with the pending'),
            });
        });

        it('against a pending move, a comparative beside the figure asks whether it replaces or adds to the move', () => {
            const rows: Array<[string, number]> = [
                ['turn Vocals down 2 dB more', -2],
                ['turn Vocals down 2 dB more', -5],
                ['turn Vocals down 5 dB less', -5],
                ['turn Vocals down 5 dB less', 2],
                ['make it 1 dB quieter', -1],
                ['make it 1 dB quieter', -4],
                ['make it 3 dB louder', 3],
                ['make it 3 dB louder', 0],
            ];
            for (const [refinement, deltaDb] of rows) {
                expect({
                    refinement,
                    deltaDb,
                    status: refine(P0_CARD, refinement, [vocalsBy(deltaDb)]).status,
                }).toEqual({ refinement, deltaDb, status: 'clarify' });
            }
        });

        it('against a pending absolute level, a comparative beside a landing asks, while a move lands from it', () => {
            expect(refine(AT_CARD, 'put Vocals at -9 dB more', [vocalsAt(-9)]).status).toBe('clarify');
            expect(commandsOf(refine(AT_CARD, 'make it 3 dB quieter', [vocalsAt(-9)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', gainDb: -9 },
            ]);
        });
    });

    describe('a value that is no level binds only an unsigned figure in its own unit', () => {
        const bassPan = (pan: number): ProviderCall => ({
            name: 'setTrackPan',
            arguments: { trackId: 'track-bass', pan },
        });
        const PAN_CARD = { prompt: 'pan Bass 30% left', calls: [bassPan(-30)] };
        const toneDevice: ProjectTrack['devices'][number] = {
            id: 'device-tone',
            type: 'Tone',
            bypassed: false,
            parameters: [{ id: 'tilt', name: 'Tilt', type: 'float', value: 0, minValue: -6, maxValue: 6, unit: 'dB' }],
        };
        const TONE_CONTEXT = projectContext([
            ...BASE_TRACKS,
            projectTrack('track-piano', 'Piano', { deviceCount: 1, devices: [toneDevice] }),
        ]);
        const tilt = (value: number): ProviderCall => ({
            name: 'setDeviceParameter',
            arguments: { deviceId: 'device-tone', paramId: 'tilt', value },
        });
        const TONE_CARD = { prompt: 'set Tone tilt to 3', calls: [tilt(3)] };
        const tempo = (bpm: number): ProviderCall => ({ name: 'setTempo', arguments: { bpm } });
        const TEMPO_CARD = { prompt: 'set tempo to 120', calls: [tempo(120)] };

        it('a signed pan figure asks for the side, whichever minus or dash signs it', () => {
            for (const refinement of [
                'put it at minus 20',
                'put it at -20',
                'put it at −20',
                'put it at - 20',
                'put it at – 20',
                'put it at ‑20',
            ]) {
                for (const pan of [20, -20]) {
                    expect({ refinement, pan, status: refine(PAN_CARD, refinement, [bassPan(pan)]).status }).toEqual({
                        refinement,
                        pan,
                        status: 'clarify',
                    });
                }
            }
            expect(commandsOf(refine(PAN_CARD, 'make it 20 left', [bassPan(-20)]))).toEqual([
                { type: 'setTrackPan', trackId: 'track-bass', pan: -20 },
            ]);
        });

        it('a signed figure for a bipolar device parameter asks, while an unsigned landing binds', () => {
            for (const value of [5, -5]) {
                expect(refine(TONE_CARD, 'make it to minus 5', [tilt(value)], TONE_CONTEXT).status).toBe('clarify');
            }
            expect(commandsOf(refine(TONE_CARD, 'make it to 5', [tilt(5)], TONE_CONTEXT))).toEqual([
                { type: 'setDeviceParameter', deviceId: 'device-tone', paramId: 'tilt', value: 5 },
            ]);
        });

        it('a tempo figure in another unit than bpm asks', () => {
            for (const [refinement, bpm] of [
                ['make it 100 Hz', 100],
                ['make it 50 percent', 50],
            ] as const) {
                const result = refine(TEMPO_CARD, refinement, [tempo(bpm)]);

                expect({ refinement, status: result.status }).toEqual({ refinement, status: 'clarify' });
                expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain('in bpm');
            }
        });
    });

    describe('reading side and direction words outside the object names a refinement states', () => {
        const NAMED_CONTEXT = projectContext([
            ...BASE_TRACKS,
            projectTrack('track-left-guitar', 'Left Guitar'),
            projectTrack('track-up-lead', 'Up Lead'),
            projectTrack('track-down-bass', 'Down Bass'),
        ]);
        const guitarPan = (pan: number): ProviderCall => ({
            name: 'setTrackPan',
            arguments: { trackId: 'track-left-guitar', pan },
        });
        const gainBy = (trackId: string, deltaDb: number): ProviderCall => ({
            name: 'setTrackGain',
            arguments: { trackId, deltaDb },
        });
        const GUITAR_CARD = { prompt: 'pan Left Guitar 30 left', calls: [guitarPan(-30)] };

        it('"make Left Guitar 20" states no side, so it asks rather than admitting +20', () => {
            for (const calls of [[guitarPan(20)], [guitarPan(-20)]]) {
                const result = refine(GUITAR_CARD, 'make Left Guitar 20', calls, NAMED_CONTEXT);

                expect(result.status).toBe('clarify');
                expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain(
                    'positive or negative'
                );
            }
        });

        it('"make Left Guitar 20 left" reads the side after the name and admits -20', () => {
            expect(
                commandsOf(refine(GUITAR_CARD, 'make Left Guitar 20 left', [guitarPan(-20)], NAMED_CONTEXT))
            ).toEqual([{ type: 'setTrackPan', trackId: 'track-left-guitar', pan: -20 }]);
            expect(refine(GUITAR_CARD, 'make Left Guitar 20 left', [guitarPan(20)], NAMED_CONTEXT).status).toBe(
                'rejected'
            );
        });

        it('a track named "Up Lead" or "Down Bass" supplies no direction to the figure beside it', () => {
            const leadCard = { prompt: 'turn Up Lead down 3 dB', calls: [gainBy('track-up-lead', -3)] };
            const bassCard = { prompt: 'turn Down Bass up 3 dB', calls: [gainBy('track-down-bass', 3)] };

            expect(
                commandsOf(refine(leadCard, 'make Up Lead 1.5 dB', [gainBy('track-up-lead', -1.5)], NAMED_CONTEXT))
            ).toEqual([{ type: 'setTrackGain', trackId: 'track-up-lead', deltaDb: -1.5 }]);
            expect(refine(leadCard, 'make Up Lead 1.5 dB', [gainBy('track-up-lead', 1.5)], NAMED_CONTEXT).status).toBe(
                'rejected'
            );
            expect(
                commandsOf(refine(bassCard, 'make Down Bass 1.5 dB', [gainBy('track-down-bass', 1.5)], NAMED_CONTEXT))
            ).toEqual([{ type: 'setTrackGain', trackId: 'track-down-bass', deltaDb: 1.5 }]);
            expect(
                refine(bassCard, 'make Down Bass 1.5 dB', [gainBy('track-down-bass', -1.5)], NAMED_CONTEXT).status
            ).toBe('rejected');
        });
    });

    describe('moving a pending absolute level', () => {
        const AT_CARD = {
            prompt: 'put Vocals at -6 dB',
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: -6 } }],
        };
        const vocalsAt = (gainDb: number): ProviderCall => ({
            name: 'setTrackGain',
            arguments: { trackId: 'track-vocals', gainDb },
        });

        it('"make it 3 dB quieter" moves the pending -6 dB to -9 dB, never 3 dB below the fader now', () => {
            expect(commandsOf(refine(AT_CARD, 'make it 3 dB quieter', [vocalsAt(-9)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', gainDb: -9 },
            ]);
            expect(refine(AT_CARD, 'make it 3 dB quieter', [vocalsBy(-3)]).status).toBe('rejected');
            expect(refine(AT_CARD, 'make it 3 dB quieter', [vocalsAt(-3)]).status).toBe('rejected');
        });

        it('"make it 3 dB louder" moves the pending -6 dB to -3 dB', () => {
            expect(commandsOf(refine(AT_CARD, 'make it 3 dB louder', [vocalsAt(-3)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', gainDb: -3 },
            ]);
            expect(refine(AT_CARD, 'make it 3 dB louder', [vocalsBy(3)]).status).toBe('rejected');
            expect(refine(AT_CARD, 'make it 3 dB louder', [vocalsAt(-9)]).status).toBe('rejected');
        });
    });

    describe('protections a refinement inherits', () => {
        const decayDevice: ProjectTrack['devices'][number] = {
            ...reverbDevice,
            parameters: [
                { id: 'mix', name: 'Mix', type: 'float', value: 25, minValue: 0, maxValue: 100, unit: '%' },
                { id: 'decay', name: 'Decay', type: 'float', value: 30, minValue: 0, maxValue: 100, unit: '%' },
            ],
        };
        const KEYS_CONTEXT = projectContext([
            ...BASE_TRACKS.filter((track) => track.id !== 'track-keys'),
            projectTrack('track-keys', 'Keys', { deviceCount: 1, devices: [decayDevice] }),
        ]);
        const reverbDecay = (value: number): ProviderCall => ({
            name: 'setDeviceParameter',
            arguments: { deviceId: 'device-reverb', paramId: 'decay', value },
        });

        it('refuses a change to the device parameter the request left unchanged', () => {
            const card = { prompt: 'set Keys Reverb mix to 40%, leaving decay unchanged', calls: [reverbMix(40)] };
            expect(cardBasis(card.prompt, card.calls, KEYS_CONTEXT).protectedUnchanged.map(({ id }) => id)).toEqual([
                'device-reverb:decay',
            ]);

            const result = refine(card, 'set Keys Reverb decay to 60%', [reverbMix(40), reverbDecay(60)], KEYS_CONTEXT);

            expect(result).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('Decay = 30 %", which the request chain leaves unchanged'),
            });
        });

        it('refuses an array-target command whose members include a protected track', () => {
            const kit = {
                name: 'createVcaGroup',
                arguments: { name: 'Kit', trackIds: ['track-snare', 'track-drum-bus'] },
            };
            const result = refine(
                P1_CARD,
                'make the vocals 1.5 dB and create VCA group for Snare and Drum Bus named Kit',
                [vocalsBy(-1.5), snareBy(-2), kit]
            );

            expect(result).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('"Drum Bus", which the request chain leaves unchanged'),
            });
        });

        describe('objects a protected track owns', () => {
            const PROTECTING_CARD = {
                prompt: 'turn Vocals down 3 dB, leaving the Drum Bus unchanged',
                calls: [vocalsBy(-3)],
            };
            const drumGainLane: NonNullable<ProjectContext['automationLanes']>[number] = {
                id: 'lane-drum-gain',
                trackId: 'track-drum-bus',
                parameterId: 'gain',
                name: 'Drum Bus Volume',
                enabled: true,
                minValue: 0,
                maxValue: 2,
                points: [],
            };
            const drumsVca = { id: 'vca-drums', name: 'Drums', gain: 1, muted: false, trackIds: ['track-drum-bus'] };
            const OWNED_CONTEXT: ProjectContext = {
                ...projectContext([projectTrack('track-vocals', 'Vocals'), projectTrack('track-drum-bus', 'Drum Bus')]),
                automationLanes: [drumGainLane],
                vcaGroups: [drumsVca],
            };
            const PROTECTED_REASON = '"Drum Bus", which the request chain leaves unchanged';

            it('refuses a change to an automation lane on the protected track', () => {
                const laneOff = {
                    name: 'setAutomationLaneEnabled',
                    arguments: { laneId: 'lane-drum-gain', enabled: false },
                };
                const unprotected = ground(
                    'disable automation lane Drum Bus Volume',
                    [laneOff],
                    undefined,
                    OWNED_CONTEXT
                );
                expect(unprotected.status).toBe('grounded');

                const result = refine(
                    PROTECTING_CARD,
                    'disable automation lane Drum Bus Volume',
                    [vocalsBy(-3), laneOff],
                    OWNED_CONTEXT
                );

                expect(result).toMatchObject({
                    status: 'rejected',
                    rejectionReason: expect.stringContaining(PROTECTED_REASON),
                });
            });

            it('refuses a change to a VCA group whose members include the protected track', () => {
                const vcaGain = { name: 'setVcaGain', arguments: { vcaGroupId: 'vca-drums', gain: 0.8 } };
                vcaGroupStore.set({ groups: [drumsVca] });
                try {
                    const unprotected = ground('set vca gain Drums to 80%', [vcaGain], undefined, OWNED_CONTEXT);
                    expect(unprotected.status).toBe('grounded');

                    const result = refine(
                        PROTECTING_CARD,
                        'set vca gain Drums to 80%',
                        [vocalsBy(-3), vcaGain],
                        OWNED_CONTEXT
                    );

                    expect(result).toMatchObject({
                        status: 'rejected',
                        rejectionReason: expect.stringContaining(PROTECTED_REASON),
                    });
                } finally {
                    vcaGroupStore.set(defaultVcaGroupState);
                }
            });
        });
    });

    describe('cards no ordinary request decided', () => {
        type CardRoute = Partial<Parameters<typeof groundCompiledCommandBatch>[0]>;

        /** P1 grounded as a card some application route decided, and the basis that card carries. */
        function routedCardBasis(route: CardRoute) {
            const card = groundCompiledCommandBatch({
                toolCalls: P1_PLAN,
                context: CONTEXT,
                prompt: P1,
                projectRevision: undefined,
                workflowCapabilityId: undefined,
                compilerEvidence: undefined,
                selectedCompilations: [],
                transformCommands: [],
                transformTargetIds: [],
                creativeAuthority: undefined,
                providerProposal: null,
                ...route,
            });
            if (card.status !== 'grounded') {
                const reason = card.status === 'rejected' ? card.rejectionReason : card.status;
                throw new Error(`Expected the routed P1 card to ground: ${reason}`);
            }
            return card.groundingBasis;
        }

        function compiledP1(revision: string) {
            const compiled = compileArbitraryCommandList({
                context: CONTEXT,
                revision,
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: asCommandBatchProposal({ calls: P1_PLAN }).arguments.plan,
                            list: {
                                schemaVersion: 1,
                                items: [
                                    ['Vocals', -3],
                                    ['Snare', -2],
                                ].map(([name, deltaDb]) => ({
                                    id: `level-${String(name)}`,
                                    name: 'setTrackGain',
                                    arguments: { deltaDb },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { name },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                })),
                            },
                        },
                    },
                ],
            });
            if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
                throw new Error(compiled.status === 'rejected' ? compiled.reason : 'Expected compiler evidence.');
            }
            return compiled.compilerEvidence;
        }

        it('the ordinary P1 card carries a basis a terse refinement inherits', () => {
            const basis = routedCardBasis({});

            expect(basis?.rootText).toBe(P1);
            expect(ground('make the vocals 1.5 dB', [vocalsBy(-1.5), snareBy(-2)], basis).status).toBe('grounded');
        });

        it('a workflow card carries no basis, so a terse refinement of it inherits nothing', () => {
            const basis = routedCardBasis({ workflowCapabilityId: 'stem-import-starting-mix' });

            expect(basis).toBeUndefined();
            expect(ground('make the vocals 1.5 dB', [vocalsBy(-1.5), snareBy(-2)], basis).status).toBe('rejected');
        });

        it('a batch whose grounded actions are not the provider calls one for one carries no basis', () => {
            const clip = (id: string, name: string, startBeat: number) => ({
                id,
                name,
                type: 'midi' as const,
                startBeat,
                endBeat: startBeat + 8,
                gain: 1,
                locked: false,
                noteCount: 4,
            });
            const intro = clip('clip-midi-intro', 'MIDI Intro', 0);
            const verse = clip('clip-midi-verse', 'MIDI Verse', 8);
            const glueContext: ProjectContext = {
                ...projectContext([
                    projectTrack('track-vocals', 'Vocals', {
                        kind: 'midi',
                        clipCount: 3,
                        clips: [intro, verse, clip('clip-midi-outro', 'MIDI Outro', 16)],
                    }),
                ]),
                glueEligibleClipPairs: [[intro.id, verse.id]],
            };
            const glue: ProviderCall = { name: 'glueClips', arguments: { clipIds: [intro.id, verse.id] } };
            const tempo: ProviderCall = { name: 'setTempo', arguments: { bpm: 130 } };

            // The request cancels its own glue, so grounding drops that call and the card holds one command
            // for two provider calls: no request clause stands behind each command one for one.
            const result = ground(
                "glue MIDI Intro and MIDI Verse clips, but don't glue them due to phase issues, then set tempo to 130",
                [glue, tempo],
                undefined,
                glueContext
            );

            expect(result).toMatchObject({ status: 'grounded', actions: [{ type: 'setTempo' }] });
            expect(result.status === 'grounded' ? result.groundingBasis : null).toBeUndefined();
        });

        it('a compiled command-list card carries no basis, so a terse refinement of it inherits nothing', () => {
            const revision = 'revision-compiled-p1';
            const compilerEvidence = compiledP1(revision);
            const basis = routedCardBasis({
                toolCalls: compilerEvidence.commands,
                prompt: 'turn Vocals down 3 dB and turn Snare down 2 dB',
                compilerEvidence,
                projectRevision: revision,
            });

            expect(basis).toBeUndefined();
            expect(ground('make the vocals 1.5 dB', [vocalsBy(-1.5), snareBy(-2)], basis).status).toBe('rejected');
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

        it('row 14: "3 dB" is not the unit the Mix parameter takes and is asked', () => {
            const result = refine(PD_CARD, '3 dB', [reverbMix(3)]);

            expect(result.status).toBe('clarify');
            expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain('in %');
        });

        it('a figure beside a relative word never lands as an absolute value', () => {
            const refinements: Array<[string, number]> = [
                ['make it 10% more', 10],
                ['make it 10 percent more', 10],
                ['make it 20% less', 20],
                ['decrease it 10%', 10],
                ['make it 10% bigger', 10],
                ['make it 10% smaller', 10],
                ['increase it 10%', 10],
                ['set it to 10% more', 10],
            ];
            for (const [refinement, figure] of refinements) {
                const result = refine(PD_CARD, refinement, [reverbMix(figure)]);

                expect({ refinement, status: result.status }).toEqual({ refinement, status: 'clarify' });
            }
        });

        it('a figure with no connector beside a word this reading cannot tell is asked', () => {
            const result = refine(PD_CARD, 'bump it 50%', [reverbMix(50)]);

            expect(result.status).toBe('clarify');
            expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : '').toContain('"bump"');
        });

        it('a unit word beside the figure states no direction', () => {
            for (const refinement of ['make it 50%', 'make it 50 percent', 'make it 50 per cent']) {
                expect({ refinement, commands: commandsOf(refine(PD_CARD, refinement, [reverbMix(50)])) }).toEqual({
                    refinement,
                    commands: [{ type: 'setDeviceParameter', deviceId: 'device-reverb', paramId: 'mix', value: 50 }],
                });
            }
        });

        it('"wet" beside a mix figure states no direction, while "dry" would invert it and is asked', () => {
            expect(commandsOf(refine(PD_CARD, 'make it 60% wet', [reverbMix(60)]))).toEqual([
                { type: 'setDeviceParameter', deviceId: 'device-reverb', paramId: 'mix', value: 60 },
            ]);
            const dry = refine(PD_CARD, 'make it 60% dry', [reverbMix(60)]);

            expect(dry.status).toBe('clarify');
            expect(dry.status === 'clarify' ? dry.planningOutcome.questions[0] : '').toContain('"dry"');
        });

        it('"wet" beside a figure for a parameter that is no mix is asked', () => {
            const decayDevice: ProjectTrack['devices'][number] = {
                ...reverbDevice,
                parameters: [
                    { id: 'decay', name: 'Decay', type: 'float', value: 25, minValue: 0, maxValue: 100, unit: '%' },
                ],
            };
            const context = projectContext([
                ...BASE_TRACKS.filter((track) => track.id !== 'track-keys'),
                projectTrack('track-keys', 'Keys', { deviceCount: 1, devices: [decayDevice] }),
            ]);
            const decay = (value: number): ProviderCall => ({
                name: 'setDeviceParameter',
                arguments: { deviceId: 'device-reverb', paramId: 'decay', value },
            });
            const card = { prompt: 'set Reverb decay to 40%', calls: [decay(40)] };

            expect(commandsOf(refine(card, 'make it 60%', [decay(60)], context))).toEqual([
                { type: 'setDeviceParameter', deviceId: 'device-reverb', paramId: 'decay', value: 60 },
            ]);
            expect(refine(card, 'make it 60% wet', [decay(60)], context).status).toBe('clarify');
        });

        it('binds a frequency in Hz and a tempo in bpm', () => {
            const filterDevice: ProjectTrack['devices'][number] = {
                id: 'device-filter',
                type: 'Filter',
                bypassed: false,
                parameters: [
                    {
                        id: 'cutoff',
                        name: 'Cutoff',
                        type: 'float',
                        value: 1000,
                        minValue: 20,
                        maxValue: 20000,
                        unit: 'Hz',
                    },
                ],
            };
            const context = projectContext([
                ...BASE_TRACKS,
                projectTrack('track-pad', 'Pad', { deviceCount: 1, devices: [filterDevice] }),
            ]);
            const cutoff = (value: number): ProviderCall => ({
                name: 'setDeviceParameter',
                arguments: { deviceId: 'device-filter', paramId: 'cutoff', value },
            });
            const tempo = (bpm: number): ProviderCall => ({ name: 'setTempo', arguments: { bpm } });

            expect(
                commandsOf(
                    refine(
                        { prompt: 'set Filter cutoff to 1000 Hz', calls: [cutoff(1000)] },
                        'make it 200 Hz',
                        [cutoff(200)],
                        context
                    )
                )
            ).toEqual([{ type: 'setDeviceParameter', deviceId: 'device-filter', paramId: 'cutoff', value: 200 }]);
            const tempoResult = refine({ prompt: 'set tempo to 120', calls: [tempo(120)] }, 'make it 100 bpm', [
                tempo(100),
            ]);

            expect(tempoResult).toMatchObject({ status: 'grounded', actions: [{ type: 'setTempo' }] });
            expect(tempoResult.status === 'grounded' ? payloadOf(tempoResult.actions[0]!) : null).toMatchObject({
                bpm: 100,
            });
        });
    });

    describe('a pending command with no value', () => {
        const bassMute: ProviderCall = { name: 'muteTrack', arguments: { trackId: 'track-bass', muted: true } };

        it('a figure binds past a pending mute to the only pending level', () => {
            const card = { prompt: 'turn Vocals down 3 dB and mute Bass', calls: [vocalsBy(-3), bassMute] };

            expect(commandsOf(refine(card, 'make it 1.5 dB', [vocalsBy(-1.5), bassMute]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
                { type: 'muteTrack', trackId: 'track-bass' },
            ]);
        });

        it('a percentage binds past a pending mute to the only pending parameter, never asking which', () => {
            const card = { prompt: 'set Reverb mix to 40% and mute Bass', calls: [reverbMix(40), bassMute] };

            expect(commandsOf(refine(card, 'make it 50%', [reverbMix(50), bassMute]))).toEqual([
                { type: 'setDeviceParameter', deviceId: 'device-reverb', paramId: 'mix', value: 50 },
                { type: 'muteTrack', trackId: 'track-bass' },
            ]);
        });
    });

    describe('a card that creates a device carries no basis, and pairs its creation by what it creates', () => {
        const compressor: ProviderCall = {
            name: 'addDevice',
            arguments: { trackId: 'track-vocals', deviceType: 'Compressor', binding: 'vocal-compressor' },
        };
        const CREATING = 'add a Compressor to Vocals and turn Vocals down 3 dB';
        const DEVICE_CONTEXT: ProjectContext = {
            ...CONTEXT,
            availableDeviceTypes: [
                {
                    id: 'builtin-compressor',
                    name: 'Compressor',
                    parameters: [
                        {
                            id: 'comp-ratio',
                            name: 'Ratio',
                            type: 'float',
                            value: 4,
                            minValue: 1,
                            maxValue: 20,
                            unit: ':1',
                        },
                    ],
                },
            ],
        };

        function groundedActions(prompt: string, calls: readonly ProviderCall[]) {
            const grounded = ground(prompt, calls, undefined, DEVICE_CONTEXT);
            if (grounded.status !== 'grounded') {
                throw new Error(`Expected "${prompt}" to ground: ${JSON.stringify(grounded)}`);
            }
            return grounded.actions;
        }

        function admission(prompt: string, calls: readonly ProviderCall[]) {
            return validateRefinedProposalActions({
                pendingActions: groundedActions(CREATING, [compressor, vocalsBy(-3)]),
                actions: groundedActions(prompt, calls),
                prompt,
                context: DEVICE_CONTEXT,
                createdObject: proposalCommandShape.createdObject,
                readRemoval: readStoredCardRemoval,
            });
        }

        it('keeps a created device the refinement creates again under a freshly minted id', () => {
            expect(ground(CREATING, [compressor, vocalsBy(-3)], undefined, DEVICE_CONTEXT)).toMatchObject({
                status: 'grounded',
                groundingBasis: undefined,
            });

            expect(
                admission('add a Compressor to Vocals and turn Vocals down 2 dB', [compressor, vocalsBy(-2)])
            ).toEqual({ status: 'valid' });
        });

        it('removes a created device only when the refinement removes it by name', () => {
            expect(admission('turn Vocals down 2 dB, remove the compressor', [vocalsBy(-2)])).toEqual({
                status: 'valid',
            });
            expect(admission('turn Vocals down 2 dB, not the compressor', [vocalsBy(-2)])).toMatchObject({
                status: 'refused',
            });
            expect(admission('turn Vocals down 2 dB', [vocalsBy(-2)])).toMatchObject({
                status: 'refused',
                reason: expect.stringContaining('omits a pending addDevice'),
            });
        });
    });

    describe('a value clause binds only in the closed vocabulary it is read in', () => {
        const UP_CARD = { prompt: 'turn Vocals up 3 dB', calls: [vocalsBy(3)] };
        const AT_CARD = {
            prompt: 'put Vocals at -6 dB',
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: -6 } }],
        };
        const vocalsAt = (gainDb: number): ProviderCall => ({
            name: 'setTrackGain',
            arguments: { trackId: 'track-vocals', gainDb },
        });
        /** Every call a figure could have been read into against a pending level: either sign, moved or landed. */
        const levelCalls = (figure: number): ProviderCall[][] => [
            [vocalsBy(-figure)],
            [vocalsBy(figure)],
            [vocalsBy(-3 - figure)],
            [vocalsAt(-figure)],
            [vocalsAt(figure)],
        ];
        const pitcherDevice: ProjectTrack['devices'][number] = {
            id: 'device-pitcher',
            type: 'Pitcher',
            bypassed: false,
            parameters: [
                {
                    id: 'pitch',
                    name: 'Pitch',
                    type: 'float',
                    value: 0,
                    minValue: -24,
                    maxValue: 24,
                    unit: 'semitones',
                },
            ],
        };
        const PITCH_CONTEXT = projectContext([
            ...BASE_TRACKS,
            projectTrack('track-lead', 'Lead', { deviceCount: 1, devices: [pitcherDevice] }),
        ]);
        const pitch = (value: number): ProviderCall => ({
            name: 'setDeviceParameter',
            arguments: { deviceId: 'device-pitcher', paramId: 'pitch', value },
        });
        const PITCH_CARD = { prompt: 'set Pitcher pitch to 3 semitones', calls: [pitch(3)] };

        it('a pitch landing beside a word outside the vocabulary asks, whatever value the call carries', () => {
            expect(commandsOf(refine(PITCH_CARD, 'set it to 5 semitones', [pitch(5)], PITCH_CONTEXT))).toEqual([
                { type: 'setDeviceParameter', deviceId: 'device-pitcher', paramId: 'pitch', value: 5 },
            ]);
            for (const refinement of [
                'set it to 5 semitones negative',
                'set it to 5 semitones below zero',
                'set it to 2 octaves',
            ]) {
                for (const value of [5, -5, 2, 24]) {
                    expect({
                        refinement,
                        value,
                        status: refine(PITCH_CARD, refinement, [pitch(value)], PITCH_CONTEXT).status,
                    }).toEqual({ refinement, value, status: 'clarify' });
                }
            }
        });

        it('against a pending move, a level clause with a word outside the vocabulary asks on every path', () => {
            const rows: Array<[string, number]> = [
                ['put it at 6 dB negative', 6],
                ['bring it down to 2 dB', 2],
                ['go down to 2 dB', 2],
                ['put it at 3 dB below', 3],
                ['turn it down another 2 dB', 2],
                ['an extra 2 dB', 2],
                ['a further 2 dB', 2],
                ['an additional 2 dB', 2],
                ['2 dB again', 2],
                ['2 dB on top', 2],
                ['not less, make it 1.5 dB', 1.5],
                ['not more, make it 5 dB', 5],
                ['not as much, make it 5 dB', 5],
            ];
            for (const [refinement, figure] of rows) {
                for (const calls of levelCalls(figure)) {
                    expect({ refinement, calls, status: refine(P0_CARD, refinement, calls).status }).toEqual({
                        refinement,
                        calls,
                        status: 'clarify',
                    });
                }
            }
        });

        it('a direction beside a landing asks, while either alone still binds', () => {
            expect(commandsOf(refine(P0_CARD, 'bring it to -2 dB', [vocalsAt(-2)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', gainDb: -2 },
            ]);
            expect(commandsOf(refine(P0_CARD, 'bring it down 2 dB', [vocalsBy(-2)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -2 },
            ]);
            for (const calls of levelCalls(2)) {
                expect(refine(P0_CARD, 'bring it down to 2 dB', calls).status).toBe('clarify');
            }
        });

        it('a symbol touching the figure that is no read sign asks, whichever way the call moves', () => {
            const rows: Array<[{ prompt: string; calls: readonly ProviderCall[] }, string]> = [
                [UP_CARD, 'by ➖1.5 dB'],
                [UP_CARD, 'by ⁻1.5 dB'],
                [UP_CARD, 'by ˗1.5 dB'],
                [P0_CARD, 'by ＋1.5 dB'],
                [P0_CARD, 'by ➕1.5 dB'],
                [P0_CARD, 'by ⁺1.5 dB'],
            ];
            for (const [card, refinement] of rows) {
                for (const calls of [[vocalsBy(-1.5)], [vocalsBy(1.5)]]) {
                    expect({ refinement, calls, status: refine(card, refinement, calls).status }).toEqual({
                        refinement,
                        calls,
                        status: 'clarify',
                    });
                }
            }
            expect(commandsOf(refine(UP_CARD, 'by -1.5 dB', [vocalsBy(-1.5)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
            ]);
        });

        it('"lower" opening the clause is its verb: it moves a pending move down, and a pending level from where it was proposed', () => {
            expect(commandsOf(refine(P0_CARD, 'lower it 2 dB', [vocalsBy(-2)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -2 },
            ]);
            expect(refine(P0_CARD, 'lower it 2 dB', [vocalsBy(2)]).status).toBe('rejected');
            expect(commandsOf(refine(AT_CARD, 'lower it 2 dB', [vocalsAt(-8)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', gainDb: -8 },
            ]);
            expect(refine(AT_CARD, 'lower it 2 dB', [vocalsAt(-2)]).status).toBe('rejected');
            expect(refine(AT_CARD, 'lower it 2 dB', [vocalsBy(-2)]).status).toBe('rejected');
        });

        it('a refinement whose batch inherits nothing still keeps what the chain protects', () => {
            const drumBus = { name: 'setTrackGain', arguments: { trackId: 'track-drum-bus', deltaDb: -2 } };

            expect(
                refine(P1_CARD, 'remove the vocals and the snare, turn Drum Bus down 2 dB more', [drumBus])
            ).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('"Drum Bus", which the request chain leaves unchanged'),
            });
        });
    });

    describe('the clause grammar a refinement is read in', () => {
        const UP_CARD = { prompt: 'turn Vocals up 3 dB', calls: [vocalsBy(3)] };
        const AT_CARD = {
            prompt: 'put Vocals at -6 dB',
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gainDb: -6 } }],
        };
        const vocalsAt = (gainDb: number): ProviderCall => ({
            name: 'setTrackGain',
            arguments: { trackId: 'track-vocals', gainDb },
        });
        /** Every call a figure could have been read into against a pending level: either sign, moved or landed. */
        const levelCalls = (figure: number): ProviderCall[][] => [
            [vocalsBy(-figure)],
            [vocalsBy(figure)],
            [vocalsBy(-3 - figure)],
            [vocalsAt(-figure)],
            [vocalsAt(figure)],
        ];
        const bassPan = (pan: number): ProviderCall => ({
            name: 'setTrackPan',
            arguments: { trackId: 'track-bass', pan },
        });
        const PAN_CARD = { prompt: 'pan Bass 30% left', calls: [bassPan(-30)] };
        const tempo = (bpm: number): ProviderCall => ({ name: 'setTempo', arguments: { bpm } });
        const TEMPO_CARD = { prompt: 'set tempo to 120', calls: [tempo(120)] };

        function questionOf(result: ReturnType<typeof ground>): string {
            return result.status === 'clarify' ? (result.planningOutcome.questions[0] ?? '') : '';
        }

        function expectAsked(
            card: { prompt: string; calls: readonly ProviderCall[] },
            refinements: readonly string[],
            callSets: readonly (readonly ProviderCall[])[],
            context: ProjectContext = CONTEXT
        ) {
            for (const refinement of refinements) {
                for (const calls of callSets) {
                    expect({ refinement, calls, status: refine(card, refinement, calls, context).status }).toEqual({
                        refinement,
                        calls,
                        status: 'clarify',
                    });
                }
            }
        }

        it('a clause naming an object no pending command acts on, by name or id, is an addition and never binds the Vocals', () => {
            const rows: Array<[string, string]> = [
                ['Drums', 'turn Drums down 2 dB'],
                ['Drums', 'make Drums 2 dB'],
                ['Drums', 'raise Drums by 2 dB'],
                ['Drums', 'put Drums at 2 dB'],
                ['Drums VCA', 'turn Drums VCA down 2 dB'],
                ['Drums', 'turn trk-7 down 2 dB'],
            ];
            for (const [name, refinement] of rows) {
                const context: ProjectContext = {
                    ...projectContext([...BASE_TRACKS, projectTrack('trk-7', 'Lead')]),
                    vcaGroups: [
                        { id: 'vca-drums', name, gain: 1, muted: false, trackIds: ['track-snare', 'track-drum-bus'] },
                    ],
                };
                for (const calls of levelCalls(2)) {
                    expect({ refinement, calls, status: refine(P0_CARD, refinement, calls, context).status }).toEqual({
                        refinement,
                        calls,
                        status: 'rejected',
                    });
                }
                // The Vocals change carried unchanged leaves the clause about the other object unanswered.
                expect({ refinement, result: refine(P0_CARD, refinement, [vocalsBy(-3)], context) }).toMatchObject({
                    refinement,
                    result: {
                        status: 'rejected',
                        rejectionReason: expect.stringContaining('No proposed change answers'),
                    },
                });
            }
        });

        it('a track named by symbols alone is an object a clause names, so naming it never binds the Vocals', () => {
            const context = projectContext([...BASE_TRACKS, projectTrack('track-mic', '🎤')]);

            for (const calls of levelCalls(2)) {
                expect({ calls, status: refine(P0_CARD, 'turn 🎤 down 2 dB', calls, context).status }).toEqual({
                    calls,
                    status: 'rejected',
                });
            }
        });

        it('a value clause stating two figures asks which one is meant', () => {
            for (const refinement of ['make it 1.5 or 2 dB', 'make it 1.5 dB 2 dB']) {
                for (const calls of [...levelCalls(1.5), ...levelCalls(2)]) {
                    expect({ refinement, calls, question: questionOf(refine(P0_CARD, refinement, calls)) }).toEqual({
                        refinement,
                        calls,
                        question: expect.stringContaining('states more than one figure'),
                    });
                }
            }
        });

        it('a lone "please" clause is filler beside a bound value', () => {
            for (const refinement of ['make it 1.5 dB, please', 'please, make it 1.5 dB']) {
                expect({ refinement, commands: commandsOf(refine(P0_CARD, refinement, [vocalsBy(-1.5)])) }).toEqual({
                    refinement,
                    commands: [{ type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 }],
                });
            }
        });

        it('a lone "go ahead" clause is filler beside a removal the card still answers', () => {
            const refinement = 'go ahead and remove the snare';

            expect({ refinement, commands: commandsOf(refine(P1_CARD, refinement, [vocalsBy(-3)])) }).toEqual({
                refinement,
                commands: [{ type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 }],
            });
        });

        it('a value for one pending command stated across two clauses asks, in either order and across any separator', () => {
            expectAsked(
                P0_CARD,
                [
                    'turn Vocals up, make it 2 dB',
                    'raise Vocals, make it 2 dB',
                    'turn Vocals up and make it 2 dB',
                    'turn Vocals up but make it 2 dB',
                    'turn Vocals up, and then make it 2 dB',
                    'turn Vocals up, 2 dB',
                    'make it 2 dB, Vocals louder',
                    'Vocals louder. Make it 2 dB',
                ],
                levelCalls(2)
            );
            expectAsked(UP_CARD, ['turn Vocals down, make it 2 dB'], levelCalls(2));
        });

        it('two clauses whose figures are in different units bind two different pending values', () => {
            const card = {
                prompt: 'turn Vocals down 3 dB and set Reverb mix to 40%',
                calls: [vocalsBy(-3), reverbMix(40)],
            };

            expect(commandsOf(refine(card, 'make it 1.5 dB, make it 50%', [vocalsBy(-1.5), reverbMix(50)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
                { type: 'setDeviceParameter', deviceId: 'device-reverb', paramId: 'mix', value: 50 },
            ]);
        });

        it('a clause with no figure keeps the pending value only in the direction it already takes', () => {
            expectAsked(
                P0_CARD,
                ['turn Vocals up', 'turn Vocals up two dB'],
                [[vocalsBy(-3)], [vocalsBy(3)], [vocalsBy(-2)], [vocalsBy(2)]]
            );
            expectAsked(UP_CARD, ['turn Vocals up two dB'], [[vocalsBy(3)], [vocalsBy(2)]]);
            expectAsked(P0_CARD, ['turn Vocals down left'], [[vocalsBy(-3)]]);
            expectAsked(PAN_CARD, ['pan Bass right', 'pan Bass up'], [[bassPan(-30)], [bassPan(30)]]);
            expect(commandsOf(refine(P0_CARD, 'turn Vocals down', [vocalsBy(-3)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
            ]);
            expect(commandsOf(refine(PAN_CARD, 'pan Bass left', [bassPan(-30)]))).toEqual([
                { type: 'setTrackPan', trackId: 'track-bass', pan: -30 },
            ]);
        });

        it('a conjunction opening the refinement, or "please", opens its clause ahead of the verb', () => {
            for (const refinement of ['and make it 1.5 dB', 'then make it 1.5 dB']) {
                expect({ refinement, commands: commandsOf(refine(P0_CARD, refinement, [vocalsBy(-1.5)])) }).toEqual({
                    refinement,
                    commands: [{ type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 }],
                });
            }
            for (const refinement of ['and lower it 2 dB', 'please lower it 2 dB']) {
                expect({ refinement, commands: commandsOf(refine(UP_CARD, refinement, [vocalsBy(-2)])) }).toEqual({
                    refinement,
                    commands: [{ type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -2 }],
                });
            }
        });

        it('asks when anything but whitespace stands between the connector and the figure', () => {
            for (const refinement of ['put it at the 6 dB', 'bring it to a 2 dB cut']) {
                for (const calls of levelCalls(refinement.includes('6') ? 6 : 2)) {
                    const result = refine(P0_CARD, refinement, calls);

                    expect({ refinement, calls, question: questionOf(result) }).toEqual({
                        refinement,
                        calls,
                        question: expect.stringContaining('Words stand between'),
                    });
                }
            }
        });

        it('asks when the value clause quotes text', () => {
            expectAsked(P0_CARD, ['make it 2 dB "down"', "make it 2 dB 'quieter'"], levelCalls(2));
        });

        it('asks when a pan clause states both sides', () => {
            expectAsked(PAN_CARD, ['pan it right 20 left', 'pan it 20 left right'], [[bassPan(20)], [bassPan(-20)]]);
        });

        it('asks when a sign contradicts the direction word beside it', () => {
            for (const card of [P0_CARD, AT_CARD]) {
                expectAsked(card, ['lower it +2 dB', 'raise it -2 dB'], levelCalls(2));
            }
        });

        it('asks when a plain value states a direction beside its landing', () => {
            const result = refine(TEMPO_CARD, 'bring it down to 100 bpm', [tempo(100)]);

            expect(questionOf(result)).toContain('Say where the value should land');
            expect(commandsOf(refine(TEMPO_CARD, 'bring it to 100 bpm', [tempo(100)]))).toEqual([{ type: 'setTempo' }]);
        });

        it('asks about a symbol a space before the figure or touching it after', () => {
            for (const calls of [[vocalsBy(-1.5)], [vocalsBy(1.5)]]) {
                expect(questionOf(refine(UP_CARD, 'by ➖ 1.5 dB', calls))).toContain('"➖"');
            }
            expect(questionOf(refine(PD_CARD, 'set it to 50➖', [reverbMix(50)]))).toContain('"➖"');
        });
    });

    describe('a figureless clause naming a pending object restates it only in its own action words', () => {
        const toggle = (name: string, trackId: string, argument: string, value: boolean): ProviderCall => ({
            name,
            arguments: { trackId, [argument]: value },
        });
        const bassMute = (muted: boolean) => toggle('muteTrack', 'track-bass', 'muted', muted);
        const keysMute = (muted: boolean) => toggle('muteTrack', 'track-keys', 'muted', muted);
        const bassSolo = (soloed: boolean) => toggle('soloTrack', 'track-bass', 'soloed', soloed);
        const bassArm = (armed: boolean) => toggle('armTrack', 'track-bass', 'armed', armed);
        const MUTE_CARD = { prompt: 'mute Bass', calls: [bassMute(true)] };
        const SOLO_CARD = { prompt: 'solo Bass', calls: [bassSolo(true)] };
        const ARM_CARD = { prompt: 'arm Bass', calls: [bassArm(true)] };
        const TWO_MUTES_CARD = { prompt: 'mute Bass and mute Keys', calls: [bassMute(true), keysMute(true)] };

        it('asks when any word but the pending action words and articles stands beside the names', () => {
            const rows: Array<[{ prompt: string; calls: readonly ProviderCall[] }, string, ProviderCall[][]]> = [
                [MUTE_CARD, 'Bass mute off', [[bassMute(false)], [bassMute(true)]]],
                [MUTE_CARD, 'mute Bass off', [[bassMute(false)], [bassMute(true)]]],
                [MUTE_CARD, 'mute Bass only', [[bassMute(false)], [bassMute(true)]]],
                [TWO_MUTES_CARD, 'mute Bass only', [[bassMute(true)], [bassMute(true), keysMute(true)]]],
                [TWO_MUTES_CARD, 'mute just Bass', [[bassMute(true)], [bassMute(true), keysMute(true)]]],
                [TWO_MUTES_CARD, 'mute Bass instead of Keys', [[bassMute(true)], [bassMute(true), keysMute(false)]]],
                [TWO_MUTES_CARD, 'mute Bass excluding Keys', [[bassMute(true)], [bassMute(true), keysMute(true)]]],
                [P1_CARD, 'turn Vocals down only', [[...P1_PLAN], [vocalsBy(-3)]]],
            ];
            for (const [card, refinement, callSets] of rows) {
                for (const calls of callSets) {
                    const result = refine(card, refinement, calls);

                    expect({
                        refinement,
                        calls,
                        question: result.status === 'clarify' ? result.planningOutcome.questions[0] : result.status,
                    }).toEqual({
                        refinement,
                        calls,
                        question: expect.stringContaining('does not restate the pending change'),
                    });
                }
            }
        });

        it('a toggle word binds the value it states for the pending toggle on the object it names', () => {
            const togglesOf = (result: ReturnType<typeof refine>) => {
                if (result.status !== 'grounded') {
                    return result.status;
                }
                return result.actions.map((action) => {
                    const { trackId, muted, soloed, armed } = payloadOf(action);
                    return { type: action.type, trackId, muted, soloed, armed };
                });
            };
            const rows: Array<
                [{ prompt: string; calls: readonly ProviderCall[] }, string, ProviderCall, ProviderCall]
            > = [
                [MUTE_CARD, 'unmute Bass', bassMute(false), bassMute(true)],
                [SOLO_CARD, 'unsolo Bass', bassSolo(false), bassSolo(true)],
                [ARM_CARD, 'disarm Bass', bassArm(false), bassArm(true)],
            ];
            for (const [card, refinement, stated, pending] of rows) {
                expect({ refinement, commands: togglesOf(refine(card, refinement, [stated])) }).toEqual({
                    refinement,
                    commands: [
                        expect.objectContaining({ type: stated.name, trackId: 'track-bass', ...stated.arguments }),
                    ],
                });
                expect({ refinement, status: refine(card, refinement, [pending]).status }).toEqual({
                    refinement,
                    status: 'rejected',
                });
            }
            expect(
                togglesOf(refine(TWO_MUTES_CARD, 'mute Bass and unmute Keys', [bassMute(true), keysMute(false)]))
            ).toEqual([
                expect.objectContaining({ type: 'muteTrack', trackId: 'track-bass', muted: true }),
                expect.objectContaining({ type: 'muteTrack', trackId: 'track-keys', muted: false }),
            ]);
            expect(refine(TWO_MUTES_CARD, 'mute Bass and unmute Keys', [bassMute(true), keysMute(true)]).status).toBe(
                'rejected'
            );
        });

        it('a true toggle word binds true against a pending false toggle on the inherited route', () => {
            const togglesAndLevelsOf = (result: ReturnType<typeof refine>) => {
                if (result.status !== 'grounded') {
                    return result.status;
                }
                return result.actions.map((action) => {
                    const { trackId, muted, soloed, armed, deltaDb } = payloadOf(action);
                    return { trackId, muted, soloed, armed, deltaDb };
                });
            };
            const rows: Array<[string, string, (value: boolean) => ProviderCall]> = [
                ['unmute Bass', 'mute Bass', bassMute],
                ['unsolo Bass', 'solo Bass', bassSolo],
                ['disarm Bass', 'arm Bass', bassArm],
            ];
            const context = projectContext(
                BASE_TRACKS.map((track) =>
                    track.id === 'track-bass' ? { ...track, muted: true, soloed: true, armed: true } : track
                )
            );
            for (const [pendingText, restated, toggle] of rows) {
                const card = {
                    prompt: `turn Vocals down 3 dB and ${pendingText}`,
                    calls: [toggle(false), vocalsBy(-3)],
                };
                const refinement = `make it 2 dB and ${restated}`;
                expect({
                    refinement,
                    commands: togglesAndLevelsOf(refine(card, refinement, [toggle(true), vocalsBy(-2)], context)),
                }).toEqual({
                    refinement,
                    commands: [
                        expect.objectContaining({ trackId: 'track-bass', ...toggle(true).arguments }),
                        expect.objectContaining({ trackId: 'track-vocals', deltaDb: -2 }),
                    ],
                });
                expect({
                    refinement,
                    status: refine(card, refinement, [toggle(false), vocalsBy(-2)], context).status,
                }).toEqual({
                    refinement,
                    status: 'rejected',
                });
            }
        });

        it('refuses a batch leaving out the pending command a refinement clause binds a value to', () => {
            expect(refine(P1_CARD, 'make the vocals 1.5 dB', [snareBy(-2)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining(
                    'leaves out the pending setTrackGain on Vocals change the refinement restates'
                ),
            });
        });

        it('the pending action words alone, with articles, restate it', () => {
            for (const refinement of ['mute Bass', 'mute the Bass']) {
                expect({ refinement, commands: commandsOf(refine(MUTE_CARD, refinement, [bassMute(true)])) }).toEqual({
                    refinement,
                    commands: [{ type: 'muteTrack', trackId: 'track-bass' }],
                });
            }
            expect(commandsOf(refine(P1_CARD, 'turn Vocals down', [...P1_PLAN]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
            ]);
        });
    });

    describe('one removal vocabulary', () => {
        const snarePan: ProviderCall = { name: 'setTrackPan', arguments: { trackId: 'track-snare', pan: -20 } };
        const SNARE_CARD = {
            prompt: 'turn Vocals down 3 dB, turn Snare down 2 dB and pan Snare 20% left',
            calls: [vocalsBy(-3), snareBy(-2), snarePan],
        };

        it('remove, skip, omit and exclude remove the change they name, after an opener', () => {
            for (const refinement of [
                'Remove the snare gain',
                'Skip the snare gain',
                'Omit the snare gain',
                'Exclude the snare gain',
                'Please remove the snare gain',
                'Take out the snare gain',
                'Leave out the snare gain',
                'Would you remove the snare gain',
                'and remove the snare gain',
                'then remove the snare gain',
            ]) {
                expect({
                    refinement,
                    commands: commandsOf(refine(SNARE_CARD, refinement, [vocalsBy(-3), snarePan])),
                }).toEqual({
                    refinement,
                    commands: [
                        { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                        { type: 'setTrackPan', trackId: 'track-snare', pan: -20 },
                    ],
                });
                expect({ refinement, status: refine(SNARE_CARD, refinement, [vocalsBy(-3)]).status }).toEqual({
                    refinement,
                    status: 'rejected',
                });
            }
        });

        it('"Remove the snare" removes every Snare change', () => {
            expect(commandsOf(refine(SNARE_CARD, 'Remove the snare', [vocalsBy(-3)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
            ]);
        });

        it('a bare object name right after a removal continues it on the refinement route', () => {
            const refinement = 'Remove the snare pan and the vocals gain';

            expect(commandsOf(refine(SNARE_CARD, refinement, [snareBy(-2)]))).toEqual([
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
            ]);
            expect(refine(SNARE_CARD, refinement, [snareBy(-2), vocalsBy(-3)])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('the request removes'),
            });
        });

        it('a protection "as is" is consumed on the refinement route, never read as an addition', () => {
            expect(
                commandsOf(
                    refine(P1_CARD, 'make the vocals 1.5 dB, leave Drum Bus as is', [vocalsBy(-1.5), snareBy(-2)])
                )
            ).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1.5 },
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
            ]);
        });

        it('a kept change the refinement removes is refused', () => {
            const result = refine(
                P1_CARD,
                'turn Vocals down 3 dB and turn Snare down 2 dB, but remove the snare gain',
                [vocalsBy(-3), snareBy(-2)]
            );

            expect(result).toMatchObject({ status: 'rejected', rejectionReason: expect.stringContaining('removes') });
        });

        it('reads the object name without both its generic noun and its operation word only when nothing longer names it', () => {
            const context = projectContext([...BASE_TRACKS, projectTrack('track-kick', 'Kick')]);
            const kickBy = (deltaDb: number): ProviderCall => ({
                name: 'setTrackGain',
                arguments: { trackId: 'track-kick', deltaDb },
            });
            const kickPan: ProviderCall = { name: 'setTrackPan', arguments: { trackId: 'track-kick', pan: -30 } };
            const card = {
                prompt: 'turn Vocals down 3 dB, turn Kick down 2 dB and pan Kick 30% left',
                calls: [vocalsBy(-3), kickBy(-2), kickPan],
            };

            expect(commandsOf(refine(card, 'drop the Kick Bus gain', [vocalsBy(-3), kickPan], context))).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                { type: 'setTrackPan', trackId: 'track-kick', pan: -30 },
            ]);
            expect(refine(card, 'drop the Kick Bus gain', [vocalsBy(-3)], context).status).toBe('rejected');
        });

        it('reads "Drum Bus" whole beside a track named "Drum", protecting the Drum Bus and never the Drum', () => {
            const context = projectContext([...BASE_TRACKS, projectTrack('track-drum', 'Drum')]);
            for (const refinement of [
                'turn Vocals down 3 dB, leave Drum Bus alone',
                'turn Vocals down 3 dB, not the Drum Bus',
            ]) {
                const result = refine(P0_CARD, refinement, [vocalsBy(-3)], context);
                const basis = result.status === 'grounded' ? result.groundingBasis : undefined;
                const protectedIds = (basis?.protectedUnchanged ?? []).map((object) => object.id);

                expect({ refinement, status: result.status, protectedIds }).toEqual({
                    refinement,
                    status: 'grounded',
                    protectedIds: expect.arrayContaining(['track-drum-bus']),
                });
                expect({ refinement, protectsDrum: protectedIds.includes('track-drum') }).toEqual({
                    refinement,
                    protectsDrum: false,
                });
            }
        });

        it('a value for one pending command in two clauses asks that it be stated once', () => {
            const result = refine(P0_CARD, 'make the vocals 2 dB, make it 1 dB', [vocalsBy(-2)]);

            expect(result.status === 'clarify' ? result.planningOutcome.questions[0] : result.status).toContain(
                'states the value of one pending change in more than one clause'
            );
        });
    });

    describe('pairing a refined batch with the stored card it refines', () => {
        const PAIRING_CONTEXT = projectContext([
            projectTrack('track-guitar', 'Guitar'),
            projectTrack('track-vocal', 'Vocal'),
            projectTrack('track-bass', 'Bass'),
            projectTrack('track-keys', 'Keys'),
        ]);
        type StoredCommand = { type: string; payload: Record<string, unknown> };
        const compressorOn = (trackId: string, deviceId: string): StoredCommand => ({
            type: 'addDevice',
            payload: { trackId, deviceType: 'Compressor', deviceId },
        });
        const eqOn = (trackId: string, deviceId: string): StoredCommand => ({
            type: 'addDevice',
            payload: { trackId, deviceType: 'EQ', deviceId },
        });
        const guitarPan: StoredCommand = { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: 20 } };
        const vocalGain = (gain: number): StoredCommand => ({
            type: 'setTrackGain',
            payload: { trackId: 'track-vocal', gain },
        });

        function admit(
            pendingActions: readonly StoredCommand[],
            actions: readonly StoredCommand[],
            prompt: string,
            context: ProjectContext = PAIRING_CONTEXT
        ) {
            return validateRefinedProposalActions({
                pendingActions,
                actions,
                prompt,
                context,
                createdObject: proposalCommandShape.createdObject,
                readRemoval: readStoredCardRemoval,
            });
        }

        function admission(
            pendingActions: readonly StoredCommand[],
            actions: readonly StoredCommand[],
            prompt: string,
            context: ProjectContext = PAIRING_CONTEXT
        ): string {
            return admit(pendingActions, actions, prompt, context).status;
        }

        it('a negation removes nothing from a stored card, while a removal verb naming the object removes it', () => {
            const compressor = compressorOn('track-guitar', 'd1');
            const rows: Array<[readonly StoredCommand[], readonly StoredCommand[], string, string]> = [
                [
                    [compressor],
                    [eqOn('track-guitar', 'd2')],
                    'Add an EQ after it, but do not change the compressor.',
                    'refused',
                ],
                [
                    [compressor],
                    [eqOn('track-guitar', 'd2')],
                    'Add an EQ, do not change the compressor ratio.',
                    'refused',
                ],
                [[guitarPan], [], 'Do not change the guitar pan from the pending proposal.', 'refused'],
                [
                    [guitarPan, vocalGain(0.5)],
                    [vocalGain(0.6)],
                    'Set the vocal gain to 60%, but do not change the guitar pan.',
                    'refused',
                ],
                [[compressor], [eqOn('track-guitar', 'd2')], 'Add an EQ, not the compressor.', 'refused'],
                [[guitarPan], [], 'not the guitar pan', 'refused'],
                [[compressor], [eqOn('track-guitar', 'd2')], 'Add an EQ, remove the compressor.', 'valid'],
                [[guitarPan], [], 'drop the guitar pan', 'valid'],
                [[guitarPan, vocalGain(0.5)], [], 'Remove the guitar pan, not the vocal gain', 'refused'],
                [
                    [guitarPan, vocalGain(0.5)],
                    [vocalGain(0.6)],
                    'Set the vocal gain to 60%, keep the guitar pan as is',
                    'refused',
                ],
            ];
            for (const [pending, next, prompt, status] of rows) {
                expect({ prompt, status: admission(pending, next, prompt) }).toEqual({ prompt, status });
            }
        });

        it('a removal verb removes only when it opens its clause, after nothing but please, and or then', () => {
            const compressor = compressorOn('track-guitar', 'device-command-1');
            const rows: Array<[readonly StoredCommand[], string, string]> = [
                [[guitarPan], 'Please don’t remove the guitar pan', 'refused'],
                [[guitarPan], "You shouldn't remove the guitar pan", 'refused'],
                [[guitarPan], 'No need to remove the guitar pan', 'refused'],
                [[guitarPan], 'Do not remove the guitar pan', 'refused'],
                [[compressor], 'Please don’t remove the compressor', 'refused'],
                [[compressor], "You shouldn't remove the compressor", 'refused'],
                [[compressor], 'No need to remove the compressor', 'refused'],
                [[guitarPan], 'Remove the guitar pan', 'valid'],
                [[guitarPan], 'Please remove the guitar pan', 'valid'],
                [[guitarPan], 'And then please remove the guitar pan', 'valid'],
                [[compressor], 'Please remove the compressor', 'valid'],
            ];
            for (const [pending, prompt, status] of rows) {
                expect({ prompt, status: admission(pending, [], prompt) }).toEqual({ prompt, status });
            }
        });

        it('a solo is removed by its own operation word', () => {
            const keysSolo: StoredCommand = { type: 'soloTrack', payload: { trackId: 'track-keys', soloed: true } };

            expect(admission([keysSolo, vocalGain(0.5)], [vocalGain(0.5)], 'remove the keys solo')).toBe('valid');
            expect(admission([keysSolo, vocalGain(0.5)], [vocalGain(0.5)], 'remove the keys track')).toBe('refused');
        });

        it('a creation the request removes is refused when the batch creates it again under a fresh id', () => {
            const pending = [compressorOn('track-bass', 'device-command-1')];
            const recreated = [compressorOn('track-bass', 'device-command-2')];

            expect(admission(pending, recreated, 'remove the compressor')).toBe('refused');
            expect(admission(pending, recreated, 'add a Compressor to Bass')).toBe('valid');
        });

        it('a kept pending command the request removes is refused whether it is re-emitted identically or changed', () => {
            const rows: Array<[readonly StoredCommand[], readonly StoredCommand[], string, string]> = [
                [[guitarPan], [guitarPan], 'drop the guitar pan', 'refused'],
                [[guitarPan], [guitarPan], 'Remove the guitar pan', 'refused'],
                [
                    [guitarPan],
                    [{ type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: 30 } }],
                    'drop the guitar pan',
                    'refused',
                ],
                [[guitarPan, vocalGain(0.5)], [guitarPan, vocalGain(0.6)], 'Set the vocal gain to 60%', 'valid'],
                [[guitarPan], [guitarPan], 'Set the vocal gain to 60%', 'valid'],
            ];
            for (const [pending, next, prompt, status] of rows) {
                expect({ prompt, status: admission(pending, next, prompt) }).toEqual({ prompt, status });
            }
        });

        it('a removal of a created object picks out exactly one pending creation, by name and host or a unique name', () => {
            const guitarCompressor = compressorOn('track-guitar', 'device-command-1');
            const bassCompressor = compressorOn('track-bass', 'device-command-2');
            const guitarEq = eqOn('track-guitar', 'device-command-3');
            const twoCompressors = [guitarCompressor, bassCompressor, vocalGain(0.5)];
            const rows: Array<[readonly StoredCommand[], readonly StoredCommand[], string, string]> = [
                [[guitarCompressor, guitarEq], [], 'Remove the compressor, not the EQ', 'refused'],
                [
                    [guitarCompressor, guitarEq],
                    [compressorOn('track-guitar', 'device-command-4')],
                    'Remove the compressor, not the EQ',
                    'refused',
                ],
                [twoCompressors, [vocalGain(0.5)], 'Make vocal gain 2, not the compressor on Bass', 'refused'],
                [twoCompressors, [guitarCompressor, vocalGain(0.5)], 'Remove the compressor from Bass', 'valid'],
                [twoCompressors, [guitarCompressor, vocalGain(0.5)], 'Remove the compressor', 'refused'],
                [twoCompressors, [bassCompressor, vocalGain(0.5)], 'Remove the compressor', 'refused'],
                [twoCompressors, [guitarCompressor, vocalGain(0.5)], 'Remove the compressor from Keys', 'refused'],
                [[guitarCompressor, vocalGain(0.5)], [vocalGain(0.5)], 'Remove the compressor', 'valid'],
                [[guitarCompressor, vocalGain(0.5)], [vocalGain(0.5)], 'Remove the compressor from Keys', 'refused'],
            ];
            for (const [pending, next, prompt, status] of rows) {
                expect({ prompt, status: admission(pending, next, prompt) }).toEqual({ prompt, status });
            }
        });

        it('a removal drops a command acting on two objects only when it names both', () => {
            const reverbMix40: StoredCommand = {
                type: 'setDeviceParameter',
                payload: { deviceId: 'device-reverb', paramId: 'mix', value: 40 },
            };

            expect(admission([reverbMix40], [], 'drop the mix parameter')).toBe('refused');
        });

        it('a creation that names nothing pairs only with the same creation under a fresh id', () => {
            const split = (beat: number, rightClipId: string): StoredCommand => ({
                type: 'splitClip',
                payload: { clipId: 'clip-1', beat, rightClipId },
            });
            expect(
                proposalCommandShape.createdObject('splitClip', split(12, 'clip-command-a').payload, PAIRING_CONTEXT)
            ).toEqual({ idFields: ['rightClipId'], names: [] });

            expect(
                admission([split(12, 'clip-command-a')], [split(28, 'clip-command-b')], 'Also split clip-1 at bar 8')
            ).toBe('refused');
            expect(
                admission([split(12, 'clip-command-a')], [split(12, 'clip-command-b')], 'Split clip-1 at bar 4')
            ).toBe('valid');
        });

        it('a named creation pairs by the name it gives what it creates', () => {
            const bus = (name: string, busId: string): StoredCommand => ({
                type: 'createBus',
                payload: { name, busId },
            });

            expect(
                admission([bus('Reverb', 'bus-command-a')], [bus('Delay', 'bus-command-b')], 'Make it a delay.')
            ).toBe('refused');
            expect(admission([bus('Reverb', 'bus-command-a')], [bus('Reverb', 'bus-command-b')], 'Keep it.')).toBe(
                'valid'
            );
        });

        it('two creations of one type on different hosts each pair with their own host', () => {
            const pending = [
                compressorOn('track-guitar', 'device-command-1'),
                compressorOn('track-bass', 'device-command-2'),
            ];

            expect(
                admission(
                    pending,
                    [compressorOn('track-bass', 'device-command-3'), compressorOn('track-guitar', 'device-command-4')],
                    'Add the compressors again'
                )
            ).toBe('valid');
            expect(
                admission(
                    pending,
                    [compressorOn('track-guitar', 'device-command-3'), compressorOn('track-keys', 'device-command-4')],
                    'Put the second compressor on Keys'
                )
            ).toBe('refused');
        });

        it('a removal verb follows only the shared openers, and before a figure it changes a level instead', () => {
            const gain = (trackId: string, deltaDb: number): StoredCommand => ({
                type: 'setTrackGain',
                payload: { trackId, deltaDb },
            });
            const pending = [gain('track-vocals', -3), gain('track-snare', -2)];
            const rows: Array<[readonly StoredCommand[], string, string]> = [
                [[gain('track-vocals', -3)], 'Can you remove the snare gain', 'valid'],
                [[gain('track-vocals', -3)], 'Actually remove the snare gain', 'valid'],
                [[gain('track-vocals', -3)], 'Also drop the snare gain', 'valid'],
                [[gain('track-vocals', -3)], 'I want you to drop the snare gain', 'valid'],
                [[gain('track-vocals', -3)], "I'd like you to omit the snare gain", 'valid'],
                [[gain('track-vocals', -3)], 'Could you please remove the snare gain', 'valid'],
                [[gain('track-vocals', -1), gain('track-snare', -2)], 'Drop the Vocals gain to -1 dB', 'valid'],
                [[gain('track-vocals', -1), gain('track-snare', -2)], 'Drop the Vocals level by 1 dB', 'valid'],
                [[gain('track-vocals', -3)], "Don't remove the snare gain", 'refused'],
                [[gain('track-vocals', -3)], "You shouldn't remove the snare gain", 'refused'],
                [[gain('track-vocals', -3)], 'No need to remove the snare gain', 'refused'],
            ];
            for (const [next, prompt, status] of rows) {
                expect({ prompt, status: admission(pending, next, prompt, CONTEXT) }).toEqual({ prompt, status });
            }
        });

        it('every closed opener opens a removal, and a negating word before the verb still keeps the change', () => {
            const context = projectContext([...BASE_TRACKS, projectTrack('track-drums', 'Drums')]);
            const vocalsGain: StoredCommand = { type: 'setTrackGain', payload: { trackId: 'track-vocals', gain: 0.7 } };
            const drumsMute: StoredCommand = { type: 'muteTrack', payload: { trackId: 'track-drums', muted: true } };
            const pending: StoredCommand[] = [
                { type: 'setTrackPan', payload: { trackId: 'track-bass', pan: -20 } },
                vocalsGain,
                drumsMute,
            ];
            const rows: Array<[string, string]> = [
                ['Just remove the Bass pan', 'valid'],
                ['Now remove the Bass pan', 'valid'],
                ['OK remove the Bass pan', 'valid'],
                ['Okay remove the Bass pan', 'valid'],
                ["Let's drop the Bass pan", 'valid'],
                ['Let us drop the Bass pan', 'valid'],
                ['I want to remove the Bass pan', 'valid'],
                ["I'd like to remove the Bass pan", 'valid'],
                ['We should remove the Bass pan', 'valid'],
                ['You can remove the Bass pan', 'valid'],
                ['Go ahead and remove the Bass pan', 'valid'],
                ["Don't remove the Bass pan", 'refused'],
                ["You can't remove the Bass pan", 'refused'],
            ];
            for (const [prompt, status] of rows) {
                expect({ prompt, status: admission(pending, [vocalsGain, drumsMute], prompt, context) }).toEqual({
                    prompt,
                    status,
                });
            }
        });

        it('a removal continues only into a bare object name, and removes only when nothing follows its object', () => {
            const gain = (trackId: string, deltaDb: number): StoredCommand => ({
                type: 'setTrackGain',
                payload: { trackId, deltaDb },
            });
            const vocalsCompressor = compressorOn('track-vocals', 'device-command-1');
            const recreated = compressorOn('track-vocals', 'device-command-2');
            const threeCommands = [vocalsCompressor, gain('track-vocals', -3), gain('track-snare', -2)];
            for (const tail of [
                ', the Vocals gain stays',
                ', Vocals gain is fine',
                ', vocals gain unchanged',
                '; vocals gain as proposed',
                ' and vocals gain stays',
                ', vocals fader up',
            ]) {
                const prompt = `add a Compressor to Vocals, remove the Snare gain${tail}`;

                expect({ prompt, status: admission(threeCommands, [recreated], prompt, CONTEXT) }).toEqual({
                    prompt,
                    status: 'refused',
                });
            }
            expect(
                admission(
                    threeCommands,
                    [recreated],
                    'add a Compressor to Vocals, remove the Snare gain and the Vocals gain',
                    CONTEXT
                )
            ).toBe('valid');
            const twoCommands = [vocalsCompressor, gain('track-snare', -2)];
            for (const prompt of [
                'drop the snare gain a bit',
                'drop the snare level a little',
                'drop the snare fader a touch',
            ]) {
                expect({ prompt, status: admission(twoCommands, [recreated], prompt, CONTEXT) }).toEqual({
                    prompt,
                    status: 'refused',
                });
            }
            expect(admission(twoCommands, [recreated], 'take out the snare level', CONTEXT)).toBe('valid');
            const eqAndCompressor = [
                eqOn('track-bass', 'device-command-1'),
                compressorOn('track-keys', 'device-command-2'),
            ];
            const prompt = 'remove the eq on bass, the compressor on keys stays';

            expect(admission(eqAndCompressor, [compressorOn('track-keys', 'device-command-3')], prompt)).toBe('valid');
            expect(admission(eqAndCompressor, [], prompt)).toBe('refused');
            // A host phrase is more than a bare object name, so the clause continues no removal.
            expect(admission(eqAndCompressor, [], 'remove the eq on bass, the compressor on keys')).toBe('refused');
        });

        it('a project object named by a binding word is never read as an object', () => {
            const context = projectContext([...BASE_TRACKS, projectTrack('track-gain', 'Gain')]);
            const vocalsCut: StoredCommand = {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocals', deltaDb: -3 },
            };
            const snareCut: StoredCommand = { type: 'setTrackGain', payload: { trackId: 'track-snare', deltaDb: -2 } };

            expect(admission([vocalsCut, snareCut], [vocalsCut], 'remove the snare gain', context)).toBe('valid');
        });

        it('reads each clause the shared splitter cuts, so a removal after and, then, but or a newline still removes', () => {
            const rows: Array<[readonly StoredCommand[], string]> = [
                [[vocalGain(0.5)], 'Remove the guitar pan and remove the vocal gain'],
                [[vocalGain(0.5)], 'Remove the guitar pan then remove the vocal gain'],
                [[vocalGain(0.5)], 'Remove the guitar pan\nremove the vocal gain'],
                [[vocalGain(0.5)], 'Remove the guitar pan but also remove the vocal gain'],
                [[vocalGain(0.5)], 'Remove the guitar pan and the vocal gain'],
                [[guitarPan, vocalGain(0.5)], 'Keep the guitar pan and remove the vocal gain'],
            ];
            for (const [next, prompt] of rows) {
                expect({ prompt, status: admission([guitarPan, vocalGain(0.5)], next, prompt) }).toEqual({
                    prompt,
                    status: 'refused',
                });
            }
            expect(admission([guitarPan, vocalGain(0.5)], [], 'Remove the guitar pan and the vocal gain')).toBe(
                'valid'
            );
        });

        it('reads a removed creation in its own clause beside a change or an addition', () => {
            const bassCompressor = compressorOn('track-bass', 'device-command-1');
            const guitarPan30: StoredCommand = { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: 30 } };

            expect(
                admission(
                    [guitarPan, bassCompressor],
                    [guitarPan30, compressorOn('track-bass', 'device-command-2')],
                    'Set the guitar pan to 30 and remove the compressor'
                )
            ).toBe('refused');
            expect(
                admission(
                    [guitarPan, bassCompressor],
                    [guitarPan30],
                    'Set the guitar pan to 30 and remove the compressor'
                )
            ).toBe('valid');
            expect(
                admission(
                    [compressorOn('track-vocal', 'device-command-1')],
                    [eqOn('track-vocal', 'device-command-2')],
                    'add an EQ to Vocal and remove the compressor'
                )
            ).toBe('valid');
        });

        it('reads a creation name by the longest project name first, so an existing device name removes nothing', () => {
            const withKeysDevice = (device: ProjectTrack['devices'][number]) =>
                projectContext([
                    ...PAIRING_CONTEXT.tracks.filter((track) => track.id !== 'track-keys'),
                    projectTrack('track-keys', 'Keys', { deviceCount: 1, devices: [device] }),
                ]);
            const delayOnBass: StoredCommand = {
                type: 'addDevice',
                payload: { trackId: 'track-bass', deviceType: 'Delay', deviceId: 'device-command-1' },
            };
            const delayContext = withKeysDevice({
                id: 'device-delay-2',
                type: 'Delay',
                name: 'Delay 2',
                bypassed: false,
                parameters: [],
            });
            const compressorContext = withKeysDevice({
                id: 'device-compressor-old',
                type: 'Compressor',
                name: 'Compressor Old',
                bypassed: false,
                parameters: [],
            });

            expect(admission([delayOnBass], [], 'remove the Delay 2 from Keys', delayContext)).toBe('refused');
            expect(
                admission(
                    [compressorOn('track-bass', 'device-command-1')],
                    [],
                    'remove the Compressor Old from Keys',
                    compressorContext
                )
            ).toBe('refused');
            expect(admission([compressorOn('track-bass', 'device-command-1')], [], 'remove the compressor')).toBe(
                'valid'
            );
        });

        it('a removal naming a creation several pending creations share, without a host, asks which one', () => {
            const pending = [
                compressorOn('track-guitar', 'device-command-1'),
                compressorOn('track-bass', 'device-command-2'),
                vocalGain(0.5),
            ];

            expect(admit(pending, [vocalGain(0.5)], 'Remove the compressor')).toEqual({
                status: 'refused',
                reason: expect.stringMatching(/which one/i),
            });
            expect(
                admit(
                    pending,
                    [compressorOn('track-guitar', 'device-command-1'), vocalGain(0.5)],
                    'Remove the compressor from Bass'
                )
            ).toEqual({
                status: 'valid',
            });
        });

        it('a removal closes on the reference trailers the refinement reader reads, and on nothing else', () => {
            const context = projectContext([
                ...PAIRING_CONTEXT.tracks,
                projectTrack('track-snare', 'Snare'),
                projectTrack('track-guitar-left', 'Guitar Left'),
            ]);
            const bassMute: StoredCommand = { type: 'muteTrack', payload: { trackId: 'track-bass', muted: true } };
            const snarePan: StoredCommand = { type: 'setTrackPan', payload: { trackId: 'track-snare', pan: 20 } };
            const snareGain: StoredCommand = { type: 'setTrackGain', payload: { trackId: 'track-snare', gain: 0.5 } };
            const guitarLeftPan: StoredCommand = {
                type: 'setTrackPan',
                payload: { trackId: 'track-guitar-left', pan: -20 },
            };
            const rows: Array<[readonly StoredCommand[], readonly StoredCommand[], string, string]> = [
                [[guitarLeftPan, snareGain], [snareGain], 'Drop Guitar Left pan entirely.', 'valid'],
                [[guitarLeftPan, snareGain], [snareGain], 'Drop Guitar Left pan altogether.', 'valid'],
                [[guitarLeftPan, snareGain], [snareGain], 'Drop Guitar Left pan completely.', 'valid'],
                [[guitarLeftPan, snareGain], [snareGain], 'Drop Guitar Left pan from the mix.', 'valid'],
                [[guitarLeftPan, snareGain], [snareGain], 'Drop Guitar Left pan for now.', 'valid'],
                [[guitarLeftPan, snareGain], [snareGain], 'Instead drop Guitar Left pan.', 'valid'],
                [[guitarLeftPan, snareGain], [snareGain], 'We can drop Guitar Left pan.', 'valid'],
                [[guitarLeftPan, snareGain], [snareGain], 'Yes, drop Guitar Left pan.', 'valid'],
                [[guitarLeftPan, snareGain], [snareGain], 'Yes drop Guitar Left pan.', 'valid'],
                [[snareGain], [], 'Remove the snare gain thanks.', 'valid'],
                [[snareGain], [], 'Remove the snare gain thank you.', 'valid'],
                [[vocalGain(0.5)], [], 'remove the Vocal gain too', 'valid'],
                [[vocalGain(0.5)], [], 'remove the Vocal gain please', 'valid'],
                [[vocalGain(0.5)], [], 'remove the Vocal gain as well', 'valid'],
                [[vocalGain(0.5)], [], 'remove the Vocal gain from the proposal', 'valid'],
                [[vocalGain(0.5)], [], 'remove the Vocal gain from the pending proposal', 'valid'],
                [[vocalGain(0.5)], [], 'remove the Vocal gain from the card', 'valid'],
                [[vocalGain(0.5)], [], 'remove the Vocal gain from it', 'valid'],
                [[vocalGain(0.5)], [], 'Just remove the Vocal gain from the card please', 'valid'],
                [[bassMute], [], 'remove the Bass mute too', 'valid'],
                [
                    [snarePan],
                    [compressorOn('track-bass', 'device-command-1')],
                    'Add a Compressor on Bass and remove the Snare pan too',
                    'valid',
                ],
                [[vocalGain(0.5)], [], 'remove the Vocal gain a bit', 'refused'],
                [[vocalGain(0.5)], [], 'remove the Vocal gain a bit too', 'refused'],
            ];
            expect(
                rows.map(([pending, next, prompt]) => ({ prompt, status: admission(pending, next, prompt, context) }))
            ).toEqual(rows.map(([, , prompt, status]) => ({ prompt, status })));
        });

        it('a removal continues into a bare object name with at most one operation word', () => {
            expect(admission([guitarPan, vocalGain(0.5)], [], 'Remove the guitar pan and the vocal gain level')).toBe(
                'refused'
            );
        });
    });

    describe('one final check on every route a refinement grounds by', () => {
        const TWO_CUTS_CARD = { prompt: 'turn Vocals down 3 dB and turn Snare down 2 dB', calls: P1_PLAN };
        const trackBy = (trackId: string, deltaDb: number): ProviderCall => ({
            name: 'setTrackGain',
            arguments: { trackId, deltaDb },
        });
        const mute = (trackId: string): ProviderCall => ({ name: 'muteTrack', arguments: { trackId, muted: true } });

        it('a batch the refinement text grounds alone beside a comparative still may not drop a pending change', () => {
            const rows: Array<[string, ProviderCall[]]> = [
                ['make Keys 2 dB quieter', [trackBy('track-keys', -2)]],
                ['make Keys 2 dB lower', [trackBy('track-keys', -2)]],
                ['turn Bass down 1 dB less and remove the snare', [trackBy('track-bass', -1)]],
            ];
            for (const [refinement, calls] of rows) {
                expect({ refinement, result: refine(TWO_CUTS_CARD, refinement, calls) }).toMatchObject({
                    refinement,
                    result: { status: 'rejected', rejectionReason: expect.stringContaining('omits a pending') },
                });
            }
            const more = refine(TWO_CUTS_CARD, 'turn Bass down 2 dB more', [trackBy('track-bass', -2)]);

            expect(['rejected', 'clarify']).toContain(more.status);
            expect(
                commandsOf(refine(TWO_CUTS_CARD, 'make Keys 2 dB quieter', [...P1_PLAN, trackBy('track-keys', -2)]))
            ).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
                { type: 'setTrackGain', trackId: 'track-keys', deltaDb: -2 },
            ]);
        });

        it('a clause no new call answers is refused when the batch only carries the pending changes', () => {
            const card = { prompt: 'mute Bass and mute Keys', calls: [mute('track-bass'), mute('track-keys')] };

            expect(
                refine(card, 'mute Bass and mute Keys, and solo Keys', [mute('track-bass'), mute('track-keys')])
            ).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('No proposed change answers "solo Keys"'),
            });
        });

        it('a negation beside a removal asks, while a negation on its own still removes and protects', () => {
            const context = projectContext([
                projectTrack('track-snare-bottom', 'Snare Bottom'),
                projectTrack('track-snare', 'Snare'),
                projectTrack('track-drum-bus', 'Drum Bus'),
                projectTrack('track-drum', 'Drum'),
            ]);
            const plan = [
                trackBy('track-snare-bottom', -1),
                trackBy('track-snare', -2),
                trackBy('track-drum-bus', -3),
                trackBy('track-drum', -4),
            ];
            const card = {
                prompt: 'turn Snare Bottom down 1 dB, turn Snare down 2 dB, turn Drum Bus down 3 dB and turn Drum down 4 dB',
                calls: plan,
            };
            const [snareBottom, snare, drumBus, drum] = plan as [
                ProviderCall,
                ProviderCall,
                ProviderCall,
                ProviderCall,
            ];
            for (const refinement of [
                'remove the snare but not the drum bus',
                'remove snare, not drum bus',
                'remove the snare and not the drum bus',
                'skip the snare, not the drum bus',
                'remove the snare. Not the drum bus',
                'remove the snare except the drum bus',
                'not the drum bus, remove the snare',
            ]) {
                for (const calls of [
                    [snareBottom, drumBus, drum],
                    [snareBottom, drum],
                ]) {
                    expect({ refinement, calls, status: refine(card, refinement, calls, context).status }).toEqual({
                        refinement,
                        calls,
                        status: 'clarify',
                    });
                }
            }
            expect(
                refine(card, 'remove the drum except the drum bus', [snareBottom, snare, drumBus], context).status
            ).toBe('clarify');
            expect(refine(card, 'remove snare except snare bottom', [snareBottom, drumBus, drum], context).status).toBe(
                'clarify'
            );
            const alone = refine(card, 'not the drum bus', [snareBottom, snare, drum], context);

            expect(commandsOf(alone)).toEqual([
                { type: 'setTrackGain', trackId: 'track-snare-bottom', deltaDb: -1 },
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
                { type: 'setTrackGain', trackId: 'track-drum', deltaDb: -4 },
            ]);
            expect(alone.status === 'grounded' ? alone.groundingBasis?.protectedUnchanged : null).toEqual(
                expect.arrayContaining([{ id: 'track-drum-bus', name: 'Drum Bus' }])
            );
        });

        it('a pan figure followed by "to the" side asks whether it lands there or moves toward it', () => {
            const bassPan = (pan: number): ProviderCall => ({
                name: 'setTrackPan',
                arguments: { trackId: 'track-bass', pan },
            });
            const card = { prompt: 'pan Bass 30% left', calls: [bassPan(-30)] };
            for (const refinement of ['bring it 10 to the right', 'move it 10 to the right']) {
                for (const calls of [[bassPan(10)], [bassPan(-20)], [bassPan(-40)]]) {
                    expect({ refinement, calls, status: refine(card, refinement, calls).status }).toEqual({
                        refinement,
                        calls,
                        status: 'clarify',
                    });
                }
            }
        });

        it('a moving verb beside a pan figure and a side asks, with or without "to", while a landing verb binds', () => {
            const bassPan = (pan: number): ProviderCall => ({
                name: 'setTrackPan',
                arguments: { trackId: 'track-bass', pan },
            });
            const card = { prompt: 'pan Bass left 30%', calls: [bassPan(-30)] };
            for (const refinement of [
                'bring it 10 right',
                'turn it 10 right',
                'move it 10 right',
                'bring it 10% right',
                'bring it right 10',
                'shift it 10 right',
                'nudge it 10 right',
                'push it 10 right',
            ]) {
                for (const calls of [[bassPan(10)], [bassPan(-20)], [bassPan(-40)]]) {
                    expect({ refinement, calls, status: refine(card, refinement, calls).status }).toEqual({
                        refinement,
                        calls,
                        status: 'clarify',
                    });
                }
            }
            for (const refinement of [
                'make it 10 right',
                'set it 10 right',
                'put it 10 right',
                'change it 10 right',
                'make it 10 to the right',
            ]) {
                expect({ refinement, commands: commandsOf(refine(card, refinement, [bassPan(10)])) }).toEqual({
                    refinement,
                    commands: [{ type: 'setTrackPan', trackId: 'track-bass', pan: 10 }],
                });
            }
        });

        it('a comparative against a pending pan asks which way it moves, on either side and either route', () => {
            const bassPan = (pan: number): ProviderCall => ({
                name: 'setTrackPan',
                arguments: { trackId: 'track-bass', pan },
            });
            for (const side of ['left', 'right'] as const) {
                const sign = side === 'left' ? -1 : 1;
                const card = { prompt: `pan Bass 30% ${side}`, calls: [bassPan(sign * 30)] };
                const rows: Array<[string, number]> = [
                    [`less, pan it 40 ${side}`, 40],
                    [`more, pan it 20 ${side}`, 20],
                    [`less, pan it 20 ${side}`, 20],
                    [`more, pan it 40 ${side}`, 40],
                    [`less, pan Bass 20% ${side}`, 20],
                ];
                for (const [refinement, magnitude] of rows) {
                    expect({
                        refinement,
                        status: refine(card, refinement, [bassPan(sign * magnitude)]).status,
                    }).toEqual({
                        refinement,
                        status: 'clarify',
                    });
                }
            }
        });

        it('a batch acting on one pending target more than once is refused, on every route', () => {
            const rows: Array<[{ prompt: string; calls: readonly ProviderCall[] }, string, ProviderCall[]]> = [
                [P0_CARD, 'turn Vocals down 1 dB', [vocalsBy(-1), vocalsBy(-1)]],
                [P0_CARD, 'turn Vocals down 3 dB', [vocalsBy(-3), vocalsBy(-3)]],
                [P0_CARD, 'make it 1 dB', [vocalsBy(-1), vocalsBy(-1)]],
                [TWO_CUTS_CARD, 'turn Vocals down 1 dB', [vocalsBy(-1), vocalsBy(-1), snareBy(-2)]],
                [TWO_CUTS_CARD, 'turn Snare down 2 dB', [vocalsBy(-3), snareBy(-2), snareBy(-2)]],
            ];
            for (const [card, refinement, calls] of rows) {
                expect({ refinement, calls, result: refine(card, refinement, calls) }).toMatchObject({
                    refinement,
                    calls,
                    result: { status: 'rejected', rejectionReason: expect.stringContaining('more than once') },
                });
            }
        });

        it('a pending command that targets nothing is continued at most once too', () => {
            const verse: ProviderCall = { name: 'addMarker', arguments: { name: 'Verse', beat: 0 } };
            const card = { prompt: 'add a marker at beat 0 named Verse', calls: [verse] };

            expect(refine(card, 'keep the marker as it is', [verse, verse])).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('more than once'),
            });
        });

        it('a pending command with no target pairs only with a call of the same payload, minted ids aside', () => {
            const marker = (name: string, beat: number): ProviderCall => ({
                name: 'addMarker',
                arguments: { name, beat },
            });
            const audioTrack = (name: string): ProviderCall => ({
                name: 'addTrack',
                arguments: { name, kind: 'audio' },
            });
            const twoMarkers = {
                prompt: 'add a marker at beat 0 named Verse and add a marker at beat 16 named Chorus',
                calls: [marker('Verse', 0), marker('Chorus', 16)],
            };
            const twoTracks = {
                prompt: 'add an audio track named Drums and add an audio track named Bass Guitar',
                calls: [audioTrack('Drums'), audioTrack('Bass Guitar')],
            };
            const rows: Array<[{ prompt: string; calls: readonly ProviderCall[] }, string, ProviderCall[]]> = [
                [twoMarkers, 'add a marker at beat 0 named Verse', [marker('Verse', 0)]],
                [twoMarkers, 'add a marker at beat 32 named Chorus', [marker('Chorus', 32)]],
                [twoTracks, 'add an audio track named Drums', [audioTrack('Drums')]],
            ];
            for (const [card, refinement, calls] of rows) {
                expect({ refinement, result: refine(card, refinement, calls) }).toMatchObject({
                    refinement,
                    result: { status: 'rejected', rejectionReason: expect.stringContaining('omits a pending') },
                });
            }
            const verseAndCut = {
                prompt: 'add a marker at beat 0 named Verse and turn Vocals down 3 dB',
                calls: [marker('Verse', 0), vocalsBy(-3)],
            };
            const addsChorus =
                'add a marker at beat 0 named Verse, add a marker at beat 16 named Chorus and turn Vocals down 3 dB';
            const grounded = refine(verseAndCut, addsChorus, [marker('Verse', 0), marker('Chorus', 16), vocalsBy(-3)]);

            expect(grounded.status === 'grounded' ? grounded.actions.map((action) => action.type) : grounded).toEqual([
                'addMarker',
                'addMarker',
                'setTrackGain',
            ]);
            expect(
                refine(verseAndCut, addsChorus, [marker('Verse', 0), marker('Verse', 0), vocalsBy(-3)])
            ).toMatchObject({ status: 'rejected', rejectionReason: expect.stringContaining('more than once') });
        });

        it('a pending command that targets and creates nothing pairs by the arguments its mutation identity names', () => {
            const markerCall = (name: string, beat: number, extra: Record<string, unknown> = {}): ProviderCall => ({
                name: Object.keys(extra).length === 0 ? 'removeMarker' : 'setMarkerColor',
                arguments: { beat, name, ...extra },
            });
            const removeSection = (name: string, startBeat: number, endBeat: number): ProviderCall => ({
                name: 'removeSection',
                arguments: { startBeat, endBeat, name },
            });
            const tempo = (bpm: number): ProviderCall => ({ name: 'setTempo', arguments: { bpm } });
            markerStore.set({
                markers: [
                    { id: 'marker-verse', name: 'Verse', beat: 0, color: 'amber' },
                    { id: 'marker-chorus', name: 'Chorus', beat: 16, color: 'amber' },
                ],
                sections: [
                    { id: 'section-intro', name: 'Intro', startBeat: 0, endBeat: 16, color: '#000000' },
                    { id: 'section-outro', name: 'Outro', startBeat: 16, endBeat: 32, color: '#000000' },
                ],
            });
            try {
                const rows: Array<[{ prompt: string; calls: readonly ProviderCall[] }, string, ProviderCall[]]> = [
                    [
                        {
                            prompt: 'remove marker named Verse at beat 0 and remove marker named Chorus at beat 16',
                            calls: [markerCall('Verse', 0), markerCall('Chorus', 16)],
                        },
                        'remove marker named Chorus at beat 16',
                        [markerCall('Chorus', 16)],
                    ],
                    [
                        {
                            prompt: 'set marker color for Verse at beat 0 to teal',
                            calls: [markerCall('Verse', 0, { color: 'teal' })],
                        },
                        'set marker color for Chorus at beat 16 to teal',
                        [markerCall('Chorus', 16, { color: 'teal' })],
                    ],
                    [
                        {
                            prompt: 'remove the section named Intro from beat 0 to beat 16',
                            calls: [removeSection('Intro', 0, 16)],
                        },
                        'remove the section named Outro from beat 16 to beat 32',
                        [removeSection('Outro', 16, 32)],
                    ],
                ];
                expect(
                    rows.map(([card, refinement, calls]) => ({ refinement, result: refine(card, refinement, calls) }))
                ).toMatchObject(
                    rows.map(([, refinement]) => ({
                        refinement,
                        result: { status: 'rejected', rejectionReason: expect.stringContaining('omits a pending') },
                    }))
                );
                expect(
                    commandsOf(
                        refine({ prompt: 'set tempo to 120', calls: [tempo(120)] }, 'make it 124 bpm', [tempo(124)])
                    )
                ).toEqual([{ type: 'setTempo' }]);
            } finally {
                markerStore.set({ markers: [], sections: [] });
            }
        });

        it('a figureless creation clause is answered by the creation its call continues, changed or not', () => {
            const marker = (name: string, beat: number): ProviderCall => ({
                name: 'addMarker',
                arguments: { name, beat },
            });
            const audioTrack = (name: string): ProviderCall => ({
                name: 'addTrack',
                arguments: { name, kind: 'audio' },
            });
            const congasAndCut = {
                prompt: 'add an audio track named Congas and turn Vocals down 3 dB',
                calls: [audioTrack('Congas'), vocalsBy(-3)],
            };
            const verseAndCut = {
                prompt: 'add a marker at beat 0 named Verse and turn Vocals down 3 dB',
                calls: [marker('Verse', 0), vocalsBy(-3)],
            };
            const drumsAndCut = {
                prompt: 'add an audio track named Drums and turn Vocals down 3 dB',
                calls: [audioTrack('Drums'), vocalsBy(-3)],
            };
            const rows: Array<[{ prompt: string; calls: readonly ProviderCall[] }, string, ProviderCall[], string]> = [
                [
                    congasAndCut,
                    'add an audio track named Congas and turn Vocals down 2 dB',
                    [audioTrack('Congas'), vocalsBy(-2)],
                    'Congas',
                ],
                [
                    verseAndCut,
                    'add a marker at beat 8 named Verse and turn Vocals down 3 dB',
                    [marker('Verse', 8), vocalsBy(-3)],
                    'Verse',
                ],
                [
                    verseAndCut,
                    'add a marker at beat 0 named Intro and turn Vocals down 3 dB',
                    [marker('Intro', 0), vocalsBy(-3)],
                    'Intro',
                ],
                [
                    drumsAndCut,
                    'add an audio track named Percussion and turn Vocals down 3 dB',
                    [audioTrack('Percussion'), vocalsBy(-3)],
                    'Percussion',
                ],
            ];
            const createdOf = (result: ReturnType<typeof refine>) => {
                if (result.status !== 'grounded') {
                    return result;
                }
                return { name: payloadOf(result.actions[0]!).name, types: result.actions.map((action) => action.type) };
            };
            expect(
                rows.map(([card, refinement, calls]) => ({
                    refinement,
                    created: createdOf(refine(card, refinement, calls)),
                }))
            ).toEqual(
                rows.map(([, refinement, calls, name]) => ({
                    refinement,
                    created: { name, types: [calls[0]!.name, 'setTrackGain'] },
                }))
            );
            expect(
                refine(congasAndCut, 'add an audio track named Bongos and turn Vocals down 3 dB', [
                    audioTrack('Congas'),
                    vocalsBy(-3),
                ])
            ).toMatchObject({ status: 'rejected', rejectionReason: expect.stringContaining('No proposed change') });
            expect(
                refine(
                    congasAndCut,
                    'add an audio track named Congas, add an audio track named Bongos and turn Vocals down 3 dB',
                    [audioTrack('Congas'), vocalsBy(-3)]
                )
            ).toMatchObject({ status: 'rejected', rejectionReason: expect.stringContaining('No proposed change') });
        });

        it('a batch continuing no pending command beside a figure comparative still reads every value clause', () => {
            const vocalsMute: ProviderCall = { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } };
            const muteCard = { prompt: 'mute Vocals', calls: [vocalsMute] };
            const keysCut = [trackBy('track-keys', -2)];

            expect(refine(P0_CARD, 'remove the vocals, make Keys 2 dB quieter, 1 dB', keysCut)).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('can only mean a pending change the refinement removes'),
            });
            expect(refine(muteCard, 'remove the vocals mute, make Keys 2 dB quieter, 3 dB', keysCut)).toMatchObject({
                status: 'rejected',
                rejectionReason: expect.stringContaining('has no value "3 dB" could change'),
            });
            expect(refine(P0_CARD, 'make Keys 2 dB quieter and remove the vocals, less', keysCut).status).toBe(
                'clarify'
            );
            expect(commandsOf(refine(P0_CARD, 'remove the vocals, make Keys 2 dB quieter', keysCut))).toEqual([
                { type: 'setTrackGain', trackId: 'track-keys', deltaDb: -2 },
            ]);
        });

        it('"leave ... alone" beside a removal asks like a negation there, while on its own it removes and protects', () => {
            const card = {
                prompt: 'turn Vocals down 3 dB, turn Snare down 2 dB and turn Bass up 1 dB',
                calls: [vocalsBy(-3), snareBy(-2), trackBy('track-bass', 1)],
            };
            for (const refinement of [
                'remove the snare but leave the bass alone',
                'remove the snare, leave the bass alone',
                'leave the bass alone, remove the snare',
            ]) {
                for (const calls of [[vocalsBy(-3), trackBy('track-bass', 1)], [vocalsBy(-3)]]) {
                    expect({ refinement, calls, status: refine(card, refinement, calls).status }).toEqual({
                        refinement,
                        calls,
                        status: 'clarify',
                    });
                }
            }
            const alone = refine(card, 'leave the bass alone', [vocalsBy(-3), snareBy(-2)]);

            expect(commandsOf(alone)).toEqual([
                { type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -3 },
                { type: 'setTrackGain', trackId: 'track-snare', deltaDb: -2 },
            ]);
            expect(alone.status === 'grounded' ? alone.groundingBasis?.protectedUnchanged : null).toEqual(
                expect.arrayContaining([{ id: 'track-bass', name: 'Bass' }])
            );
        });

        it('a negation naming nothing beside a changed value asks on the route that grounds the text alone too', () => {
            for (const refinement of ['turn Vocals down 4 dB, not as much', 'turn Vocals down 4 dB, never mind']) {
                expect({ refinement, status: refine(P0_CARD, refinement, [vocalsBy(-4)]).status }).toEqual({
                    refinement,
                    status: 'clarify',
                });
            }
        });

        it('a negation before a removal verb stating a figure is read on its own, the verb changing a level', () => {
            const result = refine(TWO_CUTS_CARD, 'not the snare, drop the Vocals by 1 dB', [vocalsBy(-1)]);

            expect(commandsOf(result)).toEqual([{ type: 'setTrackGain', trackId: 'track-vocals', deltaDb: -1 }]);
        });
    });

    describe('a full restatement of a four-command mix card', () => {
        const MIX_CONTEXT = projectContext([
            projectTrack('track-lead-vocal', 'Lead Vocal'),
            projectTrack('track-guitar-left', 'Guitar Left'),
            projectTrack('track-guitar-right', 'Guitar Right'),
            projectTrack('track-room-mic', 'Room Mic'),
            projectTrack('track-drum-bus', 'Drum Bus'),
            projectTrack('track-bass', 'Bass'),
        ]);
        const roomMicMute = (muted: boolean): ProviderCall => ({
            name: 'muteTrack',
            arguments: { trackId: 'track-room-mic', muted },
        });
        const mixPlan = (gain: number, muted: boolean): ProviderCall[] => [
            { name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain } },
            { name: 'setTrackPan', arguments: { trackId: 'track-guitar-left', pan: -20 } },
            { name: 'setTrackPan', arguments: { trackId: 'track-guitar-right', pan: 20 } },
            roomMicMute(muted),
        ];
        const MIX_CARD = {
            prompt: 'Set Lead Vocal gain to 70%, pan Guitar Left 20% left and Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.',
            calls: mixPlan(0.7, true),
        };
        const RESTATED =
            'Set Lead Vocal gain to 80%, pan Guitar Left 20% left and Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.';

        it('binds the toggle a restated clause states', () => {
            const unmuted = RESTATED.replace('mute Room Mic', 'unmute Room Mic');
            const result = refine(MIX_CARD, unmuted, mixPlan(0.8, false), MIX_CONTEXT);

            expect(
                result.status === 'grounded' ? result.actions.map((action) => payloadOf(action).muted ?? null) : result
            ).toEqual([null, null, null, false]);
            expect(refine(MIX_CARD, unmuted, mixPlan(0.8, true), MIX_CONTEXT).status).not.toBe('grounded');
        });

        it('removes the Guitar Left pan through every opener and trailer a removal reads', () => {
            const [leadVocal, , guitarRight, roomMic] = mixPlan(0.7, true);
            const trackIdsOf = (result: ReturnType<typeof refine>) => {
                if (result.status !== 'grounded') {
                    return result;
                }
                return result.actions.map((action) => payloadOf(action).trackId);
            };
            const rows = [
                'Drop Guitar Left pan entirely.',
                'Drop Guitar Left pan altogether.',
                'Drop Guitar Left pan completely.',
                'Drop Guitar Left pan from the mix.',
                'Drop Guitar Left pan for now.',
                'Drop Guitar Left pan thanks.',
                'Instead drop Guitar Left pan.',
                'We can drop Guitar Left pan.',
                'Yes drop Guitar Left pan.',
            ];
            expect(
                rows.map((refinement) => ({
                    refinement,
                    tracks: trackIdsOf(refine(MIX_CARD, refinement, [leadVocal!, guitarRight!, roomMic!], MIX_CONTEXT)),
                }))
            ).toEqual(
                rows.map((refinement) => ({
                    refinement,
                    tracks: ['track-lead-vocal', 'track-guitar-right', 'track-room-mic'],
                }))
            );
        });

        it('consumes only the closed filler clauses beside a full restatement', () => {
            const rows = [
                `Actually, ${RESTATED}`,
                `Hmm, ${RESTATED}`,
                `Well, ${RESTATED}`,
                `Sure, ${RESTATED}`,
                `Yes, ${RESTATED}`,
                `${RESTATED} Cheers.`,
                `${RESTATED} Thanks a lot.`,
                `${RESTATED} Looks good.`,
                `Yeah, ${RESTATED}`,
                `Hey, ${RESTATED}`,
                `${RESTATED} Sounds good.`,
                `${RESTATED} Great.`,
                `${RESTATED} Perfect.`,
                `${RESTATED} Nice.`,
            ];
            expect(
                rows.map((refinement) => ({
                    refinement,
                    status: refine(MIX_CARD, refinement, mixPlan(0.8, true), MIX_CONTEXT).status,
                }))
            ).toEqual(rows.map((refinement) => ({ refinement, status: 'grounded' })));
            for (const refinement of [`${RESTATED} I need it quieter.`, `${RESTATED} Don't apply yet.`]) {
                expect({
                    refinement,
                    status: refine(MIX_CARD, refinement, mixPlan(0.8, true), MIX_CONTEXT).status,
                }).toEqual({ refinement, status: 'clarify' });
            }
        });

        it('refuses a clause outside the filler list that names nothing and states no figure', () => {
            const tempo = (bpm: number): ProviderCall => ({ name: 'setTempo', arguments: { bpm } });
            const bassPan = (pan: number): ProviderCall => ({
                name: 'setTrackPan',
                arguments: { trackId: 'track-bass', pan },
            });
            const bassMute = (muted: boolean): ProviderCall => ({
                name: 'muteTrack',
                arguments: { trackId: 'track-bass', muted },
            });
            const tempoCard = { prompt: 'set tempo to 120', calls: [tempo(120)] };
            const panCard = { prompt: 'pan Bass 30% left', calls: [bassPan(-30)] };
            const muteCard = { prompt: 'mute Bass', calls: [bassMute(true)] };
            const rows: Array<[{ prompt: string; calls: readonly ProviderCall[] }, string, ProviderCall[]]> = [
                [tempoCard, 'slower, 140 bpm', [tempo(140)]],
                [tempoCard, 'faster, 100 bpm', [tempo(100)]],
                [panCard, 'wider, pan it 20 left', [bassPan(-20)]],
                [panCard, 'narrower, pan it 40 left', [bassPan(-40)]],
                [P0_CARD, 'gentler, make it 5 dB', [vocalsBy(-5)]],
                [P0_CARD, 'stronger, make it 1 dB', [vocalsBy(-1)]],
                [P0_CARD, 'double it', [vocalsBy(-6)]],
                [P0_CARD, 'undo that', [vocalsBy(-3)]],
                [muteCard, 'unmuted', [bassMute(false)]],
                [muteCard, 'audible', [bassMute(false)]],
                [muteCard, 'toggle it', [bassMute(false)]],
            ];
            expect(
                rows.map(([card, refinement, calls]) => ({
                    refinement,
                    status: refine(card, refinement, calls).status,
                }))
            ).toEqual(rows.map(([, refinement]) => ({ refinement, status: 'rejected' })));
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
    /** The capabilities the plan names, when they are not every call's action. */
    capabilityIds?: readonly string[];
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
                capabilityIds: Array.from(script.capabilityIds ?? new Set(calls.map((call) => call.name))),
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

    it('row 7: a removal still protects the Snare when the replacement creates a device and carries no basis', async () => {
        let pendingId = '';
        // A bound creation gives the replacement no basis, so only the refinement's own reading carries the removal.
        const vocalCompressor = {
            name: 'addDevice',
            arguments: { trackId: 'track-vocals', deviceType: 'Compressor', binding: 'vocal-compressor' },
        };
        scriptProvider([
            { calls: P1_PLAN, protectedTargetIds: ['track-drum-bus'] },
            { calls: [vocalsBy(-3), vocalCompressor], refines: () => pendingId },
        ]);
        await sendChatMessage(P1);
        pendingId = onlyProposedId();

        await sendChatMessage('turn Vocals down 3 dB and add a Compressor to Vocals, not the snare');

        const replacementId = onlyProposedId();
        expect(replacementId).not.toBe(pendingId);
        const replacement = getPendingActionConfirmation(replacementId);
        expect(replacement?.actions.map((action) => action.type)).toEqual(['setTrackGain', 'addDevice']);
        expect(replacement?.approvalSnapshot.groundingBasis).toBeUndefined();
        expect(replacement?.protectedUnchanged.map((object) => object.id)).toEqual(
            expect.arrayContaining(['track-snare', 'track-drum-bus'])
        );
    });

    it('a card with no basis carries its own protection into the replacement', async () => {
        let pendingId = '';
        const midiClip = (id: string, name: string, startBeat: number): Clip => ({
            id,
            trackId: 'track-bass',
            name,
            startBeat,
            endBeat: startBeat + 8,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ffffff',
            locked: false,
            muted: false,
        });
        const midiBass: Track = {
            ...storeTrack('track-bass', 'Bass'),
            kind: 'midi',
            clips: [midiClip('clip-midi-intro', 'MIDI Intro', 0), midiClip('clip-midi-verse', 'MIDI Verse', 8)],
        };
        const current = trackStore.value!;
        trackStore.set({
            ...current,
            tracks: current.tracks.filter((track) => track.id !== midiBass.id).concat(midiBass),
        });
        const glue = { name: 'glueClips', arguments: { clipIds: ['clip-midi-intro', 'clip-midi-verse'] } };
        // The request cancels its own glue, so the card holds fewer commands than the provider's calls and
        // carries no basis; the refinement's text protects nothing, so only the refined card itself carries
        // the Drum Bus into the replacement.
        scriptProvider([
            { calls: [glue, ...P1_PLAN], capabilityIds: ['setTrackGain'], protectedTargetIds: ['track-drum-bus'] },
            // The provider restates the protection the thread shows it, as the application-owned scope requires.
            { calls: [vocalsBy(-2), snareBy(-2)], refines: () => pendingId, protectedTargetIds: ['track-drum-bus'] },
        ]);
        await sendChatMessage(
            `glue MIDI Intro and MIDI Verse clips, but don't glue them due to phase issues, then ${P1}`
        );
        pendingId = onlyProposedId();
        const card = getPendingActionConfirmation(pendingId);
        expect(card?.actions.map((action) => action.type)).toEqual(['setTrackGain', 'setTrackGain']);
        expect(card?.approvalSnapshot.groundingBasis).toBeUndefined();
        expect(card?.protectedUnchanged.map((object) => object.id)).toContain('track-drum-bus');

        await sendChatMessage('turn Vocals down 2 dB and turn Snare down 2 dB');

        const replacementId = onlyProposedId();
        expect(replacementId).not.toBe(pendingId);
        const replacement = getPendingActionConfirmation(replacementId);
        expect(replacement).toMatchObject({ supersedes: pendingId });
        expect(pendingLevels(replacementId).map(({ trackId, deltaDb }) => [trackId, deltaDb])).toEqual([
            ['track-vocals', -2],
            ['track-snare', -2],
        ]);
        expect(replacement?.protectedUnchanged.map((object) => object.id)).toContain('track-drum-bus');
        expect(replacement?.approvalSnapshot.commandBatch?.authority.scope.protectedTargetIds).toContain(
            'track-drum-bus'
        );
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

    it('walks the pull request How to test steps in order and applies only the last card, once', async () => {
        let pendingId = '';
        const drumBus = { name: 'setTrackGain', arguments: { trackId: 'track-drum-bus', deltaDb: -1 } };
        scriptProvider([
            { calls: P1_PLAN, protectedTargetIds: ['track-drum-bus'] },
            { calls: [vocalsBy(-1.5), snareBy(-2)], refines: () => pendingId },
            { calls: [vocalsBy(-1.5)], refines: () => pendingId },
            { calls: [vocalsBy(-1)], refines: () => pendingId },
        ]);
        await sendChatMessage(P1);
        pendingId = onlyProposedId();

        await sendChatMessage('make the vocals 1.5 dB');
        pendingId = onlyProposedId();
        expect(pendingLevels(pendingId).map(({ trackId, deltaDb }) => [trackId, deltaDb])).toEqual([
            ['track-vocals', -1.5],
            ['track-snare', -2],
        ]);
        expect(getPendingActionConfirmation(pendingId)?.actionLabels[0]).toContain(
            'direction kept from the pending proposal'
        );

        await sendChatMessage('not the snare');
        pendingId = onlyProposedId();
        expect(pendingLevels(pendingId).map(({ trackId, deltaDb }) => [trackId, deltaDb])).toEqual([
            ['track-vocals', -1.5],
        ]);
        expect(getPendingActionConfirmation(pendingId)?.protectedUnchanged.map((object) => object.id)).toEqual(
            expect.arrayContaining(['track-snare', 'track-drum-bus'])
        );

        await sendChatMessage('less, make it 1 dB');
        pendingId = onlyProposedId();
        expect(pendingLevels(pendingId).map(({ trackId, deltaDb }) => [trackId, deltaDb])).toEqual([
            ['track-vocals', -1],
        ]);

        scriptProvider([{ calls: [vocalsBy(-4)], refines: () => pendingId }]);
        await sendChatMessage('less, make it 4 dB');
        expect(proposedIds()).toEqual([pendingId]);

        scriptProvider([{ calls: [vocalsBy(-1), drumBus], refines: () => pendingId }]);
        await sendChatMessage('make the vocals 1 dB and turn the Drum Bus down 1 dB');
        expect(proposedIds()).toEqual([pendingId]);
        expect(lastAssistantText()).toContain('Drum Bus');

        await expect(confirmPendingChatActions({ confirmationId: pendingId })).resolves.toEqual({
            status: 'executed',
        });
        expect(getTrack('track-vocals').gain).toBeCloseTo(10 ** (-1 / 20), 6);
        expect(getTrack('track-snare').gain).toBe(1);
        expect(getTrack('track-drum-bus').gain).toBe(1);
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
