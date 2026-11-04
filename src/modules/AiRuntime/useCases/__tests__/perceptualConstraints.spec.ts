import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { bindMetricGoalsToBatch } from '../bindMetricGoalsToBatch';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { compilePreviewMeasurementProposal } from '../compilePreviewMeasurementProposal';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { groundCompiledCommandBatch } from '../groundCompiledCommandBatch';
import { type MetricGoalState } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { compilePerceptualConstraints } from '../perceptualConstraints/compilePerceptualConstraints';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';
import { validateAgentRiskApproval } from '../validateAgentRiskApproval';

import { configureMetricGoalProject, metricGoalAudioBuffer, resetMetricGoalProject } from './metricGoalWorkflowFixture';

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

type RenderInput = Parameters<typeof renderTrackSubgraphOffline>[0];

const RUN_ID = 'perceptual-constraint-run';

function clip(trackId: string) {
    return {
        id: `${trackId}-clip`,
        trackId,
        name: 'Take',
        type: 'audio' as const,
        audioBufferId: `${trackId}-buffer`,
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function configureProject(): void {
    configureMetricGoalProject({
        label: RUN_ID,
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            {
                ...createTrack({ id: 'vocal', name: 'Vocal', kind: 'audio' }),
                clips: [clip('vocal')],
                devices: [
                    {
                        id: 'vocal-trim',
                        name: 'Vocal Trim',
                        type: 'builtin-gain',
                        bypassed: false,
                        parameterValues: { 'gain-level': 0 },
                    },
                ],
            },
            {
                ...createTrack({ id: 'bass', name: 'Bass', kind: 'audio' }),
                clips: [clip('bass')],
                devices: [
                    {
                        id: 'bass-eq',
                        name: 'Tone EQ',
                        type: 'builtin-eq',
                        bypassed: false,
                        parameterValues: { 'eq-low-gain': 0, 'eq-high-gain': 0 },
                    },
                    {
                        id: 'bass-filter',
                        name: 'Tone Filter',
                        type: 'builtin-filter',
                        bypassed: false,
                        parameterValues: { 'filter-cutoff': 20 },
                    },
                ],
            },
        ],
        sections: [],
    });
}

/**
 * Each track sounds what its own devices say: the vocal a 1 kHz tone at its trim level, the bass a
 * 100 Hz fundamental beside a 3 kHz overtone that its EQ's high band lifts or cuts.
 */
function renderTrack(input: RenderInput): AudioBuffer {
    const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
    if (track === undefined) {
        throw new Error('The render target is absent.');
    }
    const parameter = (id: string) =>
        track.devices.reduce((total, device) => total + (device.parameterValues[id] ?? 0), 0);
    const seconds = (input.endBeat - input.startBeat) / 2;
    if (track.id === 'vocal') {
        const gain = 10 ** (parameter('gain-level') / 20);
        return metricGoalAudioBuffer((time) => 0.5 * gain * Math.sin(2 * Math.PI * 1000 * time), seconds);
    }
    const high = 10 ** (parameter('eq-high-gain') / 20);
    return metricGoalAudioBuffer(
        (time) => 0.4 * Math.sin(2 * Math.PI * 100 * time) + 0.2 * high * Math.sin(2 * Math.PI * 3000 * time),
        seconds
    );
}

function setParameter(deviceId: string, paramId: string, value: number): AppAction {
    return { type: 'setDeviceParameter', payload: { deviceId, paramId, value } };
}

function compile(prompt: string, actions: AppAction[], metricGoalState?: string) {
    return compileAgentActionExecution({
        actions,
        actionLabels: actions.map((action) => action.type),
        context: getProjectContext(),
        intent: prompt,
        projectRevision: captureProjectRevision(),
        runId: RUN_ID,
        group: { groupId: 'perceptual-constraint-group', groupLabel: prompt },
        requiresConfirmation: true,
        metricGoalState,
    });
}

async function measureBeforeApproval(prompt: string, compiled: ReturnType<typeof compile>) {
    const state = metricGoalStateCodec(compiled.metricGoalState);
    if (state === null) {
        throw new Error('The compiled batch carries no metric goal state.');
    }
    const refreshed = await prepareMetricGoalPreview({
        state,
        commandBatch: compiled.commandBatch,
        context: getProjectContext(),
        prompt,
        runId: RUN_ID,
    });
    const approval = compileAgentRiskApproval({
        commandBatch: compiled.commandBatch,
        requireExplicitApproval: true,
        metricGoalState: JSON.stringify(refreshed.state),
    });
    return {
        evaluation: evaluateMetricGoalAdmission({
            state: refreshed.state,
            commandBatch: compiled.commandBatch,
            currentRevision: captureProjectRevision(),
        }),
        confirm: validateAgentRiskApproval({
            approval,
            commandBatch: compiled.commandBatch,
            currentRevision: captureProjectRevision(),
        }),
    };
}

beforeEach(() => {
    configureProject();
    audio.renderTrackSubgraphOffline.mockReset().mockImplementation(async (input: RenderInput) => renderTrack(input));
    audio.renderOffline.mockReset().mockImplementation(async () => {
        throw new Error('A track-scoped constraint must not render the master.');
    });
    audio.renderOfflineInput.mockReset().mockImplementation(async () => {
        throw new Error('A constraint must be measured on its rendered scope, never on source audio.');
    });
    const revision = captureProjectRevision();
    expect(
        agentRunLifecycle.create({ runId: RUN_ID, request: 'constraint', mode: 'apply', createdRevision: revision })
    ).toEqual({ status: 'created' });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
});

afterEach(() => {
    vi.restoreAllMocks();
    resetMetricGoalProject();
});

describe('compiling perceptual constraints', () => {
    it('compiles "don\'t touch the low end" to an excluded low band held on the master', () => {
        expect(compilePerceptualConstraints("Make it lo-fi but don't touch the low end", getProjectContext())).toEqual({
            constraints: [
                {
                    constraintId: 'low-end-untouched-v1',
                    clause: "don't touch the low end",
                    scope: { kind: 'mix' },
                    protection: { kind: 'exclude-dimension', dimension: 'low-frequency-band' },
                },
            ],
            unsupported: [],
        });
        const compiled = compile("Lift the Vocal Trim but don't touch the low end", [
            setParameter('vocal-trim', 'gain-level', -1),
        ]);
        const goals = metricGoalStateCodec(compiled.metricGoalState)?.authorities.flatMap((authority) =>
            authority.goals.map(({ metricId, band, targetIds, relation, tolerance, range }) => ({
                metricId,
                band,
                targetIds,
                relation,
                tolerance,
                range,
            }))
        );
        const range = { startBeat: 0, endBeat: 4, sectionId: null };
        expect(goals).toEqual([
            {
                metricId: 'frequencyBandEnergy',
                band: 'sub',
                targetIds: ['master'],
                relation: 'hold',
                tolerance: 0.01,
                range,
            },
            {
                metricId: 'frequencyBandEnergy',
                band: 'bass',
                targetIds: ['master'],
                relation: 'hold',
                tolerance: 0.01,
                range,
            },
            {
                metricId: 'lowFrequencyStereoContent',
                band: null,
                targetIds: ['master'],
                relation: 'hold',
                tolerance: 0.01,
                range,
            },
        ]);
    });

    it('compiles "keep the vocal intimate" to excluded ambience and held level and dynamics on the vocal', () => {
        const reading = compilePerceptualConstraints(
            'make this sound like a late-night lo-fi hip hop record but keep the vocal intimate',
            getProjectContext()
        );
        expect(reading).toEqual({
            constraints: [
                {
                    constraintId: 'vocal-intimacy-v1',
                    clause: 'keep the vocal intimate',
                    scope: { kind: 'tracks', trackIds: ['vocal'] },
                    protection: { kind: 'exclude-dimension', dimension: 'ambience' },
                },
            ],
            unsupported: [],
        });
        const compiled = compile('Lower the Vocal Trim and keep the vocal intimate', [
            setParameter('vocal-trim', 'gain-level', -1),
        ]);
        const goals = metricGoalStateCodec(compiled.metricGoalState)?.authorities.flatMap((authority) =>
            authority.goals.map(({ metricId, targetIds, tolerance }) => ({ metricId, targetIds, tolerance }))
        );
        expect(goals).toEqual([
            { metricId: 'dynamicRangeEstimate', targetIds: ['vocal'], tolerance: 1 },
            { metricId: 'rms', targetIds: ['vocal'], tolerance: 0.5 },
        ]);
    });

    it.each([
        ['keep the vocal warm', 'keep the vocal warm'],
        ['Lower the Vocal Trim but keep it punchy', 'keep it punchy'],
        ['keep the Bass intimate', 'keep the Bass intimate'],
        ["don't touch the low end of the Strings", "don't touch the low end of the Strings"],
    ])('keeps "%s" unverified and Confirm blocked, naming the clause', (prompt, clause) => {
        expect(compilePerceptualConstraints(prompt, getProjectContext())).toMatchObject({
            constraints: [],
            unsupported: [{ constraintId: 'unsupported', clause }],
        });
        const compiled = compile(prompt, [setParameter('vocal-trim', 'gain-level', -1)]);
        const evaluation = evaluateMetricGoalAdmission({
            state: metricGoalStateCodec(compiled.metricGoalState),
            commandBatch: compiled.commandBatch,
        });
        expect(evaluation).toMatchObject({ status: 'blocked', failure: 'incomparable' });
        expect(evaluation.reason).toContain(`“${clause}”`);
        expect(compiled.agentApproval?.policy.reasons.join(' ')).toContain(`“${clause}”`);
    });
});

describe('excluded dimensions', () => {
    it.each([
        ['an EQ low band', setParameter('bass-eq', 'eq-low-gain', -3)],
        ['a filter', setParameter('bass-eq-new', 'filter-cutoff', 80)],
        ['bypassing the EQ', { type: 'bypassDevice', payload: { deviceId: 'bass-eq', bypassed: true } } as AppAction],
    ])('refuses %s under "don\'t touch the low end" before anything is compiled or previewed', (_label, action) => {
        expect(() => compile("Clean up the Bass but don't touch the low end", [action])).toThrow(
            /“don't touch the low end”.*low end of/u
        );
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('refuses a reverb added to the vocal under "keep the vocal intimate"', () => {
        const addReverb: AppAction = {
            type: 'addDevice',
            payload: { trackId: 'vocal', deviceType: 'builtin-reverb', deviceId: 'vocal-reverb' },
        };
        expect(() => compile('Add reverb but keep the vocal intimate', [addReverb])).toThrow(
            /“keep the vocal intimate”.*ambience of “Vocal”/u
        );
    });

    it('refuses the excluded edit where the planner previews a batch, before it renders', () => {
        const previewOf = (prompt: string) =>
            compilePreviewMeasurementProposal({
                callId: 'constraint-preview',
                source: {
                    retained: [
                        {
                            callId: 'constraint-preview',
                            revision: captureProjectRevision(),
                            commands: [
                                {
                                    key: '0',
                                    stepId: 'step-0',
                                    operation: 'setDeviceParameter',
                                    arguments: { deviceId: 'bass-filter', paramId: 'filter-cutoff', value: 80 },
                                    reason: 'Move the low band.',
                                    expectedEffect: '',
                                    binding: null,
                                    dependencyKeys: [],
                                },
                            ],
                        },
                    ],
                },
                context: getProjectContext(),
                prompt,
                revision: captureProjectRevision(),
                runId: RUN_ID,
                creativeAuthority: undefined,
            });
        // The same command grounds and compiles without the constraint, so the refusal is the constraint's.
        expect(previewOf('Set the Tone Filter cutoff to 80 Hz')).toMatchObject({ status: 'compiled' });
        expect(previewOf("Set the Tone Filter cutoff to 80 Hz but don't touch the low end")).toEqual({
            status: 'rejected',
            reason: "The request says “don't touch the low end”, but command 1 (setDeviceParameter filter-cutoff) edits the low end of “Bass”.",
        });
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('returns a provider proposal with the excluded edit to the planner as a correctable rejection', () => {
        const groundProposal = (prompt: string) =>
            groundCompiledCommandBatch({
                toolCalls: [{ name: 'addDevice', arguments: { trackId: 'vocal', deviceType: 'builtin-reverb' } }],
                context: getProjectContext(),
                prompt,
                projectRevision: captureProjectRevision(),
                workflowCapabilityId: undefined,
                compilerEvidence: undefined,
                selectedCompilations: [],
                transformCommands: [],
                transformTargetIds: [],
                creativeAuthority: undefined,
                providerProposal: null,
            });
        // The same proposal grounds without the constraint, so the rejection is the constraint's.
        expect(groundProposal('Add a reverb to the Vocal')).toMatchObject({ status: 'grounded' });
        // `Provider action rejected:` is the prefix the planner's bounded correction admits.
        expect(groundProposal('Add a reverb to the Vocal but keep the vocal intimate')).toEqual({
            status: 'rejected',
            rejectionReason:
                'Provider action rejected: The request says “keep the vocal intimate”, but command 1 (addDevice builtin-reverb) edits the ambience of “Vocal”.',
        });
    });

    it('admits an edit outside the excluded dimension', () => {
        expect(() =>
            compile("Brighten the Bass but don't touch the low end", [setParameter('bass-eq', 'eq-high-gain', 0.1)])
        ).not.toThrow();
    });
});

describe('measured invariants before approval', () => {
    it('rejects a preview that moves the vocal level past its tolerance, naming the metric', async () => {
        const prompt = 'Lower the Vocal Trim and keep the vocal intimate';
        const compiled = compile(prompt, [setParameter('vocal-trim', 'gain-level', -6)]);
        const { evaluation, confirm } = await measureBeforeApproval(prompt, compiled);
        expect(evaluation).toMatchObject({ status: 'blocked', failure: 'out-of-tolerance' });
        expect(evaluation.reason).toMatch(
            /“keep the vocal intimate”: RMS level on “Vocal” moved from .* dBFS tolerance/u
        );
        const rms = evaluation.criteria.find((criterion) => criterion.metricId === 'rms');
        expect(rms?.status).toBe('blocked');
        expect((rms?.baseline[0] ?? 0) - (rms?.observed[0] ?? 0)).toBeCloseTo(6, 1);
        expect(confirm).toMatchObject({ status: 'invalid', reason: expect.stringContaining('RMS level on “Vocal”') });
        expect(audio.renderTrackSubgraphOffline.mock.calls.map(([input]) => input.targetTrackId)).toEqual([
            'vocal',
            'vocal',
        ]);
    });

    it('admits a preview whose vocal level stays within tolerance', async () => {
        const prompt = 'Lower the Vocal Trim and keep the vocal intimate';
        const compiled = compile(prompt, [setParameter('vocal-trim', 'gain-level', -0.2)]);
        const { evaluation, confirm } = await measureBeforeApproval(prompt, compiled);
        expect(evaluation).toMatchObject({ status: 'verified', failure: null });
        expect(evaluation.criteria.map((criterion) => [criterion.metricId, criterion.status])).toEqual([
            ['dynamicRangeEstimate', 'verified'],
            ['rms', 'verified'],
        ]);
        expect(confirm).toEqual({ status: 'valid' });
    });

    it('rejects a high-band lift that shifts the low end share of the Bass, naming the band', async () => {
        const prompt = "Brighten the Bass but don't touch the low end of the Bass";
        const compiled = compile(prompt, [setParameter('bass-eq', 'eq-high-gain', 12)]);
        const { evaluation, confirm } = await measureBeforeApproval(prompt, compiled);
        expect(evaluation).toMatchObject({ status: 'blocked', failure: 'out-of-tolerance' });
        expect(evaluation.reason).toMatch(
            /frequency-band energy \(bass band\) on “Bass” moved from .* 0\.01 ratio tolerance/u
        );
        expect(confirm.status).toBe('invalid');
    });

    it('admits a high-band lift small enough to leave the low end share within tolerance', async () => {
        const prompt = "Brighten the Bass but don't touch the low end of the Bass";
        const compiled = compile(prompt, [setParameter('bass-eq', 'eq-high-gain', 0.1)]);
        const { evaluation } = await measureBeforeApproval(prompt, compiled);
        expect(evaluation).toMatchObject({ status: 'verified' });
    });
});

describe('a request with no constraint', () => {
    it('keeps its metric goal state exactly as the batch binds it', () => {
        const literal: MetricGoalState = {
            schemaVersion: 1,
            authorities: [
                {
                    schemaVersion: 1,
                    authorityId: 'literal-fixture',
                    origin: 'complete-literal-parser',
                    callId: null,
                    turn: null,
                    catalogId: 'complete-literal-parser-v1',
                    requestDigest: 'fixture',
                    revision: captureProjectRevision(),
                    projectId: captureProjectIdentity(),
                    selection: getCreativeSelectionSnapshot(getProjectContext()),
                    kind: 'literal',
                    goals: [],
                    creativeAuthority: null,
                },
            ],
            steps: [],
            proofs: [],
            binding: null,
        };
        for (const state of [undefined, JSON.stringify(literal)]) {
            const compiled = compile('Lower the Vocal Trim and keep it simple', [
                setParameter('vocal-trim', 'gain-level', -1),
            ]);
            const expected = bindMetricGoalsToBatch({
                state: metricGoalStateCodec(state),
                commandBatch: compiled.commandBatch,
            });
            const withState = compile(
                'Lower the Vocal Trim and keep it simple',
                [setParameter('vocal-trim', 'gain-level', -1)],
                state
            );
            expect(metricGoalStateCodec(withState.metricGoalState)?.authorities).toEqual(expected.authorities);
            expect(metricGoalStateCodec(withState.metricGoalState)?.steps).toEqual([]);
        }
    });
});
