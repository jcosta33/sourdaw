import { describe, expect, it } from 'vitest';

import { evaluateAutomationLaneAtBeat } from '#/utils/evaluateAutomationLaneAtBeat';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type ProposalProtectionFacts } from '../../../models/ProposalGroundingBasis';
import { validateRefinedProposalActions } from '../../../validators/admitProposalRefinement';
import { compileArbitraryCommandList } from '../../compileArbitraryCommandList';
import { groundCompiledCommandBatch } from '../../groundCompiledCommandBatch';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';
import { proposalCommandShape } from '../proposalCommandShape';
import { proposalProtection } from '../proposalProtection';
import { readExplicitProtections } from '../readExplicitProtections';
import { readStoredCardRemoval } from '../readStoredCardRemoval';

type Track = ProjectContext['tracks'][number];
type Lane = NonNullable<ProjectContext['automationLanes']>[number];
type Action = { type: string; payload: Record<string, unknown> };

function track(id: string, name: string, kind: Track['kind'] = 'audio'): Track {
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
        outputId: 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

function lane(id: string, trackId: string, parameterId: string): Lane {
    return {
        id,
        trackId,
        parameterId,
        name: `${trackId} ${parameterId}`,
        enabled: true,
        minValue: 0,
        maxValue: 1,
        points: [{ beat: 0, value: 0.8, curve: 'linear' }],
    };
}

const CONTEXT: ProjectContext = {
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
    tracks: [
        { ...track('track-vocals', 'Vocals'), sends: [{ busId: 'track-room', level: 0.5, preFader: false }] },
        track('track-room', 'Room', 'bus'),
        track('track-bass', 'Bass'),
    ],
    automationLanes: [
        lane('lane-gain', 'track-vocals', 'gain'),
        lane('lane-pan', 'track-vocals', 'pan'),
        lane('lane-send', 'track-vocals', 'send:track-room'),
        lane('lane-bass-pan', 'track-bass', 'pan'),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

function facts(operation: string, trackId = 'track-vocals', complement = false): ProposalProtectionFacts {
    const control: ProposalProtectionFacts['protectedControls'][number] = {
        trackId,
        operations: complement ? [] : [operation],
    };
    if (complement) {
        control.exceptOperations = [operation];
    }
    return {
        protectedUnchanged: [],
        protectedControls: [control],
    };
}

const gainRange: Action = {
    type: 'automateParameterRange',
    payload: { trackId: 'track-vocals', parameterId: 'gain', range: { startBeat: 0, endBeat: 4 }, deltaDb: -6 },
};
const panRange: Action = {
    type: 'automateParameterRange',
    payload: { trackId: 'track-vocals', parameterId: 'pan', range: { startBeat: 0, endBeat: 4 }, value: 0.2 },
};

function ground(prompt: string, action: Action, extra: Partial<Parameters<typeof groundCompiledCommandBatch>[0]> = {}) {
    return groundCompiledCommandBatch({
        toolCalls: [{ name: action.type, arguments: action.payload }],
        context: CONTEXT,
        prompt,
        projectRevision: undefined,
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

describe('semantic mixer protection', () => {
    it('refuses gain automation under an original fader protection without writing the project', () => {
        const prompt = 'dip Vocals by 6 dB from beat 0 to beat 4 but leave the Vocals fader unchanged';
        const before = structuredClone(CONTEXT);
        const bridge = bridgeGroundedLlmToolCalls({
            calls: [{ name: gainRange.type, arguments: gainRange.payload }],
            context: CONTEXT,
            prompt,
        });
        expect(bridge.actions).toEqual([]);
        expect(bridge.rejections).toContainEqual(
            expect.objectContaining({ reason: expect.stringContaining('Vocals') })
        );
        expect(ground(prompt, gainRange)).toMatchObject({
            status: 'rejected',
            rejectionReason: expect.stringContaining('Vocals'),
        });
        expect(
            ground('automate Vocals pan to 0.2 from beat 0 to beat 4 but leave the Vocals fader unchanged', panRange)
                .status
        ).toBe('grounded');
        expect(CONTEXT).toEqual(before);
    });

    it('keeps a captured fader protection through compiled and scheduled gain proposals', () => {
        const prompt = 'dip Vocals by 6 dB from beat 0 to beat 4 but leave the Vocals fader unchanged';
        const reading = readExplicitProtections(prompt, CONTEXT);
        const captured: ProposalProtectionFacts = {
            protectedUnchanged: [],
            protectedControls: reading.protectedControls.map((control) => ({
                trackId: control.trackId,
                operations: control.actionTypes,
            })),
        };
        expect(captured).toEqual(facts('setTrackGain'));
        const revision = 'semantic-mixer-protection';
        const compiled = compileArbitraryCommandList({
            context: CONTEXT,
            revision,
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: {
                            semantic: { classification: 'simple', uncertainty: [] },
                            objective: prompt,
                            constraints: [],
                            scope: {
                                targetIds: ['track-vocals'],
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
                            items: [
                                {
                                    id: 'gain-dip',
                                    name: gainRange.type,
                                    arguments: {
                                        parameterId: 'gain',
                                        range: { startBeat: 0, endBeat: 4 },
                                        deltaDb: -6,
                                    },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { name: 'Vocals' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            throw new Error(`Expected the typed range list to compile: ${JSON.stringify(compiled)}`);
        }
        expect(
            ground(prompt, gainRange, {
                toolCalls: compiled.compilerEvidence.commands,
                projectRevision: revision,
                compilerEvidence: compiled.compilerEvidence,
            })
        ).toMatchObject({ status: 'rejected', rejectionReason: expect.stringContaining('Vocals') });
        const scheduled = ground('dip Vocals by 6 dB from beat 0 to beat 4', gainRange, {
            prompt,
            requestProtections: {
                request: prompt,
                facts: captured,
                resolvedTrackClauses: reading.resolvedTrackClauses,
            },
        });
        expect(scheduled).toMatchObject({ status: 'rejected', rejectionReason: expect.stringContaining('Vocals') });
    });

    it('matches gain pan and send facets across typed automation routes and complements', () => {
        const laneWrites = [
            ['addAutomationPoint', { beat: 2, value: 0.3 }],
            ['setAutomationLaneEnabled', { enabled: false }],
            ['scaleAutomation', { factor: 0.5 }],
            ['stretchAutomation', { factor: 2 }],
            ['invertAutomation', {}],
            ['reverseAutomation', {}],
            ['thinAutomation', { tolerance: 0.01 }],
            ['quantizeAutomation', { gridSize: 1 }],
        ] as const;
        const routes: Array<{ operation: string; action: Action }> = [
            { operation: 'setTrackGain', action: gainRange },
            { operation: 'setTrackPan', action: panRange },
            {
                operation: 'setSend',
                action: { ...gainRange, payload: { ...gainRange.payload, parameterId: 'send:track-room' } },
            },
            {
                operation: 'setTrackGain',
                action: {
                    type: 'automateTrackGainRange',
                    payload: { trackIds: ['track-vocals'], sectionName: 'Chorus', gainDb: 2 },
                },
            },
            ...['automateSendRange', 'automateSendRanges'].map((type) => ({
                operation: 'setSend',
                action: { type, payload: { trackIds: ['track-vocals'], busId: 'track-room' } },
            })),
        ];
        for (const [parameterId, operation, laneId] of [
            ['gain', 'setTrackGain', 'lane-gain'],
            ['pan', 'setTrackPan', 'lane-pan'],
            ['send:track-room', 'setSend', 'lane-send'],
        ]) {
            routes.push({
                operation: operation!,
                action: { type: 'addAutomationLane', payload: { trackId: 'track-vocals', parameterId } },
            });
            for (const [type, payload] of laneWrites) {
                routes.push({ operation: operation!, action: { type, payload: { ...payload, laneId } } });
            }
        }
        for (const { operation, action } of routes) {
            const parameterId = action.payload.parameterId;
            const laneId = action.payload.laneId;
            let labelTarget = operation;
            if (typeof parameterId === 'string') {
                labelTarget = parameterId;
            } else if (typeof laneId === 'string') {
                labelTarget = laneId;
            }
            const label = `${action.type} ${labelTarget}`;
            expect(proposalProtection.findChange([action], facts(operation), CONTEXT), label).toEqual({
                id: 'track-vocals',
                name: 'Vocals',
            });
            expect(
                proposalProtection.findChange([action], facts(operation, 'track-vocals', true), CONTEXT),
                label
            ).toBeNull();
            const independent = operation === 'setTrackGain' ? 'setTrackPan' : 'setTrackGain';
            expect(proposalProtection.findChange([action], facts(independent), CONTEXT), label).toBeNull();
            expect(
                proposalProtection.findChange([action], facts(independent, 'track-vocals', true), CONTEXT),
                label
            ).not.toBeNull();
        }
    });

    it('keeps source send ownership separate from a referenced protected destination', () => {
        for (const type of ['automateSendRange', 'automateSendRanges']) {
            const action = { type, payload: { trackIds: ['track-vocals'], busId: 'track-room' } };
            expect(
                proposalProtection.findChange([action], facts('setTrackGain', 'track-room', true), CONTEXT)
            ).toBeNull();
            expect(proposalProtection.findChange([action], facts('setSend'), CONTEXT)).not.toBeNull();
            expect(
                proposalProtection.findChange(
                    [action],
                    { protectedControls: [], protectedUnchanged: [{ id: 'track-room', name: 'Room' }] },
                    CONTEXT
                )
            ).toEqual({ id: 'track-room', name: 'Room' });
        }
    });

    it('holds stored-card validation to the same semantic fader protection and exemption', () => {
        const validate = (action: Action, complement: boolean) =>
            validateRefinedProposalActions({
                pendingActions: null,
                actions: [action],
                prompt: 'refine the pending card',
                context: CONTEXT,
                createdObject: proposalCommandShape.createdObject,
                readRemoval: readStoredCardRemoval,
                protection: {
                    facts: facts('setTrackGain', 'track-vocals', complement),
                    readTouchedObjectIds: (type, payload) =>
                        proposalCommandShape.touchedObjectIds(type, payload, CONTEXT),
                    readControlOwnerIds: (type, payload) =>
                        proposalCommandShape.controlOwnerIds(type, payload, CONTEXT),
                    readControlOperations: (type, payload, trackId) =>
                        proposalCommandShape.controlOperations(type, payload, CONTEXT, trackId),
                },
            });
        expect(validate(gainRange, false).status).toBe('refused');
        expect(validate(panRange, false).status).toBe('valid');
        expect(validate(gainRange, true).status).toBe('valid');
        expect(validate(panRange, true).status).toBe('refused');
    });

    it('checks existing automation-mode effects per owner and every affected facet', () => {
        const action = { type: 'setAutomationMode', payload: { trackId: 'track-vocals', mode: 'off' } };
        expect(proposalProtection.findChange([action], facts('setTrackGain'), CONTEXT)).not.toBeNull();
        expect(
            proposalProtection.findChange([action], facts('setTrackGain', 'track-vocals', true), CONTEXT)
        ).not.toBeNull();
        const gainOnly = { ...CONTEXT, automationLanes: [lane('only-gain', 'track-vocals', 'gain')] };
        expect(
            proposalProtection.findChange([action], facts('setTrackGain', 'track-vocals', true), gainOnly)
        ).toBeNull();
        const bassMode = { type: 'setAutomationMode', payload: { trackId: 'track-bass', mode: 'off' } };
        expect(proposalProtection.findChange([bassMode], facts('setTrackGain', 'track-bass'), CONTEXT)).toBeNull();
    });

    it('protects a linked follower gain by its actual owner without protecting the source gain', () => {
        const source = lane('source-pan', 'track-vocals', 'pan');
        const follower = { ...lane('follower-gain', 'track-bass', 'gain'), linkedLaneId: source.id };
        const linkedContext = { ...CONTEXT, automationLanes: [source, follower] };
        const readFollower = (lanes: Lane[]) =>
            evaluateAutomationLaneAtBeat({
                laneId: follower.id,
                beat: 0,
                getLane: (id) => lanes.find((candidate) => candidate.id === id),
                resolveLaneCeiling: (candidate) => candidate.maxValue,
                resolveLaneDeclaredMax: (candidate) => candidate.maxValue,
            });
        expect(readFollower(linkedContext.automationLanes)).toBe(0.8);
        expect(readFollower([{ ...source, points: [{ ...source.points[0]!, value: 0.2 }] }, follower])).toBe(0.2);
        const action = { type: 'scaleAutomation', payload: { laneId: source.id, factor: 0.5 } };
        expect(proposalProtection.findChange([action], facts('setTrackGain', 'track-bass'), linkedContext)).toEqual({
            id: 'track-bass',
            name: 'Bass',
        });
        expect(proposalProtection.findChange([action], facts('setTrackGain'), linkedContext)).toBeNull();
        expect(proposalProtection.findChange([action], facts('setTrackPan', 'track-bass'), linkedContext)).toBeNull();
        expect(
            proposalProtection.findChange([action], facts('setTrackGain', 'track-bass', true), linkedContext)
        ).toBeNull();
        expect(
            proposalProtection.findChange(
                [action],
                { protectedControls: [], protectedUnchanged: [{ id: 'track-bass', name: 'Bass' }] },
                linkedContext
            )
        ).toEqual({ id: 'track-bass', name: 'Bass' });
        const independent = { type: 'scaleAutomation', payload: { laneId: 'lane-gain', factor: 0.5 } };
        expect(
            proposalProtection.findChange([independent], facts('setTrackGain', 'track-bass'), {
                ...linkedContext,
                automationLanes: [...linkedContext.automationLanes, CONTEXT.automationLanes![0]!],
            })
        ).toBeNull();
    });
});
