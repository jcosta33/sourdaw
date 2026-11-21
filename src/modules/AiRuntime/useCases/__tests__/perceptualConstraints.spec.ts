import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { createTrack } from '#/modules/Arrangement/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import {
    type MeasuredPerceptualConstraint,
    type PerceptualConstraintReading,
    type PerceptualConstraintScope,
    type UnsupportedPerceptualConstraint,
} from '../../models/PerceptualConstraint';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { bindMetricGoalsToBatch } from '../bindMetricGoalsToBatch';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { compilePreviewMeasurementProposal } from '../compilePreviewMeasurementProposal';
import { describePendingActionConfirmation } from '../describePendingActionConfirmation';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { groundCompiledCommandBatch } from '../groundCompiledCommandBatch';
import { hasContradictoryMetricGoals } from '../hasContradictoryMetricGoals';
import { type MetricGoal, type MetricGoalState } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { compilePerceptualConstraints } from '../perceptualConstraints/compilePerceptualConstraints';
import { AVOID_VERB, KEEP, SCOPE_WORD } from '../perceptualConstraints/constraintClauseWords';
import { findExcludedDimensionEdit } from '../perceptualConstraints/findExcludedDimensionEdit';
import { PERCEPTUAL_CONSTRAINT_INVARIANTS } from '../perceptualConstraints/perceptualConstraintInvariants';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';
import { validateAgentRiskApproval } from '../validateAgentRiskApproval';

import { configureMetricGoalProject, metricGoalAudioBuffer, resetMetricGoalProject } from './metricGoalWorkflowFixture';
import { moveTrackFader, seedSavableProject, writeProjectSave } from './projectSaveFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

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
            {
                ...createTrack({ id: 'verb-bus', name: 'Verb Bus', kind: 'bus' }),
                devices: [
                    {
                        id: 'bus-plate',
                        name: 'Plate',
                        type: 'builtin-reverb',
                        bypassed: false,
                        parameterValues: { 'rev-wet': 1 },
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

/** The project with automation lanes it already holds, which the store fixture cannot seed. */
function contextWithLanes(lanes: { id: string; trackId: string; parameterId: string }[]) {
    return {
        ...getProjectContext(),
        automationLanes: lanes.map((lane) => ({
            ...lane,
            name: lane.parameterId,
            enabled: true,
            minValue: 0,
            maxValue: 1,
            points: [],
        })),
    };
}

type ProjectContext = ReturnType<typeof getProjectContext>;
type ContextTrack = ProjectContext['tracks'][number];

function device(id: string, type: string): ContextTrack['devices'][number] {
    return { id, name: id, type, bypassed: false };
}

/**
 * The project with buses and routing the store fixture does not hold: each extra bus is the Verb Bus
 * with its own id, name and devices, and each route sets a track's sends and output.
 */
function contextWithRouting(
    routes: Readonly<Record<string, { sends?: string[]; outputId?: string }>>,
    buses: Pick<ContextTrack, 'id' | 'name' | 'devices'>[]
): ProjectContext {
    const context = getProjectContext();
    const template = context.tracks.find((track) => track.id === 'verb-bus');
    if (template === undefined) {
        throw new Error('The fixture holds the Verb Bus.');
    }
    const tracks = [...context.tracks, ...buses.map((bus) => ({ ...template, ...bus }))];
    return {
        ...context,
        tracks: tracks.map((track) => {
            const route = routes[track.id];
            if (route === undefined) {
                return track;
            }
            const sends = route.sends?.map((busId) => ({ busId, level: 0.5, preFader: false })) ?? track.sends;
            return { ...track, sends, outputId: route.outputId ?? track.outputId };
        }),
    };
}

/** The refusal the edit reader gives a batch under the request's constraints, or `null` when it admits it. */
function readExcludedEdit(prompt: string, actions: AppAction[], context: ProjectContext): string | null {
    return (
        findExcludedDimensionEdit({
            constraints: compilePerceptualConstraints(prompt, context).constraints,
            actions,
            context,
        })?.reason ?? null
    );
}

type CompileOptions = {
    metricGoalState?: string;
    context?: ReturnType<typeof getProjectContext>;
    recordedConstraints?: ReturnType<typeof compilePerceptualConstraints>;
};

function compile(prompt: string, actions: AppAction[], options: CompileOptions = {}) {
    return compileAgentActionExecution({
        actions,
        actionLabels: actions.map((action) => action.type),
        context: options.context ?? getProjectContext(),
        intent: prompt,
        projectRevision: captureProjectRevision(),
        runId: RUN_ID,
        group: { groupId: 'perceptual-constraint-group', groupLabel: prompt },
        requiresConfirmation: true,
        metricGoalState: options.metricGoalState,
        recordedConstraints: options.recordedConstraints,
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
    registerHandlerMap(getAutomationHandlers());
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

const bypassEq: AppAction = { type: 'bypassDevice', payload: { deviceId: 'bass-eq', bypassed: true } };

describe('excluded dimensions', () => {
    it.each([
        ['an EQ low band', setParameter('bass-eq', 'eq-low-gain', -3)],
        ['a filter', setParameter('bass-eq-new', 'filter-cutoff', 80)],
        ['bypassing the EQ', bypassEq],
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

    it.each([
        {
            label: 'a send from the constrained vocal',
            prompt: 'Send the Vocal to the Verb Bus and keep the vocal intimate',
            action: { type: 'addSend', payload: { trackId: 'vocal', busId: 'verb-bus', levelDb: -12 } },
            reason: 'command 1 (addSend send) edits the ambience of “Vocal”',
        },
        {
            label: 'a reverb wet write on the constrained vocal',
            prompt: 'Make the Vocal wetter but keep the vocal intimate',
            action: {
                type: 'setDeviceParameter',
                payload: { deviceId: 'vocal-room', paramId: 'rev-wet', value: 0.5, expectedTrackId: 'vocal' },
            },
            reason: 'command 1 (setDeviceParameter rev-wet) edits the ambience of “Vocal”',
        },
        {
            label: 'a reverb low-cut write under the low-end constraint',
            prompt: "Open up the Verb Bus but don't touch the low end",
            action: setParameter('bus-plate', 'rev-lowcut', 40),
            reason: 'command 1 (setDeviceParameter rev-lowcut) edits the low end of “Verb Bus”',
        },
        {
            label: 'removing the low-end EQ',
            prompt: "Simplify the Bass chain but don't touch the low end",
            action: { type: 'removeDevice', payload: { deviceId: 'bass-eq' } },
            reason: 'command 1 (removeDevice builtin-eq) edits the low end of “Bass”',
        },
    ] satisfies { label: string; prompt: string; action: AppAction; reason: string }[])(
        'refuses $label',
        ({ prompt, action, reason }) => {
            expect(() => compile(prompt, [action])).toThrow(reason);
        }
    );

    const lanes = () =>
        contextWithLanes([
            { id: 'vocal-send-lane', trackId: 'vocal', parameterId: 'send:verb-bus' },
            { id: 'vocal-gain-lane', trackId: 'vocal', parameterId: 'gain' },
            { id: 'plate-lowcut-lane', trackId: 'verb-bus', parameterId: 'bus-plate:rev-lowcut' },
        ]);
    const intimate = 'Shape the Vocal and keep the vocal intimate';

    it.each([
        {
            label: 'a new reverb parameter lane and its point',
            prompt: intimate,
            actions: [
                {
                    type: 'addAutomationLane',
                    payload: {
                        trackId: 'vocal',
                        parameterId: 'vocal-room:rev-mix',
                        parameterName: 'Room Mix',
                        laneId: 'room-lane',
                    },
                },
                { type: 'addAutomationPoint', payload: { laneId: 'room-lane', beat: 0, value: 0.8 } },
            ],
            reason: 'command 1 (addAutomationLane vocal-room:rev-mix) edits the ambience of “Vocal”',
        },
        {
            label: 'a new send lane and its point',
            prompt: intimate,
            actions: [
                {
                    type: 'addAutomationLane',
                    payload: {
                        trackId: 'vocal',
                        parameterId: 'send:verb-bus',
                        parameterName: 'Verb',
                        laneId: 'send-lane',
                    },
                },
                { type: 'addAutomationPoint', payload: { laneId: 'send-lane', beat: 0, value: 0.8 } },
            ],
            reason: 'command 1 (addAutomationLane send:verb-bus) edits the ambience of “Vocal”',
        },
        {
            label: 'a point on the send lane the project holds',
            prompt: intimate,
            actions: [{ type: 'addAutomationPoint', payload: { laneId: 'vocal-send-lane', beat: 0, value: 0.8 } }],
            reason: 'command 1 (addAutomationPoint send:verb-bus) edits the ambience of “Vocal”',
        },
        {
            label: 'scaling a reverb low-cut lane under the low-end constraint',
            prompt: "Open up the Verb Bus but don't touch the low end",
            actions: [{ type: 'scaleAutomation', payload: { laneId: 'plate-lowcut-lane', factor: 2 } }],
            reason: 'command 1 (scaleAutomation bus-plate:rev-lowcut) edits the low end of “Verb Bus”',
        },
        {
            label: 'routing the vocal into the reverb bus',
            prompt: intimate,
            actions: [{ type: 'setTrackOutput', payload: { trackId: 'vocal', outputId: 'verb-bus' } }],
            reason: 'command 1 (setTrackOutput to Verb Bus) edits the ambience of “Vocal”',
        },
        {
            label: 'a sidechain into the vocal, which no reader places',
            prompt: intimate,
            actions: [{ type: 'addSidechainRoute', payload: { sourceTrackId: 'bass', targetTrackId: 'vocal' } }],
            reason: 'command 1 (addSidechainRoute routing and processing) changes “Vocal” in a way the application cannot show leaves its ambience alone',
        },
        {
            label: 'a point on a lane neither the project nor the batch holds',
            prompt: intimate,
            actions: [{ type: 'addAutomationPoint', payload: { laneId: 'ghost-lane', beat: 0, value: 0.8 } }],
            reason: 'command 1 (addAutomationPoint automation) changes a track the batch does not name in a way the application cannot show leaves its ambience alone',
        },
        {
            label: 'a lane whose parameter id names neither the channel, a send nor a device parameter',
            prompt: intimate,
            actions: [
                {
                    type: 'addAutomationLane',
                    payload: { trackId: 'vocal', parameterId: 'width', parameterName: 'Width', laneId: 'width-lane' },
                },
            ],
            reason: 'command 1 (addAutomationLane width) changes “Vocal” in a way the application cannot show leaves its ambience alone',
        },
        {
            label: 'send automation from the vocal',
            prompt: intimate,
            actions: [
                {
                    type: 'automateSendRange',
                    payload: { trackIds: ['vocal'], busId: 'verb-bus', sectionName: 'Chorus', reductionDb: 3 },
                },
            ],
            reason: 'command 1 (automateSendRange send automation) edits the ambience of “Vocal”',
        },
    ] satisfies { label: string; prompt: string; actions: AppAction[]; reason: string }[])(
        'refuses $label',
        ({ prompt, actions, reason }) => {
            expect(() => compile(prompt, actions, { context: lanes() })).toThrow(reason);
        }
    );

    it.each([
        ['muting the vocal', [{ type: 'muteTrack', payload: { trackId: 'vocal', muted: true, expectedMuted: false } }]],
        [
            'soloing the vocal',
            [{ type: 'soloTrack', payload: { trackId: 'vocal', soloed: true, expectedSoloed: false } }],
        ],
        [
            'turning the vocal down',
            [{ type: 'setTrackGain', payload: { trackId: 'vocal', deltaDb: -2, expectedGain: 1 } }],
        ],
        [
            'a new fader lane and its point',
            [
                {
                    type: 'addAutomationLane',
                    payload: { trackId: 'vocal', parameterId: 'gain', parameterName: 'Volume', laneId: 'fader-lane' },
                },
                { type: 'addAutomationPoint', payload: { laneId: 'fader-lane', beat: 0, value: 0.8 } },
            ],
        ],
        ['scaling the fader lane', [{ type: 'scaleAutomation', payload: { laneId: 'vocal-gain-lane', factor: 0.5 } }]],
        [
            'a new pan lane and its point',
            [
                {
                    type: 'addAutomationLane',
                    payload: { trackId: 'vocal', parameterId: 'pan', parameterName: 'Pan', laneId: 'pan-lane' },
                },
                { type: 'addAutomationPoint', payload: { laneId: 'pan-lane', beat: 0, value: 0.5 } },
            ],
        ],
    ] satisfies [string, AppAction[]][])('admits %s under "keep the vocal intimate"', (_label, actions) => {
        expect(() => compile(intimate, actions, { context: lanes() })).not.toThrow();
    });

    // Read straight from the edit reader: these edits name devices and buses the store fixture does not hold.
    it.each([
        [
            'a compressor added to the vocal',
            { type: 'addDevice', payload: { trackId: 'vocal', deviceType: 'builtin-compressor' } },
        ],
        [
            'moving a vocal clip',
            { type: 'moveClip', payload: { clipId: 'vocal-clip', trackId: 'vocal', startBeat: 4 } },
        ],
        [
            'a sidechain between tracks the vocal never reaches',
            { type: 'addSidechainRoute', payload: { sourceTrackId: 'bass', targetTrackId: 'verb-bus' } },
        ],
    ] satisfies [string, AppAction][])('admits %s under "keep the vocal intimate"', (_label, action) => {
        expect(readExcludedEdit(intimate, [action], getProjectContext())).toBeNull();
    });

    describe('the buses a scoped track sounds through', () => {
        const lowEnd = "Clean up the mix but don't touch the low end of the Vocal";
        const routed = () =>
            contextWithRouting(
                {
                    vocal: { sends: ['verb-bus'], outputId: 'stem-bus' },
                    'stem-bus': { outputId: 'glue-bus' },
                    // A send back up the chain: the reading must end on a routing cycle.
                    'glue-bus': { sends: ['stem-bus'] },
                    bass: { sends: ['bass-return'] },
                },
                [
                    { id: 'bass-return', name: 'Bass Return', devices: [device('bass-plate', 'builtin-reverb')] },
                    { id: 'stem-bus', name: 'Stem Bus', devices: [] },
                    { id: 'glue-bus', name: 'Glue Bus', devices: [device('glue-eq', 'builtin-eq')] },
                    { id: 'drum-bus', name: 'Drum Bus', devices: [device('drum-eq', 'builtin-eq')] },
                    { id: 'spare-bus', name: 'Spare Bus', devices: [] },
                ]
            );

        it.each([
            {
                label: 'a reverb size on the return the vocal sends to',
                prompt: intimate,
                actions: [setParameter('bus-plate', 'rev-size', 0.8)],
                reason: 'command 1 (setDeviceParameter rev-size) edits the ambience of “Verb Bus”',
            },
            {
                label: 'a reverb added on the bus the vocal is routed into',
                prompt: intimate,
                actions: [
                    {
                        type: 'addDevice',
                        payload: { trackId: 'stem-bus', deviceType: 'builtin-reverb', deviceId: 'stem-verb' },
                    },
                ],
                reason: 'command 1 (addDevice builtin-reverb) edits the ambience of “Stem Bus”',
            },
            {
                label: 'a low band cut two buses down the vocal output',
                prompt: lowEnd,
                actions: [setParameter('glue-eq', 'eq-low-gain', -3)],
                reason: 'command 1 (setDeviceParameter eq-low-gain) edits the low end of “Glue Bus”',
            },
            {
                label: 'a low band cut on a bus the same batch sends the vocal to',
                prompt: lowEnd,
                actions: [
                    { type: 'addSend', payload: { trackId: 'vocal', busId: 'drum-bus', levelDb: -12 } },
                    setParameter('drum-eq', 'eq-low-gain', -3),
                ],
                reason: 'command 1 (addSend send) edits the low end of “Vocal”',
            },
            {
                label: 'a reverb added on a bus the same batch routes the vocal into',
                prompt: intimate,
                actions: [
                    { type: 'setTrackOutput', payload: { trackId: 'vocal', outputId: 'spare-bus' } },
                    {
                        type: 'addDevice',
                        payload: { trackId: 'spare-bus', deviceType: 'builtin-reverb', deviceId: 'spare-verb' },
                    },
                ],
                reason: 'command 2 (addDevice builtin-reverb) edits the ambience of “Spare Bus”',
            },
        ] satisfies { label: string; prompt: string; actions: AppAction[]; reason: string }[])(
            'refuses $label',
            ({ prompt, actions, reason }) => {
                expect(readExcludedEdit(prompt, actions, routed())).toContain(reason);
            }
        );

        it.each([
            ['a reverb size on a return only the Bass feeds', intimate, setParameter('bass-plate', 'rev-size', 0.8)],
            ['a low band cut on a bus the vocal never reaches', lowEnd, setParameter('drum-eq', 'eq-low-gain', -3)],
        ] satisfies [string, string, AppAction][])('admits %s', (_label, prompt, action) => {
            expect(readExcludedEdit(prompt, [action], routed())).toBeNull();
        });
    });

    describe('removing a track', () => {
        const lowEnd = "Clean up the mix but don't touch the low end of the Bass";
        const routed = () =>
            contextWithRouting(
                {
                    vocal: { sends: ['return-a'], outputId: 'bus-a' },
                    bass: { outputId: 'low-bus' },
                    'hop-bus': { outputId: 'verb-bus-b' },
                },
                [
                    { id: 'bus-a', name: 'Bus A', devices: [device('a-verb', 'builtin-reverb')] },
                    { id: 'return-a', name: 'Return A', devices: [device('r-verb', 'builtin-reverb')] },
                    { id: 'hop-bus', name: 'Hop Bus', devices: [] },
                    { id: 'verb-bus-b', name: 'Verb Bus B', devices: [device('b-verb', 'builtin-reverb')] },
                    { id: 'low-bus', name: 'Low Bus', devices: [device('low-eq', 'builtin-eq')] },
                    { id: 'stray-verb', name: 'Stray Verb', devices: [device('s-verb', 'builtin-reverb')] },
                    { id: 'eq-only', name: 'EQ Only', devices: [] },
                ]
            );
        const remove = (trackId: string): AppAction => ({ type: 'removeTrack', payload: { trackId } });
        const removeFrom = (context: ProjectContext, trackId: string) =>
            readExcludedEdit(intimate, [remove(trackId)], context);

        it.each([
            { label: 'the bus the vocal outputs to', trackId: 'bus-a', name: 'Bus A' },
            { label: 'the return the vocal sends to', trackId: 'return-a', name: 'Return A' },
        ])('refuses removing $label', ({ trackId, name }) => {
            expect(removeFrom(routed(), trackId)).toContain(
                `command 1 (removeTrack removing ${name}) edits the ambience of “${name}”`
            );
        });

        it('admits removing a device-less bus on the vocal output chain, which hands its output on', () => {
            const context = contextWithRouting(
                { vocal: { sends: [], outputId: 'hop-bus' }, 'hop-bus': { sends: [], outputId: 'verb-bus-b' } },
                [
                    { id: 'hop-bus', name: 'Hop Bus', devices: [] },
                    { id: 'verb-bus-b', name: 'Verb Bus B', devices: [device('b-verb', 'builtin-reverb')] },
                ]
            );
            expect(removeFrom(context, 'hop-bus')).toBeNull();
        });

        it('refuses removing a device-less bus on the vocal output chain whose own send reaches a reverb', () => {
            const context = contextWithRouting(
                { vocal: { sends: [], outputId: 'bus-a' }, 'bus-a': { sends: ['verb-bus-b'] } },
                [
                    { id: 'bus-a', name: 'Bus A', devices: [] },
                    { id: 'verb-bus-b', name: 'Verb Bus B', devices: [device('b-verb', 'builtin-reverb')] },
                ]
            );
            expect(removeFrom(context, 'bus-a')).toContain(
                'command 1 (removeTrack removing Bus A) edits the ambience of “Bus A”'
            );
        });

        it('refuses removing a device-less return the vocal sends to whose output reaches a reverb', () => {
            const context = contextWithRouting(
                {
                    vocal: { sends: ['hop-return'], outputId: 'master' },
                    'hop-return': { sends: [], outputId: 'verb-bus-b' },
                },
                [
                    { id: 'hop-return', name: 'Hop Return', devices: [] },
                    { id: 'verb-bus-b', name: 'Verb Bus B', devices: [device('b-verb', 'builtin-reverb')] },
                ]
            );
            expect(removeFrom(context, 'hop-return')).toContain(
                'command 1 (removeTrack removing Hop Return) edits the ambience of “Vocal”'
            );
        });

        it('charges a send copy lost with a bus to the sender, not to a vocal routed through the bus', () => {
            const context = contextWithRouting(
                {
                    vocal: { sends: [], outputId: 'bus-a' },
                    'bus-a': { sends: [], outputId: 'verb-bus-b' },
                    bass: { sends: ['bus-a'] },
                },
                [
                    { id: 'bus-a', name: 'Bus A', devices: [] },
                    { id: 'verb-bus-b', name: 'Verb Bus B', devices: [device('b-verb', 'builtin-reverb')] },
                ]
            );
            expect(removeFrom(context, 'bus-a')).toBeNull();
        });

        it('refuses removing the bus a bass outputs to under the low-end constraint', () => {
            expect(readExcludedEdit(lowEnd, [remove('low-bus')], routed())).toContain(
                'command 1 (removeTrack removing Low Bus) edits the low end of “Low Bus”'
            );
        });

        it('admits removing a reverb bus the vocal does not reach', () => {
            expect(removeFrom(routed(), 'stray-verb')).toBeNull();
        });

        it('admits removing a bus the vocal reaches when nothing it reaches shapes space', () => {
            const context = contextWithRouting({ vocal: { outputId: 'eq-only' } }, [
                { id: 'eq-only', name: 'EQ Only', devices: [] },
            ]);
            expect(removeFrom(context, 'eq-only')).toBeNull();
        });
    });

    describe('the routing a batch leaves behind', () => {
        const lowEnd = "Clean up the mix but don't touch the low end of the Vocal";
        const routed = () =>
            contextWithRouting(
                {
                    vocal: { outputId: 'bus-a' },
                    'vocal-bus': { outputId: 'verb-bus' },
                    'eq-bus': { outputId: 'low-bus' },
                },
                [
                    { id: 'bus-a', name: 'Bus A', devices: [device('a-verb', 'builtin-reverb')] },
                    { id: 'vocal-bus', name: 'Vocal Bus', devices: [] },
                    { id: 'eq-bus', name: 'EQ Bus', devices: [] },
                    { id: 'low-bus', name: 'Low Bus', devices: [device('low-eq', 'builtin-eq')] },
                ]
            );
        const outputTo = (outputId: string): AppAction => ({
            type: 'setTrackOutput',
            payload: { trackId: 'vocal', outputId },
        });

        it.each([
            {
                label: 'an output into a device-less bus that sends to a reverb return',
                prompt: intimate,
                actions: [outputTo('vocal-bus')],
                reason: 'command 1 (setTrackOutput to Vocal Bus) edits the ambience of “Vocal”',
            },
            {
                label: 'a send into a device-less bus that outputs to a reverb return',
                prompt: intimate,
                actions: [{ type: 'addSend', payload: { trackId: 'vocal', busId: 'vocal-bus', levelDb: -12 } }],
                reason: 'command 1 (addSend send) edits the ambience of “Vocal”',
            },
            {
                label: 'an output into a device-less bus that outputs to a bus holding an equalizer',
                prompt: lowEnd,
                actions: [outputTo('eq-bus')],
                reason: 'command 1 (setTrackOutput to EQ Bus) edits the low end of “Vocal”',
            },
            {
                label: 'a send reaching an equalizer, which adds a processed parallel copy',
                prompt: lowEnd,
                actions: [{ type: 'addSend', payload: { trackId: 'vocal', busId: 'eq-bus', levelDb: -12 } }],
                reason: 'command 1 (addSend send) edits the low end of “Vocal”',
            },
            {
                label: 'a reverb edit when the later output is the one into the reverb bus',
                prompt: intimate,
                actions: [outputTo('master'), outputTo('bus-a'), setParameter('a-verb', 'rev-size', 0.8)],
                reason: 'command 2 (setTrackOutput to Bus A) edits the ambience of “Vocal”',
            },
        ] satisfies { label: string; prompt: string; actions: AppAction[]; reason: string }[])(
            'refuses $label',
            ({ prompt, actions, reason }) => {
                expect(readExcludedEdit(prompt, actions, routed())).toContain(reason);
            }
        );

        it.each([
            {
                label: 'a reverb edit on the bus the batch moved the vocal output away from',
                actions: [outputTo('master'), setParameter('a-verb', 'rev-size', 0.8)],
            },
            {
                label: 'a reverb edit when the later output is the one to master',
                actions: [outputTo('bus-a'), outputTo('master'), setParameter('a-verb', 'rev-size', 0.8)],
            },
        ] satisfies { label: string; actions: AppAction[] }[])('admits $label', ({ actions }) => {
            expect(readExcludedEdit(intimate, actions, routed())).toBeNull();
        });

        const withVocalSends = (busIds: string[]): ProjectContext => {
            const context = contextWithRouting({ vocal: { outputId: 'master' } }, [
                { id: 'bus-a', name: 'Bus A', devices: [device('a-verb', 'builtin-reverb')] },
                { id: 'low-bus', name: 'Low Bus', devices: [device('low-eq', 'builtin-eq')] },
            ]);
            const sends = busIds.map((busId) => ({ busId, level: 0.5, preFader: false }));
            const tracks = context.tracks.map((track) => {
                if (track.id !== 'vocal') {
                    return track;
                }
                return { ...track, sends };
            });
            return { ...context, tracks };
        };

        it.each([
            {
                label: 'removing the vocal send into a bus holding an equalizer',
                action: { type: 'removeSend', payload: { trackId: 'vocal', busId: 'low-bus' } },
                detail: 'removeSend send',
            },
            {
                label: 'changing the vocal send into a bus holding an equalizer',
                action: { type: 'setSend', payload: { trackId: 'vocal', busId: 'low-bus', levelDb: -6 } },
                detail: 'setSend send',
            },
        ] satisfies { label: string; action: AppAction; detail: string }[])(
            'refuses $label under the low-end constraint',
            ({ action, detail }) => {
                expect(readExcludedEdit(lowEnd, [action], withVocalSends(['low-bus']))).toContain(
                    `command 1 (${detail}) edits the low end of “Vocal”`
                );
            }
        );

        it('admits a reverb low-cut edit on a bus the batch first removed the vocal send into', () => {
            const edit = setParameter('a-verb', 'rev-lowcut', 0.4);
            const remove: AppAction = { type: 'removeSend', payload: { trackId: 'vocal', busId: 'bus-a' } };
            expect(readExcludedEdit(lowEnd, [edit], withVocalSends(['bus-a']))).toContain(
                'edits the low end of “Bus A”'
            );
            expect(readExcludedEdit(lowEnd, [remove, edit], withVocalSends(['bus-a']))).toBeNull();
        });
    });

    it('refuses at compilation an excluded edit the refined card recorded, though the refinement states none', () => {
        const recordedConstraints = compilePerceptualConstraints(
            'Add warmth and keep the vocal intimate',
            getProjectContext()
        );
        expect(recordedConstraints.constraints).toHaveLength(1);
        const addReverb: AppAction = {
            type: 'addDevice',
            payload: { trackId: 'vocal', deviceType: 'builtin-reverb', deviceId: 'vocal-reverb' },
        };
        // The refinement's own text states no constraint, so the refusal is the record's.
        expect(() => compile('Add a reverb to the Vocal', [addReverb])).not.toThrow();
        expect(() => compile('Add a reverb to the Vocal', [addReverb], { recordedConstraints })).toThrow(
            'The request says “keep the vocal intimate”, but command 1 (addDevice builtin-reverb) edits the ambience of “Vocal”.'
        );
    });

    it('admits an ambience edit on a track outside a track-scoped constraint', () => {
        const addReverb: AppAction = {
            type: 'addDevice',
            payload: { trackId: 'bass', deviceType: 'builtin-reverb', deviceId: 'bass-reverb' },
        };
        expect(() => compile('Add reverb to the Bass and keep the vocal intimate', [addReverb])).not.toThrow();
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

describe('a metric-goal preview of a batch compiled before a save', () => {
    const prompt = 'Lower the Vocal Trim and keep the vocal intimate';

    /** The preview a card asks for, run after the project moved past the revision the batch was compiled at. */
    function previewCompiledBatch(compiled: ReturnType<typeof compile>) {
        const state = metricGoalStateCodec(compiled.metricGoalState);
        if (state === null) {
            throw new Error('The compiled batch carries no metric goal state.');
        }
        return prepareMetricGoalPreview({
            state,
            commandBatch: compiled.commandBatch,
            context: getProjectContext(),
            prompt,
            runId: RUN_ID,
        });
    }

    it('renders and proves a batch the project was saved after, before any render started', async () => {
        seedSavableProject();
        const compiledAt = captureProjectRevision();
        const compiled = compile(prompt, [setParameter('vocal-trim', 'gain-level', -0.2)]);

        await writeProjectSave();

        expect(captureProjectRevision()).not.toBe(compiledAt);
        const refreshed = await previewCompiledBatch(compiled);
        expect(audio.renderTrackSubgraphOffline.mock.calls.map(([input]) => input.targetTrackId)).toEqual([
            'vocal',
            'vocal',
        ]);
        expect(refreshed.receipts).toHaveLength(1);
        expect(refreshed.state.proofs).not.toHaveLength(0);
    });

    it('refuses before rendering a batch compiled before another track’s fader moved and the project was saved', async () => {
        seedSavableProject();
        const compiled = compile(prompt, [setParameter('vocal-trim', 'gain-level', -0.2)]);

        moveTrackFader('bass', 0.5);
        await writeProjectSave();

        await expect(previewCompiledBatch(compiled)).rejects.toThrow(
            'The project, provider configuration or run changed while metric proof was being refreshed.'
        );
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
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
                { metricGoalState: state }
            );
            expect(metricGoalStateCodec(withState.metricGoalState)?.authorities).toEqual(expected.authorities);
            expect(metricGoalStateCodec(withState.metricGoalState)?.steps).toEqual([]);
        }
    });
});

const MIX: PerceptualConstraintScope = { kind: 'mix' };
const onTracks = (...trackIds: string[]): PerceptualConstraintScope => ({ kind: 'tracks', trackIds });
function measured(
    constraintId: MeasuredPerceptualConstraint['constraintId'],
    clause: string,
    scope: PerceptualConstraintScope
): MeasuredPerceptualConstraint {
    return { constraintId, clause, scope, protection: { kind: 'measured' } };
}

function unread(clause: string, reason: string): UnsupportedPerceptualConstraint {
    return { constraintId: 'unsupported', clause, reason };
}

function unmeasured(term: string): string {
    return `No measurement the application takes shows that “${term}” holds.`;
}

const COMPARATIVE_REASON =
    'It compares against another track or the mix, and a measured bound holds one scope only to its own figures.';
const NET_REASON =
    'The application reads no measured bound or hold in these words, so nothing it measures shows that they hold.';
function exceptionReason(exception: string): string {
    return `“${exception}” excepts part of what its clause holds, and a measured bound or hold covers its whole scope.`;
}

function asideObjectReason(aside: string): string {
    return `“${aside}” names an object beside the one its clause holds, so no single scope can be measured.`;
}

const BRACKET_REASON =
    'A bracket stands inside these words, so the application reads no measured bound or hold in them.';

/**
 * The fixture project with a Drums track, a track whose name holds "louder", a guitar known only by
 * its role, and any extra names.
 */
function grammarContext(...extraNames: string[]): ProjectContext {
    const context = getProjectContext();
    const template = context.tracks.find((track) => track.id === 'vocal');
    if (template === undefined) {
        throw new Error('The fixture holds the Vocal.');
    }
    const named = (id: string, name: string) => ({ ...template, id, name, devices: [] });
    return {
        ...context,
        tracks: [
            ...context.tracks,
            named('drums', 'Drums'),
            named('louder-pad', 'Louder Pad'),
            {
                ...named('gtr', 'Gtr 1'),
                canonicalRole: { role: 'guitar', source: 'authored', evidence: 'authored-role' },
            },
            ...extraNames.map((name, index) => named(`extra-${String(index)}`, name)),
        ],
    };
}

describe('reading measured holds and bounds', () => {
    it.each([
        // loudness bounds and holds
        ["don't make it louder", [measured('loudness-not-raised-v1', "don't make it louder", MIX)], []],
        ["don't make it quieter", [measured('loudness-not-lowered-v1', "don't make it quieter", MIX)], []],
        [
            'without making it any softer',
            [measured('loudness-not-lowered-v1', 'without making it any softer', MIX)],
            [],
        ],
        [
            "don't make the mix louder or quieter",
            [measured('loudness-held-v1', "don't make the mix louder or quieter", MIX)],
            [],
        ],
        [
            "make the vocal louder but don't make the mix louder",
            [measured('loudness-not-raised-v1', "don't make the mix louder", MIX)],
            [],
        ],
        [
            "don't make the drums louder, and brighten the vocal",
            [measured('loudness-not-raised-v1', "don't make the drums louder", onTracks('drums'))],
            [],
        ],
        [
            'brighten the vocal but the drums must not get louder',
            [measured('loudness-not-raised-v1', 'the drums must not get louder', onTracks('drums'))],
            [],
        ],
        [
            "don't raise the volume of the drums",
            [measured('loudness-not-raised-v1', "don't raise the volume of the drums", onTracks('drums'))],
            [],
        ],
        ["don't turn down the level", [measured('loudness-not-lowered-v1', "don't turn down the level", MIX)], []],
        [
            "don't change the level of the drums",
            [measured('loudness-held-v1', "don't change the level of the drums", onTracks('drums'))],
            [],
        ],
        ['keep the overall level the same', [measured('loudness-held-v1', 'keep the overall level the same', MIX)], []],
        [
            'keep the Bass at the same level',
            [measured('loudness-held-v1', 'keep the Bass at the same level', onTracks('bass'))],
            [],
        ],
        [
            "don't make Louder Pad louder",
            [measured('loudness-not-raised-v1', "don't make Louder Pad louder", onTracks('louder-pad'))],
            [],
        ],
        [
            "don't make the tuba louder",
            [],
            [unread("don't make the tuba louder", '“the tuba” names no track or mix whose loudness can be measured.')],
        ],
        // width, dynamics and brightness holds
        ['keep the width of the mix', [measured('stereo-width-held-v1', 'keep the width of the mix', MIX)], []],
        ['keep the stereo width', [measured('stereo-width-held-v1', 'keep the stereo width', MIX)], []],
        ['keep the mix as wide as it is', [measured('stereo-width-held-v1', 'keep the mix as wide', MIX)], []],
        [
            'keep the drums as dynamic as they are',
            [measured('dynamics-held-v1', 'keep the drums as dynamic', onTracks('drums'))],
            [],
        ],
        [
            'keep the dynamics of the vocal',
            [measured('dynamics-held-v1', 'keep the dynamics of the vocal', onTracks('vocal'))],
            [],
        ],
        ['keep the vocal bright', [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))], []],
        [
            'keep the brightness of the Bass',
            [measured('brightness-held-v1', 'keep the brightness of the Bass', onTracks('bass'))],
            [],
        ],
        // coordinated qualities share their object, each held in its own family
        [
            'keep the vocal intimate and dynamic',
            [
                {
                    constraintId: 'vocal-intimacy-v1',
                    clause: 'keep the vocal intimate and dynamic',
                    scope: onTracks('vocal'),
                    protection: { kind: 'exclude-dimension', dimension: 'ambience' },
                },
                measured('dynamics-held-v1', 'keep the vocal intimate and dynamic', onTracks('vocal')),
            ],
            [],
        ],
        [
            'keep the mix wide and dynamic',
            [
                measured('stereo-width-held-v1', 'keep the mix wide and dynamic', MIX),
                measured('dynamics-held-v1', 'keep the mix wide and dynamic', MIX),
            ],
            [],
        ],
        [
            'keep the vocal bright but dynamic',
            [
                measured('brightness-held-v1', 'keep the vocal bright but dynamic', onTracks('vocal')),
                measured('dynamics-held-v1', 'keep the vocal bright but dynamic', onTracks('vocal')),
            ],
            [],
        ],
        [
            'keep the width and dynamics of the vocal',
            [
                measured('stereo-width-held-v1', 'keep the width and dynamics of the vocal', onTracks('vocal')),
                measured('dynamics-held-v1', 'keep the width and dynamics of the vocal', onTracks('vocal')),
            ],
            [],
        ],
        [
            'keep the level and the width of the vocal',
            [
                measured('loudness-held-v1', 'keep the level and the width of the vocal', onTracks('vocal')),
                measured('stereo-width-held-v1', 'keep the level and the width of the vocal', onTracks('vocal')),
            ],
            [],
        ],
        [
            'keep the loudness of the vocal and the drums',
            [measured('loudness-held-v1', 'keep the loudness of the vocal and the drums', onTracks('vocal', 'drums'))],
            [],
        ],
        [
            'keep the level of the vocal and drums the same',
            [
                measured(
                    'loudness-held-v1',
                    'keep the level of the vocal and drums the same',
                    onTracks('vocal', 'drums')
                ),
            ],
            [],
        ],
        [
            'keep the width and the dynamics',
            [
                measured('stereo-width-held-v1', 'keep the width and the dynamics', MIX),
                measured('dynamics-held-v1', 'keep the width and the dynamics', MIX),
            ],
            [],
        ],
        [
            'keep the level of the vocal and brighten the drums',
            [measured('loudness-held-v1', 'keep the level of the vocal', onTracks('vocal'))],
            [],
        ],
        [
            "don't make the vocal, the bass and the drums louder",
            [
                measured(
                    'loudness-not-raised-v1',
                    "don't make the vocal, the bass and the drums louder",
                    onTracks('vocal', 'bass', 'drums')
                ),
            ],
            [],
        ],
        // one negation over two directions bounds the object in both families
        [
            "don't make the vocal brighter and louder",
            [
                measured('brightness-not-raised-v1', "don't make the vocal brighter and louder", onTracks('vocal')),
                measured('loudness-not-raised-v1', "don't make the vocal brighter and louder", onTracks('vocal')),
            ],
            [],
        ],
        // a linking verb, an object before the noun, and every modal negation
        ["don't make it sound louder", [measured('loudness-not-raised-v1', "don't make it sound louder", MIX)], []],
        [
            "don't make the mix sound louder",
            [measured('loudness-not-raised-v1', "don't make the mix sound louder", MIX)],
            [],
        ],
        [
            "don't make the drums sound louder",
            [measured('loudness-not-raised-v1', "don't make the drums sound louder", onTracks('drums'))],
            [],
        ],
        [
            'keep the vocal level the same',
            [measured('loudness-held-v1', 'keep the vocal level the same', onTracks('vocal'))],
            [],
        ],
        ['keep the mix loudness the same', [measured('loudness-held-v1', 'keep the mix loudness the same', MIX)], []],
        [
            "don't change the drums volume",
            [measured('loudness-held-v1', "don't change the drums volume", onTracks('drums'))],
            [],
        ],
        ["the mix doesn't get louder", [measured('loudness-not-raised-v1', "the mix doesn't get louder", MIX)], []],
        // a pronoun means the mix only while nothing narrower is named before it
        ['keep it wide', [measured('stereo-width-held-v1', 'keep it wide', MIX)], []],
        [
            'brighten the drums but keep it at the same level',
            [],
            [
                unread(
                    'keep it at the same level',
                    '“it” names no single scope: the request names a track or role before it.'
                ),
            ],
        ],
        [
            "don't make the vocal louder but keep it wide",
            [measured('loudness-not-raised-v1', "don't make the vocal louder", onTracks('vocal'))],
            [unread('keep it wide', '“it” names no single scope: the request names a track or role before it.')],
        ],
        [
            'keep the level of the vocal the same and keep it bright',
            [measured('loudness-held-v1', 'keep the level of the vocal the same', onTracks('vocal'))],
            [unread('keep it bright', '“it” names no single scope: the request names a track or role before it.')],
        ],
        // a bound beside an unreadable or unrelated clause keeps to its own clause
        [
            "don't make the intro longer and don't make the mix louder",
            [measured('loudness-not-raised-v1', "don't make the mix louder", MIX)],
            [],
        ],
        [
            "don't make the vocal brighter and don't make the drums louder",
            [
                measured('brightness-not-raised-v1', "don't make the vocal brighter", onTracks('vocal')),
                measured('loudness-not-raised-v1', "don't make the drums louder", onTracks('drums')),
            ],
            [],
        ],
        [
            'without making the vocal harsher and without making the mix quieter',
            [measured('loudness-not-lowered-v1', 'without making the mix quieter', MIX)],
            [],
        ],
        [
            "don't make the vocal harsher don't make the mix quieter",
            [measured('loudness-not-lowered-v1', "don't make the mix quieter", MIX)],
            [],
        ],
        [
            "don't make the vocal harsher please the mix must not get louder",
            [measured('loudness-not-raised-v1', 'the mix must not get louder', MIX)],
            [],
        ],
        [
            'The vocal is louder and the drums must not get louder',
            [measured('loudness-not-raised-v1', 'the drums must not get louder', onTracks('drums'))],
            [],
        ],
        [
            'keep the vocal level and the drums width',
            [],
            [
                unread(
                    'keep the vocal level and the drums width',
                    '“keep the vocal level and the drums width” names more than one scope for one hold.'
                ),
            ],
        ],
        ["don't make the intro longer and make the vocal louder", [], []],
        // every negation spelling and linking verb
        ['never make it louder', [measured('loudness-not-raised-v1', 'never make it louder', MIX)], []],
        ['do not make it louder', [measured('loudness-not-raised-v1', 'do not make it louder', MIX)], []],
        ['the mix will not get louder', [measured('loudness-not-raised-v1', 'the mix will not get louder', MIX)], []],
        ["the mix won't get louder", [measured('loudness-not-raised-v1', "the mix won't get louder", MIX)], []],
        [
            'the mix should not get louder',
            [measured('loudness-not-raised-v1', 'the mix should not get louder', MIX)],
            [],
        ],
        ["the mix shouldn't get louder", [measured('loudness-not-raised-v1', "the mix shouldn't get louder", MIX)], []],
        ['the mix may not get louder', [measured('loudness-not-raised-v1', 'the mix may not get louder', MIX)], []],
        ["the mix can't get louder", [measured('loudness-not-raised-v1', "the mix can't get louder", MIX)], []],
        ['the mix cannot get louder', [measured('loudness-not-raised-v1', 'the mix cannot get louder', MIX)], []],
        ["don't make it feel louder", [measured('loudness-not-raised-v1', "don't make it feel louder", MIX)], []],
        ["don't make it seem louder", [measured('loudness-not-raised-v1', "don't make it seem louder", MIX)], []],
        [
            "don't let the mix become louder",
            [measured('loudness-not-raised-v1', "don't let the mix become louder", MIX)],
            [],
        ],
        ['the mix must not be louder', [measured('loudness-not-raised-v1', 'the mix must not be louder', MIX)], []],
        // a member word is never a negation or modal, and only a whole excluded word stops a member
        [
            'The vocal cannot clip and the drums must not get louder',
            [measured('loudness-not-raised-v1', 'the drums must not get louder', onTracks('drums'))],
            [],
        ],
        [
            'The bell must not get louder',
            [],
            [
                unread(
                    'The bell must not get louder',
                    '“The bell” names no track or mix whose loudness can be measured.'
                ),
            ],
        ],
        // a role word before a held noun, resolved through a track's role or through nothing
        [
            'keep the guitar level the same',
            [measured('loudness-held-v1', 'keep the guitar level the same', onTracks('gtr'))],
            [],
        ],
        [
            'keep the keys level the same',
            [],
            [unread('keep the keys level the same', '“keys” names no track or mix whose loudness can be measured.')],
        ],
        // every pronoun means the mix only while nothing narrower is named before it
        [
            'keep everything at the same level',
            [measured('loudness-held-v1', 'keep everything at the same level', MIX)],
            [],
        ],
        [
            'brighten the drums but keep everything at the same level',
            [],
            [
                unread(
                    'keep everything at the same level',
                    '“everything” names no single scope: the request names a track or role before it.'
                ),
            ],
        ],
        ["don't make anything louder", [measured('loudness-not-raised-v1', "don't make anything louder", MIX)], []],
        [
            "brighten the drums but don't make anything louder",
            [],
            [
                unread(
                    "don't make anything louder",
                    '“anything” names no single scope: the request names a track or role before it.'
                ),
            ],
        ],
        // further qualities joined to the first share its object
        [
            'keep the vocal bright, dynamic',
            [
                measured('brightness-held-v1', 'keep the vocal bright, dynamic', onTracks('vocal')),
                measured('dynamics-held-v1', 'keep the vocal bright, dynamic', onTracks('vocal')),
            ],
            [],
        ],
        [
            'keep the vocal as bright and as dynamic',
            [
                measured('brightness-held-v1', 'keep the vocal as bright and as dynamic', onTracks('vocal')),
                measured('dynamics-held-v1', 'keep the vocal as bright and as dynamic', onTracks('vocal')),
            ],
            [],
        ],
        [
            'keep the vocal bright and warm up the drums',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        // what states no measured hold
        ['make the drums louder', [], []],
        [
            "don't make the mix louder than the vocal",
            [],
            [unread("don't make the mix louder than the vocal", COMPARATIVE_REASON)],
        ],
        ['turn Louder Pad up', [], []],
        ['rename the vocal "don\'t make it louder"', [], []],
        ['keep it warm', [], [unread('keep it warm', 'No measurement the application takes shows that “warm” holds.')]],
        [
            'keep the vocal intimate',
            [
                {
                    constraintId: 'vocal-intimacy-v1',
                    clause: 'keep the vocal intimate',
                    scope: onTracks('vocal'),
                    protection: { kind: 'exclude-dimension', dimension: 'ambience' },
                },
            ],
            [],
        ],
    ] satisfies [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']][])(
        'reads "%s"',
        (prompt, constraints, unsupported) => {
            expect(compilePerceptualConstraints(prompt, grammarContext())).toEqual({ constraints, unsupported });
        }
    );

    it('reads no clause from a track named like one, though the same words outside a name are a bound', () => {
        const prompt = "Lift the trim but don't make it louder";
        expect(compilePerceptualConstraints(prompt, grammarContext()).constraints).toEqual([
            measured('loudness-not-raised-v1', "don't make it louder", MIX),
        ]);
        expect(compilePerceptualConstraints(prompt, grammarContext("Don't Make It Louder"))).toEqual({
            constraints: [],
            unsupported: [],
        });
    });

    it('reads no clause from a quality word inside a section name', () => {
        const context = {
            ...grammarContext(),
            sections: [{ id: 'section-louder', name: "Don't Make It Louder", startBeat: 0, endBeat: 16 }],
        };
        expect(compilePerceptualConstraints("Lift the trim but don't make it louder", context)).toEqual({
            constraints: [],
            unsupported: [],
        });
    });
});

type BoundRow = [
    prompt: string,
    constraintId: MeasuredPerceptualConstraint['constraintId'],
    metricId: HeldMetric,
    relation: 'no-increase' | 'no-decrease',
    heldId: MeasuredPerceptualConstraint['constraintId'],
    scope: PerceptualConstraintScope,
];

describe('reading one-way width, brightness and dynamics clauses as bounds', () => {
    it.each([
        [
            "don't make the mix any wider",
            'stereo-width-not-widened-v1',
            'sideEnergyFraction',
            'no-increase',
            'stereo-width-held-v1',
            MIX,
        ],
        [
            "don't widen the drums",
            'stereo-width-not-widened-v1',
            'sideEnergyFraction',
            'no-increase',
            'stereo-width-held-v1',
            onTracks('drums'),
        ],
        [
            "don't make the mix any narrower",
            'stereo-width-not-narrowed-v1',
            'sideEnergyFraction',
            'no-decrease',
            'stereo-width-held-v1',
            MIX,
        ],
        [
            'without narrowing the vocal',
            'stereo-width-not-narrowed-v1',
            'sideEnergyFraction',
            'no-decrease',
            'stereo-width-held-v1',
            onTracks('vocal'),
        ],
        [
            "don't make the vocal any brighter",
            'brightness-not-raised-v1',
            'spectralCentroid',
            'no-increase',
            'brightness-held-v1',
            onTracks('vocal'),
        ],
        [
            "don't brighten the drums",
            'brightness-not-raised-v1',
            'spectralCentroid',
            'no-increase',
            'brightness-held-v1',
            onTracks('drums'),
        ],
        [
            "don't make the vocal darker",
            'brightness-not-lowered-v1',
            'spectralCentroid',
            'no-decrease',
            'brightness-held-v1',
            onTracks('vocal'),
        ],
        [
            'the mix must not get any duller',
            'brightness-not-lowered-v1',
            'spectralCentroid',
            'no-decrease',
            'brightness-held-v1',
            MIX,
        ],
        [
            "don't make the drums more dynamic",
            'dynamics-not-raised-v1',
            'crestFactor',
            'no-increase',
            'dynamics-held-v1',
            onTracks('drums'),
        ],
        [
            'the vocal must not get more dynamic',
            'dynamics-not-raised-v1',
            'crestFactor',
            'no-increase',
            'dynamics-held-v1',
            onTracks('vocal'),
        ],
        [
            "don't make the drums less dynamic",
            'dynamics-not-reduced-v1',
            'crestFactor',
            'no-decrease',
            'dynamics-held-v1',
            onTracks('drums'),
        ],
        [
            "don't squash the drums",
            'dynamics-not-reduced-v1',
            'crestFactor',
            'no-decrease',
            'dynamics-held-v1',
            onTracks('drums'),
        ],
        [
            "don't make the mix any flatter",
            'dynamics-not-reduced-v1',
            'crestFactor',
            'no-decrease',
            'dynamics-held-v1',
            MIX,
        ],
    ] satisfies BoundRow[])(
        'reads "%s" as %s on %s, %s, at the tolerance %s holds',
        (prompt, constraintId, metricId, relation, heldId, scope) => {
            expect(compilePerceptualConstraints(prompt, grammarContext())).toEqual({
                constraints: [measured(constraintId, prompt, scope)],
                unsupported: [],
            });
            const [held] = PERCEPTUAL_CONSTRAINT_INVARIANTS[heldId];
            expect(held?.metricId).toBe(metricId);
            expect(PERCEPTUAL_CONSTRAINT_INVARIANTS[constraintId]).toEqual([
                { metricId, band: null, relation, tolerance: held?.tolerance },
            ]);
        }
    );

    it.each([
        // a comparison has no single scope a bound could hold
        [
            "don't make it louder than the vocal",
            [],
            [unread("don't make it louder than the vocal", COMPARATIVE_REASON)],
        ],
        [
            'keep the drums quieter than the vocal',
            [],
            [unread('keep the drums quieter than the vocal', COMPARATIVE_REASON)],
        ],
        // a two-way clause in any family is a hold
        [
            "don't make the mix wider or narrower",
            [measured('stereo-width-held-v1', "don't make the mix wider or narrower", MIX)],
            [],
        ],
        // possessive and shared-noun loudness
        [
            "keep the drums' level the same",
            [measured('loudness-held-v1', "keep the drums' level the same", onTracks('drums'))],
            [],
        ],
        [
            'keep the vocal and drums level the same',
            [measured('loudness-held-v1', 'keep the vocal and drums level the same', onTracks('vocal', 'drums'))],
            [],
        ],
        // the objects before a noun join as nouns do, by a comma too
        [
            'keep the vocal, drums level the same',
            [measured('loudness-held-v1', 'keep the vocal, drums level the same', onTracks('vocal', 'drums'))],
            [],
        ],
        // "keep … from getting"
        [
            'keep the mix from getting louder',
            [measured('loudness-not-raised-v1', 'keep the mix from getting louder', MIX)],
            [],
        ],
        // an amount or a target no fixed tolerance states
        [
            "don't raise the volume of the vocal by more than 3 dB",
            [],
            [unread("don't raise the volume of the vocal by more than 3 dB", NET_REASON)],
        ],
        [
            "don't lower the level of the vocal to match the drums",
            [],
            [unread("don't lower the level of the vocal to match the drums", NET_REASON)],
        ],
        // "or" joining an object list
        [
            "don't raise the level of the vocal or the drums",
            [
                measured(
                    'loudness-not-raised-v1',
                    "don't raise the level of the vocal or the drums",
                    onTracks('vocal', 'drums')
                ),
            ],
            [],
        ],
        // a split verb particle
        [
            "don't turn the level of the vocal up",
            [measured('loudness-not-raised-v1', "don't turn the level of the vocal up", onTracks('vocal'))],
            [],
        ],
        // two nouns, each with its own object
        [
            'keep the level of the vocal and the width of the drums',
            [
                measured(
                    'loudness-held-v1',
                    'keep the level of the vocal and the width of the drums',
                    onTracks('vocal')
                ),
                measured(
                    'stereo-width-held-v1',
                    'keep the level of the vocal and the width of the drums',
                    onTracks('drums')
                ),
            ],
            [],
        ],
        // a continued noun takes the verb of the clause it continues
        [
            "don't raise the level of the vocal and the volume of the drums",
            [
                measured(
                    'loudness-not-raised-v1',
                    "don't raise the level of the vocal and the volume of the drums",
                    onTracks('vocal')
                ),
                measured(
                    'loudness-not-raised-v1',
                    "don't raise the level of the vocal and the volume of the drums",
                    onTracks('drums')
                ),
            ],
            [],
        ],
        [
            "don't lower the level of the vocal and the dynamics of the drums",
            [
                measured(
                    'loudness-not-lowered-v1',
                    "don't lower the level of the vocal and the dynamics of the drums",
                    onTracks('vocal')
                ),
                measured(
                    'dynamics-not-reduced-v1',
                    "don't lower the level of the vocal and the dynamics of the drums",
                    onTracks('drums')
                ),
            ],
            [],
        ],
        [
            "don't raise the level of the vocal and the width of the drums",
            [
                measured(
                    'loudness-not-raised-v1',
                    "don't raise the level of the vocal and the width of the drums",
                    onTracks('vocal')
                ),
                measured(
                    'stereo-width-not-widened-v1',
                    "don't raise the level of the vocal and the width of the drums",
                    onTracks('drums')
                ),
            ],
            [],
        ],
        [
            "don't change the level of the vocal and the width of the drums",
            [
                measured(
                    'loudness-held-v1',
                    "don't change the level of the vocal and the width of the drums",
                    onTracks('vocal')
                ),
                measured(
                    'stereo-width-held-v1',
                    "don't change the level of the vocal and the width of the drums",
                    onTracks('drums')
                ),
            ],
            [],
        ],
        // a second quality under the first one's keep
        [
            'keep the vocal warm and the drums bright',
            [measured('brightness-held-v1', 'keep the vocal warm and the drums bright', onTracks('drums'))],
            [
                unread(
                    'keep the vocal warm and the drums bright',
                    'No measurement the application takes shows that “warm” holds.'
                ),
            ],
        ],
        // an "and" continuation shares the clause's negation
        [
            "don't make the mix louder and the vocal quieter",
            [
                measured('loudness-not-raised-v1', "don't make the mix louder and the vocal quieter", MIX),
                measured(
                    'loudness-not-lowered-v1',
                    "don't make the mix louder and the vocal quieter",
                    onTracks('vocal')
                ),
            ],
            [],
        ],
        // a comma before the "and" joins the later object as every list joins its members
        [
            "don't make the mix louder, and the vocal quieter",
            [
                measured('loudness-not-raised-v1', "don't make the mix louder, and the vocal quieter", MIX),
                measured(
                    'loudness-not-lowered-v1',
                    "don't make the mix louder, and the vocal quieter",
                    onTracks('vocal')
                ),
            ],
            [],
        ],
        // a spaced ampersand joins a later object as "and" does
        [
            "don't make the mix wider & the vocal brighter",
            [
                measured('stereo-width-not-widened-v1', "don't make the mix wider & the vocal brighter", MIX),
                measured(
                    'brightness-not-raised-v1',
                    "don't make the mix wider & the vocal brighter",
                    onTracks('vocal')
                ),
            ],
            [],
        ],
        [
            "don't make the vocal & the drums brighter",
            [
                measured(
                    'brightness-not-raised-v1',
                    "don't make the vocal & the drums brighter",
                    onTracks('vocal', 'drums')
                ),
            ],
            [],
        ],
        [
            'keep the level of the vocal & the drums',
            [measured('loudness-held-v1', 'keep the level of the vocal & the drums', onTracks('vocal', 'drums'))],
            [],
        ],
        ["don't make it louder & add reverb", [measured('loudness-not-raised-v1', "don't make it louder", MIX)], []],
        // "or" joins a later object under the negation as "and" does, after a comma or alone
        [
            "don't make the mix wider, or the vocal brighter",
            [
                measured('stereo-width-not-widened-v1', "don't make the mix wider, or the vocal brighter", MIX),
                measured(
                    'brightness-not-raised-v1',
                    "don't make the mix wider, or the vocal brighter",
                    onTracks('vocal')
                ),
            ],
            [],
        ],
        [
            "don't make the mix wider or the vocal brighter",
            [
                measured('stereo-width-not-widened-v1', "don't make the mix wider or the vocal brighter", MIX),
                measured(
                    'brightness-not-raised-v1',
                    "don't make the mix wider or the vocal brighter",
                    onTracks('vocal')
                ),
            ],
            [],
        ],
        // every member of a longer list joins the same way, whichever joiner its comma carries
        [
            "don't make the vocal brighter, the drums brighter, or the mix wider",
            [
                measured(
                    'brightness-not-raised-v1',
                    "don't make the vocal brighter, the drums brighter, or the mix wider",
                    onTracks('vocal')
                ),
                measured(
                    'brightness-not-raised-v1',
                    "don't make the vocal brighter, the drums brighter, or the mix wider",
                    onTracks('drums')
                ),
                measured(
                    'stereo-width-not-widened-v1',
                    "don't make the vocal brighter, the drums brighter, or the mix wider",
                    MIX
                ),
            ],
            [],
        ],
        [
            "don't make the vocal brighter, the drums brighter or the mix wider",
            [
                measured(
                    'brightness-not-raised-v1',
                    "don't make the vocal brighter, the drums brighter or the mix wider",
                    onTracks('vocal')
                ),
                measured(
                    'brightness-not-raised-v1',
                    "don't make the vocal brighter, the drums brighter or the mix wider",
                    onTracks('drums')
                ),
                measured(
                    'stereo-width-not-widened-v1',
                    "don't make the vocal brighter, the drums brighter or the mix wider",
                    MIX
                ),
            ],
            [],
        ],
        [
            "don't make the mix wider, the vocal brighter, and the drums darker",
            [
                measured(
                    'stereo-width-not-widened-v1',
                    "don't make the mix wider, the vocal brighter, and the drums darker",
                    MIX
                ),
                measured(
                    'brightness-not-raised-v1',
                    "don't make the mix wider, the vocal brighter, and the drums darker",
                    onTracks('vocal')
                ),
                measured(
                    'brightness-not-lowered-v1',
                    "don't make the mix wider, the vocal brighter, and the drums darker",
                    onTracks('drums')
                ),
            ],
            [],
        ],
        [
            "don't make the vocal louder and quieter",
            [measured('loudness-held-v1', "don't make the vocal louder and quieter", onTracks('vocal'))],
            [],
        ],
        // what states no new constraint: a name, a quotation, an instruction and the low end
        ['pan the Wider Pad left', [], []],
        ['add reverb to Not Brighter', [], []],
        ['rename the bus to "don\'t make it wider"', [], []],
        ['make the vocal brighter', [], []],
        ['widen the drums', [], []],
        [
            "don't touch the low end",
            [
                {
                    constraintId: 'low-end-untouched-v1',
                    clause: "don't touch the low end",
                    scope: MIX,
                    protection: { kind: 'exclude-dimension', dimension: 'low-frequency-band' },
                },
            ],
            [],
        ],
    ] satisfies [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']][])(
        'reads "%s"',
        (prompt, constraints, unsupported) => {
            expect(compilePerceptualConstraints(prompt, grammarContext('Wider Pad', 'Not Brighter'))).toEqual({
                constraints,
                unsupported,
            });
        }
    );

    it('reads "vox" as the vocal role word', () => {
        const context = grammarContext();
        const template = context.tracks.find((track) => track.id === 'gtr');
        if (template === undefined) {
            throw new Error('The grammar fixture holds the guitar.');
        }
        const withLead = {
            ...context,
            tracks: [
                ...context.tracks,
                {
                    ...template,
                    id: 'lead',
                    name: 'Lead 1',
                    canonicalRole: { role: 'lead vocal', source: 'authored', evidence: 'authored-role' },
                },
            ],
        } satisfies ProjectContext;
        const prompt = "don't make the vox any brighter";
        // the fixture's named copies of the Vocal keep its lead vocal role, so the role holds them too
        expect(compilePerceptualConstraints(prompt, withLead)).toEqual({
            constraints: [
                measured('brightness-not-raised-v1', prompt, onTracks('vocal', 'drums', 'louder-pad', 'lead')),
            ],
            unsupported: [],
        });
    });
});

describe('reading a subject before "never", graded comparatives and a comma before a joiner', () => {
    it.each([
        // a subject before "never" is the clause's scope, never the mix
        [
            'the drums should never get wider',
            [measured('stereo-width-not-widened-v1', 'the drums should never get wider', onTracks('drums'))],
            [],
        ],
        [
            'the vocal should never get louder',
            [measured('loudness-not-raised-v1', 'the vocal should never get louder', onTracks('vocal'))],
            [],
        ],
        [
            'the drums never get wider',
            [measured('stereo-width-not-widened-v1', 'the drums never get wider', onTracks('drums'))],
            [],
        ],
        // a subject no reader can measure is unsupported, never held on the mix
        [
            'the cello should never get wider',
            [],
            [
                unread(
                    'the cello should never get wider',
                    '“the cello” names no track or mix whose stereo width can be measured.'
                ),
            ],
        ],
        ['Cello should never get wider', [], [unread('Cello should never get wider', NET_REASON)]],
        ['the drums should never widen', [], [unread('the drums should never widen', NET_REASON)]],
        // a subject's "never" before a describing verb describes the sound as it is and states no bound
        ['the vocal never sounds louder, make it louder', [], []],
        ['it never feels wider, make it wider', [], []],
        // with no subject, or "it", "never" still holds the mix
        ['never get wider', [measured('stereo-width-not-widened-v1', 'never get wider', MIX)], []],
        ['it should never get louder', [measured('loudness-not-raised-v1', 'it should never get louder', MIX)], []],
        // "less" and "more" grade a plain adjective in its family's direction, as "less dynamic" does
        [
            "don't make the drums less bright",
            [measured('brightness-not-lowered-v1', "don't make the drums less bright", onTracks('drums'))],
            [],
        ],
        [
            "don't make the mix more wide",
            [measured('stereo-width-not-widened-v1', "don't make the mix more wide", MIX)],
            [],
        ],
        ["don't make it less loud", [measured('loudness-not-lowered-v1', "don't make it less loud", MIX)], []],
        // other verbs a level is reached or wanted through
        ["don't go louder", [measured('loudness-not-raised-v1', "don't go louder", MIX)], []],
        ["I don't want it louder", [measured('loudness-not-raised-v1', "don't want it louder", MIX)], []],
        [
            "I don't want the drums louder",
            [measured('loudness-not-raised-v1', "don't want the drums louder", onTracks('drums'))],
            [],
        ],
        [
            "I don't want the drums to get louder",
            [measured('loudness-not-raised-v1', "don't want the drums to get louder", onTracks('drums'))],
            [],
        ],
        // a wanted level no reader reads is still a protection the net records
        [
            "I don't want the drums louder in the chorus",
            [],
            [unread("I don't want the drums louder in the chorus", NET_REASON)],
        ],
        // "too" and "much" name no threshold a fixed tolerance states, so they are unsupported, never dropped
        ["don't make it too loud", [], [unread("don't make it too loud", NET_REASON)]],
        ["the mix shouldn't be much louder", [], [unread("the mix shouldn't be much louder", NET_REASON)]],
        [
            'keep the vocal from getting too bright',
            [],
            [unread('keep the vocal from getting too bright', unmeasured('bright'))],
        ],
        // a "too" no protection governs states nothing
        [
            'keep the vocal bright, but not too bright',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        ['make the vocal louder but not too loud', [], []],
        // a request to move states no bound in any form
        ['make the mix louder', [], []],
        ['make the mix less loud', [], []],
        [
            'keep the drums from getting wider',
            [measured('stereo-width-not-widened-v1', 'keep the drums from getting wider', onTracks('drums'))],
            [],
        ],
        // a comma before "and" continues the protection as the bare "and" does
        [
            "don't make the drums wider, and the mix quieter",
            [
                measured(
                    'stereo-width-not-widened-v1',
                    "don't make the drums wider, and the mix quieter",
                    onTracks('drums')
                ),
                measured('loudness-not-lowered-v1', "don't make the drums wider, and the mix quieter", MIX),
            ],
            [],
        ],
        [
            "don't make the drums wider, and the mix louder in the chorus",
            [measured('stereo-width-not-widened-v1', "don't make the drums wider", onTracks('drums'))],
            [unread("don't make the drums wider, and the mix louder in the chorus", NET_REASON)],
        ],
        [
            "don't make the drums wider and the mix louder in the chorus",
            [measured('stereo-width-not-widened-v1', "don't make the drums wider", onTracks('drums'))],
            [unread("don't make the drums wider and the mix louder in the chorus", NET_REASON)],
        ],
        [
            "don't raise the level of the drums, and the mix much louder",
            [measured('loudness-not-raised-v1', "don't raise the level of the drums", onTracks('drums'))],
            [unread("don't raise the level of the drums, and the mix much louder", NET_REASON)],
        ],
    ] satisfies [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']][])(
        'reads "%s"',
        (prompt, constraints, unsupported) => {
            expect(compilePerceptualConstraints(prompt, grammarContext())).toEqual({ constraints, unsupported });
        }
    );
});

const IT_AFTER_A_TRACK = '“it” names no single scope: the request names a track or role before it.';

describe('reading wishes, level verbs, subject-led "without", stressed negations and other joiners', () => {
    it.each([
        // a refused wish bounds what it wishes for, through an object, "to", "you" or a causing verb
        [
            "I don't want the mix any wider",
            [measured('stereo-width-not-widened-v1', "don't want the mix any wider", MIX)],
            [],
        ],
        ["I don't want it to get louder", [measured('loudness-not-raised-v1', "don't want it to get louder", MIX)], []],
        [
            "I don't want to make the drums wider",
            [measured('stereo-width-not-widened-v1', "don't want to make the drums wider", onTracks('drums'))],
            [],
        ],
        [
            "I don't want the vocal to go louder",
            [measured('loudness-not-raised-v1', "don't want the vocal to go louder", onTracks('vocal'))],
            [],
        ],
        ["I don't wanna make it louder", [measured('loudness-not-raised-v1', "don't wanna make it louder", MIX)], []],
        [
            "I wouldn't want the drums to get louder",
            [measured('loudness-not-raised-v1', "wouldn't want the drums to get louder", onTracks('drums'))],
            [],
        ],
        [
            "I wouldn't want the drums louder",
            [measured('loudness-not-raised-v1', "wouldn't want the drums louder", onTracks('drums'))],
            [],
        ],
        [
            "I don't want you to make the drums wider",
            [measured('stereo-width-not-widened-v1', "don't want you to make the drums wider", onTracks('drums'))],
            [],
        ],
        [
            "I don't want the drums to ever get louder",
            [measured('loudness-not-raised-v1', "don't want the drums to ever get louder", onTracks('drums'))],
            [],
        ],
        [
            "I don't really want the drums to get louder",
            [measured('loudness-not-raised-v1', "don't really want the drums to get louder", onTracks('drums'))],
            [],
        ],
        // a wish whose tail no reader reads is recorded unsupported, never dropped at its "to"
        [
            "I don't want the drums to get louder in the chorus",
            [],
            [unread("I don't want the drums to get louder in the chorus", NET_REASON)],
        ],
        ["I don't want the drums to get too loud", [], [unread("I don't want the drums to get too loud", NET_REASON)]],
        [
            "I don't want the drums to get much louder",
            [],
            [unread("I don't want the drums to get much louder", NET_REASON)],
        ],
        [
            "I don't want the drums to get louder than the vocal",
            [],
            [unread("I don't want the drums to get louder than the vocal", COMPARATIVE_REASON)],
        ],
        // a wish for a keep or a stop is a permission and states nothing
        ["I don't want to keep the mix from getting wider", [], []],
        // a level verb with an object and no level noun bounds the object's loudness
        [
            "don't turn the vocal up",
            [measured('loudness-not-raised-v1', "don't turn the vocal up", onTracks('vocal'))],
            [],
        ],
        [
            "don't turn up the vocal",
            [measured('loudness-not-raised-v1', "don't turn up the vocal", onTracks('vocal'))],
            [],
        ],
        ["don't turn it down", [measured('loudness-not-lowered-v1', "don't turn it down", MIX)], []],
        ["don't raise the vocal", [measured('loudness-not-raised-v1', "don't raise the vocal", onTracks('vocal'))], []],
        ["don't boost the bass", [measured('loudness-not-raised-v1', "don't boost the bass", onTracks('bass'))], []],
        ['make the vocal brighter without turning it up', [], [unread('without turning it up', IT_AFTER_A_TRACK)]],
        ["don't turn the vocal up in the chorus", [], [unread("don't turn the vocal up in the chorus", NET_REASON)]],
        [
            "don't lower the reverb",
            [],
            [unread("don't lower the reverb", '“the reverb” names no track or mix whose loudness can be measured.')],
        ],
        // "kill" and "crush" lower a held noun, and "crush" the dynamics of an object
        ["don't kill the dynamics", [measured('dynamics-not-reduced-v1', "don't kill the dynamics", MIX)], []],
        ["don't crush the dynamics", [measured('dynamics-not-reduced-v1', "don't crush the dynamics", MIX)], []],
        ["don't kill the vocal", [], []],
        // "more" and "less" grade every plain adjective its own way
        ["don't make it less quiet", [measured('loudness-not-raised-v1', "don't make it less quiet", MIX)], []],
        ["don't make it more quiet", [measured('loudness-not-lowered-v1', "don't make it more quiet", MIX)], []],
        ["don't make it more soft", [measured('loudness-not-lowered-v1', "don't make it more soft", MIX)], []],
        ["don't make it more dark", [measured('brightness-not-lowered-v1', "don't make it more dark", MIX)], []],
        ["don't make it less dull", [measured('brightness-not-raised-v1', "don't make it less dull", MIX)], []],
        [
            "don't make the vocal less bright",
            [measured('brightness-not-lowered-v1', "don't make the vocal less bright", onTracks('vocal'))],
            [],
        ],
        [
            "don't make it any less wide",
            [measured('stereo-width-not-narrowed-v1', "don't make it any less wide", MIX)],
            [],
        ],
        // "without" may name the subject of the move it rules out
        [
            'make the vocal brighter without the mix getting louder',
            [measured('loudness-not-raised-v1', 'without the mix getting louder', MIX)],
            [],
        ],
        [
            'make the vocal brighter without it getting quieter',
            [],
            [unread('without it getting quieter', IT_AFTER_A_TRACK)],
        ],
        [
            'make the vocal brighter without anything getting louder',
            [],
            [
                unread(
                    'without anything getting louder',
                    '“anything” names no single scope: the request names a track or role before it.'
                ),
            ],
        ],
        [
            'make the vocal brighter without the mix getting louder in the chorus',
            [],
            [unread('make the vocal brighter without the mix getting louder in the chorus', NET_REASON)],
        ],
        // a bare "not" refuses a direction; after a copula it describes the sound
        ['brighten the vocal, just not any louder', [], [unread('just not any louder', NET_REASON)]],
        ['brighten the vocal, but not louder', [], [unread('not louder', NET_REASON)]],
        ['the vocal is not louder, make it louder', [], []],
        // after "make sure" a copula or "doesn't" negation is a request
        [
            "make sure the vocal isn't any louder",
            [measured('loudness-not-raised-v1', "make sure the vocal isn't any louder", onTracks('vocal'))],
            [],
        ],
        [
            "make sure it doesn't get louder",
            [measured('loudness-not-raised-v1', "make sure it doesn't get louder", MIX)],
            [],
        ],
        [
            "make sure the vocal isn't louder in the chorus",
            [],
            [unread("make sure the vocal isn't louder in the chorus", NET_REASON)],
        ],
        // a list may end on a comparative naming no measured quality
        [
            'make the vocal brighter without making the mix louder or harsher',
            [measured('loudness-not-raised-v1', 'without making the mix louder', MIX)],
            [],
        ],
        [
            'make the vocal brighter without making it louder or harsher',
            [],
            [unread('without making it louder', IT_AFTER_A_TRACK)],
        ],
        // a "will" negation before a making verb predicts an effect and states nothing
        ["this won't make it louder", [], []],
        ["this won't make the drums wider", [], []],
        ["this EQ won't make it louder", [], []],
        // addressed to the agent, or hoped or promised, what won't be made is a protection the net records
        ["You won't make it louder, ok?", [], [unread("You won't make it louder", NET_REASON)]],
        ["I hope you won't make it louder", [], [unread("I hope you won't make it louder", NET_REASON)]],
        ["Promise you won't make it louder", [], [unread("Promise you won't make it louder", NET_REASON)]],
        ["You won't make the drums wider, will you?", [], [unread("You won't make the drums wider", NET_REASON)]],
        ['You will not make the drums wider', [], [unread('You will not make the drums wider', NET_REASON)]],
        ["I hope this won't make it louder", [], [unread("I hope this won't make it louder", NET_REASON)]],
        // a wish refused through "would not" whose tail no reader reads is recorded unsupported
        [
            "I wouldn't want the drums louder in the chorus",
            [],
            [unread("I wouldn't want the drums louder in the chorus", NET_REASON)],
        ],
        // a stressing adverb beside a modal's or a subject's "never" keeps the subject's scope
        [
            'the drums should really never get wider',
            [measured('stereo-width-not-widened-v1', 'the drums should really never get wider', onTracks('drums'))],
            [],
        ],
        [
            'the drums should absolutely never get wider',
            [measured('stereo-width-not-widened-v1', 'the drums should absolutely never get wider', onTracks('drums'))],
            [],
        ],
        [
            'the drums should also never get wider',
            [measured('stereo-width-not-widened-v1', 'the drums should also never get wider', onTracks('drums'))],
            [],
        ],
        [
            'the drums should never really get wider',
            [measured('stereo-width-not-widened-v1', 'the drums should never really get wider', onTracks('drums'))],
            [],
        ],
        [
            'the drums should never ever get wider',
            [measured('stereo-width-not-widened-v1', 'the drums should never ever get wider', onTracks('drums'))],
            [],
        ],
        [
            'the drums should never really get wider in the chorus',
            [],
            [unread('the drums should never really get wider in the chorus', NET_REASON)],
        ],
        // a degree no fixed tolerance states is unsupported, never dropped
        ["the bass shouldn't be too much louder", [], [unread("the bass shouldn't be too much louder", NET_REASON)]],
        ["the bass shouldn't be a lot louder", [], [unread("the bass shouldn't be a lot louder", NET_REASON)]],
        ["the bass shouldn't be far louder", [], [unread("the bass shouldn't be far louder", NET_REASON)]],
        ["the bass shouldn't be overly loud", [], [unread("the bass shouldn't be overly loud", NET_REASON)]],
        ["the bass shouldn't be very loud", [], [unread("the bass shouldn't be very loud", NET_REASON)]],
        // a subject's "never" with a tail is unsupported, as its "should never" form is
        [
            'the vocal never gets louder in the verse',
            [],
            [unread('the vocal never gets louder in the verse', NET_REASON)],
        ],
        [
            'the vocal should never get louder in the verse',
            [],
            [unread('the vocal should never get louder in the verse', NET_REASON)],
        ],
        // "nor", "plus" and "as well as" join a second protection as "or" and "and" do
        [
            "don't make the drums wider nor the vocal brighter",
            [
                measured(
                    'stereo-width-not-widened-v1',
                    "don't make the drums wider nor the vocal brighter",
                    onTracks('drums')
                ),
                measured(
                    'brightness-not-raised-v1',
                    "don't make the drums wider nor the vocal brighter",
                    onTracks('vocal')
                ),
            ],
            [],
        ],
        [
            "don't make the drums wider nor louder",
            [
                measured('stereo-width-not-widened-v1', "don't make the drums wider nor louder", onTracks('drums')),
                measured('loudness-not-raised-v1', "don't make the drums wider nor louder", onTracks('drums')),
            ],
            [],
        ],
        [
            "don't make the drums wider plus the vocal brighter",
            [
                measured(
                    'stereo-width-not-widened-v1',
                    "don't make the drums wider plus the vocal brighter",
                    onTracks('drums')
                ),
                measured(
                    'brightness-not-raised-v1',
                    "don't make the drums wider plus the vocal brighter",
                    onTracks('vocal')
                ),
            ],
            [],
        ],
        [
            "don't make the drums wider as well as the vocal brighter",
            [
                measured(
                    'stereo-width-not-widened-v1',
                    "don't make the drums wider as well as the vocal brighter",
                    onTracks('drums')
                ),
                measured(
                    'brightness-not-raised-v1',
                    "don't make the drums wider as well as the vocal brighter",
                    onTracks('vocal')
                ),
            ],
            [],
        ],
        // a verbless part after a semicolon may continue the protection, so it is unsupported, never dropped
        [
            "don't make the drums wider; the vocal brighter",
            [measured('stereo-width-not-widened-v1', "don't make the drums wider", onTracks('drums'))],
            [unread("don't make the drums wider; the vocal brighter", NET_REASON)],
        ],
        // requests, descriptions and moves stay unread
        ['make it louder', [], []],
        ['I want it louder', [], []],
        ['make it go wider', [], []],
        ['never mind, brighten it', [], []],
        ['the vocal never sounds louder, make it louder', [], []],
        ['it never sounds loud enough, make it louder', [], []],
        ["the vocal doesn't get louder in the chorus, raise it", [], []],
        [
            'keep the vocal bright, but not too bright',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            "don't make the drums wider, and make the vocal louder",
            [measured('stereo-width-not-widened-v1', "don't make the drums wider", onTracks('drums'))],
            [],
        ],
    ] satisfies [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']][])(
        'reads "%s"',
        (prompt, constraints, unsupported) => {
            expect(compilePerceptualConstraints(prompt, grammarContext())).toEqual({ constraints, unsupported });
        }
    );
});

describe('reading only governed protections and whole object names', () => {
    it.each([
        // a negated stop, prevent or keep … from permits the move, so it states no bound
        ["don't stop the mix from getting wider", [], []],
        ["don't prevent the vocal from getting brighter", [], []],
        // a keep that continues a move, and a negated stop or prevent that permits one, protect nothing
        ['keep widening the mix', [], []],
        ['keep raising the level of the vocal', [], []],
        ['keep making the drums wider', [], []],
        ["don't stop widening the mix", [], []],
        ["don't stop the mix getting wider", [], []],
        ["don't prevent the vocal getting brighter", [], []],
        // a plain noun no qualifier makes a measured one opens nothing: "field" is not the stereo field
        ['keep the field recording', [], []],
        // a protective stop, prevent or keep still holds, binds or is recorded
        ['stop the vocal getting louder', [], [unread('stop the vocal getting louder', NET_REASON)]],
        ['prevent the mix widening', [], [unread('prevent the mix widening', NET_REASON)]],
        [
            'keep the mix from getting wider',
            [measured('stereo-width-not-widened-v1', 'keep the mix from getting wider', MIX)],
            [],
        ],
        // a keep, stop or prevent naming a quality no measurement shows as the move it prevents is
        // recorded unsupported, while one naming a measured direction still bounds it
        ['keep the bass from getting muddy', [], [unread('keep the bass from getting muddy', unmeasured('muddy'))]],
        ['keep it from losing the punch', [], [unread('keep it from losing the punch', unmeasured('punch'))]],
        ['keep the vocal from sounding thin', [], [unread('keep the vocal from sounding thin', unmeasured('thin'))]],
        [
            'make the vocal warmer but keep it from losing the lo-fi sound',
            [],
            [unread('keep it from losing the lo-fi', unmeasured('lo-fi'))],
        ],
        // whatever words of its clause name the object: a pronoun, a plural or a quantifier
        ['keep them from losing the punch', [], [unread('keep them from losing the punch', unmeasured('punch'))]],
        [
            'compress the drums to keep them from sounding thin',
            [],
            [unread('keep them from sounding thin', unmeasured('thin'))],
        ],
        [
            'keep every track from sounding thin',
            [],
            [unread('keep every track from sounding thin', unmeasured('thin'))],
        ],
        ['keep both from sounding thin', [], [unread('keep both from sounding thin', unmeasured('thin'))]],
        ['keep it all from sounding thin', [], [unread('keep it all from sounding thin', unmeasured('thin'))]],
        ['keep all of it from sounding thin', [], [unread('keep all of it from sounding thin', unmeasured('thin'))]],
        // one clause yields one entry: a wider clause the net records past a prevented quality quotes it
        // whole, and stands alone
        [
            'stop the drums from losing the punch with a brighter vocal',
            [],
            [unread('stop the drums from losing the punch with a brighter vocal', NET_REASON)],
        ],
        [
            'keep the vocal from sounding thin with its level the same',
            [],
            [unread('keep the vocal from sounding thin with its level the same', NET_REASON)],
        ],
        [
            'stop the bass from getting muddy or louder',
            [],
            [unread('stop the bass from getting muddy or louder', NET_REASON)],
        ],
        // the same words read standalone elsewhere keep their own entry
        [
            'stop the drums from losing the punch. stop the drums from losing the punch with a brighter vocal',
            [],
            [
                unread('stop the drums from losing the punch', unmeasured('punch')),
                unread('stop the drums from losing the punch with a brighter vocal', NET_REASON),
            ],
        ],
        // one clause yields one entry: an em dash ends it, spaced or not, as a comma does
        [
            'stop the drums from losing the punch—make the vocal brighter',
            [],
            [unread('stop the drums from losing the punch', unmeasured('punch'))],
        ],
        [
            'stop the drums from losing the punch — make the vocal brighter',
            [],
            [unread('stop the drums from losing the punch', unmeasured('punch'))],
        ],
        [
            'stop the drums from losing the punch, make the vocal brighter',
            [],
            [unread('stop the drums from losing the punch', unmeasured('punch'))],
        ],
        // a comma list of directions bounds every direction it lists, a plain request none
        [
            'keep the mix from getting brighter, wider, or louder',
            [
                measured('brightness-not-raised-v1', 'keep the mix from getting brighter, wider, or louder', MIX),
                measured('stereo-width-not-widened-v1', 'keep the mix from getting brighter, wider, or louder', MIX),
                measured('loudness-not-raised-v1', 'keep the mix from getting brighter, wider, or louder', MIX),
            ],
            [],
        ],
        [
            'keep it from getting wider, brighter',
            [
                measured('stereo-width-not-widened-v1', 'keep it from getting wider, brighter', MIX),
                measured('brightness-not-raised-v1', 'keep it from getting wider, brighter', MIX),
            ],
            [],
        ],
        [
            "don't make it brighter, wider or louder",
            [
                measured('brightness-not-raised-v1', "don't make it brighter, wider or louder", MIX),
                measured('stereo-width-not-widened-v1', "don't make it brighter, wider or louder", MIX),
                measured('loudness-not-raised-v1', "don't make it brighter, wider or louder", MIX),
            ],
            [],
        ],
        ['make it brighter, wider and louder', [], []],
        // a dash with "or" after it continues the list as a comma does, spaced or not, em or en
        ...[
            'keep it from getting louder—or brighter',
            'keep it from getting louder — or brighter',
            'keep it from getting louder – or brighter',
            "don't make it louder—or brighter",
        ].map(
            (
                prompt
            ): [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']] => [
                prompt,
                [measured('loudness-not-raised-v1', prompt, MIX), measured('brightness-not-raised-v1', prompt, MIX)],
                [],
            ]
        ),
        // a bracket opens an aside: the protection before it reads as before the same clause unbracketed
        ...[
            'keep the vocal bright (and make the drums louder)',
            'keep the vocal bright [and make the drums louder]',
            'keep the vocal bright (and make the drums louder',
            'keep the vocal bright (also make the drums louder)',
        ].map(
            (
                prompt
            ): [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']] => [
                prompt,
                [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
                [],
            ]
        ),
        [
            'keep the mix wide (and make the drums louder)',
            [measured('stereo-width-held-v1', 'keep the mix wide', MIX)],
            [],
        ],
        [
            'keep the drums punchy (and make the drums louder)',
            [],
            [unread('keep the drums punchy', unmeasured('punchy'))],
        ],
        // an opening bracket with "or" after it continues the list as a separator does
        [
            'keep the mix from getting louder (or brighter)',
            [
                measured('loudness-not-raised-v1', 'keep the mix from getting louder (or brighter', MIX),
                measured('brightness-not-raised-v1', 'keep the mix from getting louder (or brighter', MIX),
            ],
            [],
        ],
        [
            "don't make it brighter [or louder]",
            [
                measured('brightness-not-raised-v1', "don't make it brighter [or louder", MIX),
                measured('loudness-not-raised-v1', "don't make it brighter [or louder", MIX),
            ],
            [],
        ],
        // an aside inside a protection's object or between its parts reads as its unbracketed form does,
        // on the object it names, or records the clause unsupported, never a reading on another scope
        [
            'keep the level (of the vocal) the same',
            [measured('loudness-held-v1', 'keep the level (of the vocal) the same', onTracks('vocal'))],
            [],
        ],
        [
            'keep the level [of the vocal] the same',
            [measured('loudness-held-v1', 'keep the level [of the vocal] the same', onTracks('vocal'))],
            [],
        ],
        [
            'keep the width (of the mix) intact',
            [measured('stereo-width-held-v1', 'keep the width (of the mix) intact', MIX)],
            [],
        ],
        [
            'keep the brightness (of the vocal)',
            [measured('brightness-held-v1', 'keep the brightness (of the vocal', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal (lead) bright',
            [],
            [
                unread(
                    'keep the vocal (lead) bright',
                    '“the vocal (lead” names no track or mix whose brightness can be measured.'
                ),
            ],
        ],
        [
            "don't make the vocal (the lead) louder",
            [],
            [
                unread(
                    "don't make the vocal (the lead) louder",
                    '“the vocal (the lead” names no track or mix whose loudness can be measured.'
                ),
            ],
        ],
        ['keep the drums (and bass) punchy', [], [unread('keep the drums (and bass) punchy', unmeasured('punchy'))]],
        [
            "don't make (the) vocal louder",
            [measured('loudness-not-raised-v1', "don't make (the) vocal louder", onTracks('vocal'))],
            [],
        ],
        [
            "don't touch the low end (of the bass)",
            [
                {
                    constraintId: 'low-end-untouched-v1',
                    clause: "don't touch the low end (of the bass",
                    scope: onTracks('bass'),
                    protection: { kind: 'exclude-dimension', dimension: 'low-frequency-band' },
                },
            ],
            [],
        ],
        // a nested, unclosed or stray bracket inside an object records its clause unsupported once,
        // never nothing and never a reading on another scope
        ...[
            'keep the vocal ((lead)) bright',
            'keep the ( drums punchy',
            "don't make the (unclosed vocal louder",
            'keep the closed) vocal bright',
            "don't make the (please) vocal louder",
            'keep the ( drums bright',
        ].map(
            (
                prompt
            ): [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']] => [
                prompt,
                [],
                [unread(prompt, BRACKET_REASON)],
            ]
        ),
        // an aside naming an object after a clause that read its own records the clause unsupported once,
        // never a reading on the scope the clause read without it
        ...(
            [
                ["don't touch the low end (vocal)", '(vocal)'],
                ['keep the width (drums)', '(drums)'],
                ["don't make it louder (the vocal)", '(the vocal)'],
                ["don't make it louder (vocal", '(vocal'],
                ['keep the width [drums]', '[drums]'],
                ['keep the vocal bright (the drums)', '(the drums)'],
            ] satisfies [string, string][]
        ).map(
            ([prompt, aside]): [
                string,
                PerceptualConstraintReading['constraints'],
                PerceptualConstraintReading['unsupported'],
            ] => [prompt, [], [unread(prompt, asideObjectReason(aside))]]
        ),
        // a protection with an exception after or before it, in brackets, after a comma or a dash, records
        // its clause unsupported once, never a bound or hold over the whole scope it excepts part of
        ...(
            [
                ['keep the mix from getting brighter (except the vocal)', 'except the vocal'],
                ['keep the mix from getting brighter (but the vocal can)', 'but the vocal can'],
                ['keep the mix from getting louder (apart from the vocal)', 'apart from the vocal'],
                ['keep the mix from getting louder (excluding the drums)', 'excluding the drums'],
                ['keep the mix from getting louder, except the vocal', 'except the vocal'],
                ['keep the mix level (the vocal may rise)', 'the vocal may rise'],
                ['keep the mix level (drums only may change)', 'drums only may change'],
                ['keep the mix level — the vocal aside', 'the vocal aside'],
                ['keep the mix level, vocal excepted', 'vocal excepted'],
                ["don't make the vocal brighter [other than in the chorus]", 'other than in the chorus'],
                ['except for the vocal, keep the mix from getting louder', 'except for the vocal'],
            ] satisfies [string, string][]
        ).map(
            ([prompt, exception]): [
                string,
                PerceptualConstraintReading['constraints'],
                PerceptualConstraintReading['unsupported'],
            ] => [prompt, [], [unread(prompt, exceptionReason(exception))]]
        ),
        [
            'keep the vocal bright, but make the drums louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        ['keep every track level (except the vocal)', [], [unread('keep every track level', NET_REASON)]],
        [
            'keep the mix level (not the vocal)',
            [],
            [unread('keep the mix level (not the vocal)', exceptionReason('not the vocal'))],
        ],
        [
            'keep the vocal bright, not harsh',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        // an exception excepts only an object inside its clause's scope: a refused quality, an object
        // outside the scope and a condition naming no object leave the reading standing
        ...[
            'keep the vocal bright, but not harsh',
            'keep the vocal bright, but not too bright',
            'keep the vocal bright (but not too bright)',
            'keep the vocal bright, but not too dull',
            'keep the vocal bright, but not the drums',
            'keep the vocal bright but not the bass',
            'keep the vocal bright, except the drums can be louder',
            'keep the vocal bright, aside from the drums',
            'keep the vocal bright, excluding the drums',
            'keep the vocal bright, other than the drums can be louder',
            'keep the vocal bright, unless the drums are louder',
            'keep the vocal bright unless I say otherwise',
        ].map(
            (
                prompt
            ): [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']] => [
                prompt,
                [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
                [],
            ]
        ),
        ['keep the mix wide, but not narrow', [measured('stereo-width-held-v1', 'keep the mix wide', MIX)], []],
        [
            'keep the vocal bright (except the drums) and keep the bass tight',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [unread('keep the bass tight', unmeasured('tight'))],
        ],
        // an exception never runs past the clause it follows
        [
            'keep the vocal bright, except the drums, and keep the mix wide',
            [
                measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal')),
                measured('stereo-width-held-v1', 'keep the mix wide', MIX),
            ],
            [],
        ],
        [
            'keep the mix wide, but not narrow and keep the vocal bright',
            [
                measured('stereo-width-held-v1', 'keep the mix wide', MIX),
                measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal')),
            ],
            [],
        ],
        // an exception naming an object inside the scope, or a stretch of time, still fails closed
        [
            'keep the vocal bright, unless the vocal gets louder',
            [],
            [
                unread(
                    'keep the vocal bright, unless the vocal gets louder',
                    exceptionReason('unless the vocal gets louder')
                ),
            ],
        ],
        [
            'keep the mix from getting brighter - but not in the chorus',
            [],
            [
                unread(
                    'keep the mix from getting brighter - but not in the chorus',
                    exceptionReason('but not in the chorus')
                ),
            ],
        ],
        [
            "don't touch the low end (other than the kick)",
            [],
            [unread("don't touch the low end (other than the kick)", exceptionReason('other than the kick'))],
        ],
        [
            'keep the mix level, except the vocal in the chorus',
            [],
            [
                unread(
                    'keep the mix level, except the vocal in the chorus',
                    exceptionReason('except the vocal in the chorus')
                ),
            ],
        ],
        // a "but" after a clause naming every part of its scope carves an object out of it
        [
            "don't make anything wider but the vocal",
            [],
            [unread("don't make anything wider but the vocal", exceptionReason('but the vocal'))],
        ],
        [
            "don't change the brightness of everything but the vocal",
            [],
            [unread("don't change the brightness of everything but the vocal", exceptionReason('but the vocal'))],
        ],
        [
            "don't make the mix wider but the vocal",
            [],
            [unread("don't make the mix wider but the vocal", exceptionReason('but the vocal'))],
        ],
        [
            "don't make it wider but the vocal",
            [],
            [unread("don't make it wider but the vocal", exceptionReason('but the vocal'))],
        ],
        [
            'keep the width of everything but the vocal the same',
            [],
            [unread('keep the width of everything but the vocal the same', exceptionReason('but the vocal the same'))],
        ],
        // a negation or permission governing a release refuses it, so the keep reads as it would alone
        [
            "don't stop keeping the vocal bright",
            [measured('brightness-held-v1', 'keeping the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'never stop keeping the vocal wide',
            [measured('stereo-width-held-v1', 'keeping the vocal wide', onTracks('vocal'))],
            [],
        ],
        [
            "don't stop keeping the drums bright",
            [measured('brightness-held-v1', 'keeping the drums bright', onTracks('drums'))],
            [],
        ],
        [
            'never stop keeping the level of the mix',
            [measured('loudness-held-v1', 'keeping the level of the mix', MIX)],
            [],
        ],
        // a refused release through an intent restores the keep it names
        [
            "don't stop caring about keeping the mix from getting wider",
            [measured('stereo-width-not-widened-v1', 'keeping the mix from getting wider', MIX)],
            [],
        ],
        [
            'never stop trying to keep the mix from getting wider',
            [measured('stereo-width-not-widened-v1', 'keep the mix from getting wider', MIX)],
            [],
        ],
        [
            "don't stop caring about keeping the vocal bright",
            [measured('brightness-held-v1', 'keeping the vocal bright', onTracks('vocal'))],
            [],
        ],
        // a release or stop after a kept quality opens a clause of its own, so the keep reads as it does alone
        [
            'keep the vocal bright stop turning it down',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright done turning it up',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        ['keep the mix wide stop turning', [measured('stereo-width-held-v1', 'keep the mix wide', MIX)], []],
        [
            'keep the vocal bright quit turning',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright stop getting wider',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        // a continued move's object is what moves, so an object holding a kept quality is that quality kept
        [
            'keep the vocal bright getting louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright making it louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright getting the drums louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright making the drums louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright boosting the highs',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright turning the vocal up',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'so yeah keep the vocal bright like getting louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        ['keep the mix wide widening the guitar', [measured('stereo-width-held-v1', 'keep the mix wide', MIX)], []],
        [
            'make the drums louder um keep the drums wide widening the guitar',
            [measured('stereo-width-held-v1', 'keep the drums wide', onTracks('drums'))],
            [],
        ],
        // a word list closes on a word end, so a longer word holding one is not that word
        ["don't make it harsh - better vocals and the drums louder", [], []],
        [
            "don't make the long neverland string pad louder",
            [],
            [
                unread(
                    "don't make the long neverland string pad louder",
                    '“the long neverland string pad” names no track or mix whose loudness can be measured.'
                ),
            ],
        ],
        [
            'keep everything wide but the vocal as isolated as possible',
            [measured('stereo-width-held-v1', 'keep everything wide', MIX)],
            [],
        ],
        // an ampersand before a verb opening a clause joins that clause as "and" does, spaced or not
        [
            'keep the vocal bright&stop making the mix wider',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [unread('stop making the mix wider', NET_REASON)],
        ],
        [
            'keep the drums dynamic &stop making the mix wider',
            [measured('dynamics-held-v1', 'keep the drums dynamic', onTracks('drums'))],
            [unread('stop making the mix wider', NET_REASON)],
        ],
        [
            'keep the mix wide&stop making the mix wider',
            [measured('stereo-width-held-v1', 'keep the mix wide', MIX)],
            [unread('stop making the mix wider', NET_REASON)],
        ],
        ['keep the vocal&stop making the mix wider', [], [unread('stop making the mix wider', NET_REASON)]],
        [
            "don't make the mix wider&keep the vocal bright",
            [
                measured('stereo-width-not-widened-v1', "don't make the mix wider", MIX),
                measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal')),
            ],
            [],
        ],
        [
            'keep the mix from getting louder&keep the vocal bright',
            [
                measured('loudness-not-raised-v1', 'keep the mix from getting louder', MIX),
                measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal')),
            ],
            [],
        ],
        [
            'keep the vocal bright & wide&stop making the mix wider',
            [
                measured('brightness-held-v1', 'keep the vocal bright & wide', onTracks('vocal')),
                measured('stereo-width-held-v1', 'keep the vocal bright & wide', onTracks('vocal')),
            ],
            [unread('stop making the mix wider', NET_REASON)],
        ],
        // a finite verb after a kept quality opens a clause of its own; only a gerund continues the keep's move
        [
            'keep the vocal bright make the drums louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright& make the drums louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright now make the drums louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright make the bass 3 dB louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright get the drums louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright let the drums be louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright avoid making the mix wider',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright keep making it wider',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        ['keep the mix wide make the vocal brighter', [measured('stereo-width-held-v1', 'keep the mix wide', MIX)], []],
        [
            'keep the vocal dynamic make the drums louder',
            [measured('dynamics-held-v1', 'keep the vocal dynamic', onTracks('vocal'))],
            [],
        ],
        [
            'keep the drums punchy make the bass louder',
            [],
            [unread('keep the drums punchy', 'No measurement the application takes shows that “punchy” holds.')],
        ],
        // a keep after a direction opens a clause of its own
        [
            "don't make the mix wider keep the vocal brighter",
            [
                measured('stereo-width-not-widened-v1', "don't make the mix wider", MIX),
                measured('brightness-held-v1', 'keep the vocal brighter', onTracks('vocal')),
            ],
            [],
        ],
        [
            "keep the vocal bright keep making the mix brighter but don't make it wider",
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [unread("don't make it wider", '“it” names no single scope: the request names a track or role before it.')],
        ],
        // a spaced ampersand continues a kept term or a kept quality's object as "and" does
        [
            'keep the vocal bright & the drums bright',
            [
                measured('brightness-held-v1', 'keep the vocal bright & the drums bright', onTracks('vocal')),
                measured('brightness-held-v1', 'keep the vocal bright & the drums bright', onTracks('drums')),
            ],
            [],
        ],
        [
            'keep the vocal bright & dynamic',
            [
                measured('brightness-held-v1', 'keep the vocal bright & dynamic', onTracks('vocal')),
                measured('dynamics-held-v1', 'keep the vocal bright & dynamic', onTracks('vocal')),
            ],
            [],
        ],
        // a release governing a negated keep gives the negation up, so the keep stands
        [
            'stop trying to not keep the vocal bright',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'stop trying not keep the vocal bright',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        // a release governs only a verb it leads to as a gerund or through an intent, so a release word
        // before a bare keep is a clause of its own and the keep holds
        [
            'Mix is done keep the vocal bright',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            "I'm done keep the vocal bright",
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            "I'm finished keep the vocal bright",
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'forget keep the vocal bright',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'quit keep the vocal bright',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'give up keep the vocal bright',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'no point keep the vocal bright',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'done keep the vocal bright and keep the mix narrow',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        // a should states a demand, never a permission, so the clause after it excepts nothing
        [
            "don't make the mix quieter, but it should stay dynamic",
            [measured('loudness-not-lowered-v1', "don't make the mix quieter", MIX)],
            [],
        ],
        [
            "don't make the mix louder, the drums should hit harder",
            [measured('loudness-not-raised-v1', "don't make the mix louder", MIX)],
            [],
        ],
        [
            "don't make the mix louder, but it should not clip",
            [measured('loudness-not-raised-v1', "don't make the mix louder", MIX)],
            [],
        ],
        [
            "don't make the mix louder, but the vocal should be brighter",
            [measured('loudness-not-raised-v1', "don't make the mix louder", MIX)],
            [],
        ],
        [
            "don't make the vocal louder, but the vocal should stay bright",
            [measured('loudness-not-raised-v1', "don't make the vocal louder", onTracks('vocal'))],
            [],
        ],
        [
            "don't make the mix quieter; the mix should stay dynamic",
            [measured('loudness-not-lowered-v1', "don't make the mix quieter", MIX)],
            [],
        ],
        [
            'keep the mix wide, but it should stay dynamic',
            [measured('stereo-width-held-v1', 'keep the mix wide', MIX)],
            [],
        ],
        [
            'keep the mix wide, but the drums should hit harder',
            [measured('stereo-width-held-v1', 'keep the mix wide', MIX)],
            [],
        ],
        [
            'keep the mix level, but the vocal should rise',
            [measured('loudness-held-v1', 'keep the mix level', MIX)],
            [],
        ],
        [
            'never stop preserving the bass dynamics',
            [measured('dynamics-held-v1', 'preserving the bass dynamics', onTracks('bass'))],
            [],
        ],
        [
            'do not stop keeping the drums from getting wider',
            [measured('stereo-width-not-widened-v1', 'keeping the drums from getting wider', onTracks('drums'))],
            [],
        ],
        [
            'never cease keeping the vocal bright',
            [measured('brightness-held-v1', 'keeping the vocal bright', onTracks('vocal'))],
            [],
        ],
        ['never quit keeping the mix wide', [measured('stereo-width-held-v1', 'keeping the mix wide', MIX)], []],
        [
            "don't ever stop keeping the vocal bright",
            [measured('brightness-held-v1', 'keeping the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            "don't quit keeping the drums dynamic",
            [measured('dynamics-held-v1', 'keeping the drums dynamic', onTracks('drums'))],
            [],
        ],
        [
            "I don't want to stop keeping the vocal bright",
            [measured('brightness-held-v1', 'keeping the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            "you don't have to stop keeping the vocal bright",
            [measured('brightness-held-v1', 'keeping the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'no need to stop keeping the vocal bright',
            [measured('brightness-held-v1', 'keeping the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            "don't cancel keeping the vocal bright",
            [measured('brightness-held-v1', 'keeping the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            "don't give up keeping the vocal bright",
            [measured('brightness-held-v1', 'keeping the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            "forget the EQ and don't stop keeping the mix wide",
            [measured('stereo-width-held-v1', 'keeping the mix wide', MIX)],
            [],
        ],
        ["don't skip keeping the drums punchy", [], [unread('keeping the drums punchy', unmeasured('punchy'))]],
        // a "but" before a quality, or before a track outside a track-scoped clause, carves nothing out
        [
            'keep the mix wide but warm',
            [measured('stereo-width-held-v1', 'keep the mix wide but warm', MIX)],
            [unread('keep the mix wide but warm', unmeasured('warm'))],
        ],
        [
            'keep the vocal bright but the drums',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        // a "but" before a clause of its own, its object taking a predicate, carves nothing out
        [
            'keep everything bright but the vocal is too loud',
            [measured('brightness-held-v1', 'keep everything bright', MIX)],
            [],
        ],
        // a permission naming another scope states that scope's change, never an exception to the hold
        [
            'keep the vocal bright, the drums can be louder',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [],
        ],
        [
            'keep the vocal bright (the vocal may get darker)',
            [],
            [unread('keep the vocal bright (the vocal may get darker)', exceptionReason('the vocal may get darker'))],
        ],
        // no clause ends in its bracket
        [
            "don't make it louder (and add reverb)",
            [measured('loudness-not-raised-v1', "don't make it louder", MIX)],
            [],
        ],
        ['stop the bass from getting muddy', [], [unread('stop the bass from getting muddy', unmeasured('muddy'))]],
        [
            'prevent the vocal from sounding thin',
            [],
            [unread('prevent the vocal from sounding thin', unmeasured('thin'))],
        ],
        // a held quality verifies one kept, never one prevented
        [
            'keep the vocal from sounding bright',
            [],
            [unread('keep the vocal from sounding bright', unmeasured('bright'))],
        ],
        ["don't keep the bass from getting muddy", [], []],
        [
            'keep the mix from getting louder',
            [measured('loudness-not-raised-v1', 'keep the mix from getting louder', MIX)],
            [],
        ],
        [
            'stop the vocal from getting brighter',
            [measured('brightness-not-raised-v1', 'stop the vocal from getting brighter', onTracks('vocal'))],
            [],
        ],
        ['keep the stereo image', [measured('stereo-width-held-v1', 'keep the stereo image', MIX)], []],
        ['keep the width', [measured('stereo-width-held-v1', 'keep the width', MIX)], []],
        [
            "don't turn the volume of the vocal up by 3 dB",
            [],
            [unread("don't turn the volume of the vocal up by 3 dB", NET_REASON)],
        ],
        [
            "don't push the stereo field of the drums past 3 dB",
            [],
            [unread("don't push the stereo field of the drums past 3 dB", NET_REASON)],
        ],
        [
            "don't raise the volume of the vocal by more than 3 dB",
            [],
            [unread("don't raise the volume of the vocal by more than 3 dB", NET_REASON)],
        ],
        // a negation or "no" that governs no measured word opens no protective clause
        ["don't forget to make the bass wider", [], []],
        ["don't be afraid to make the bass wider", [], []],
        ["don't be afraid to make the drums louder", [], []],
        ['no reverb on the drums and the volume up', [], []],
        // a track whose name holds a list separator is read as one object
        [
            'keep the Lead or Rhythm level the same',
            [measured('loudness-held-v1', 'keep the Lead or Rhythm level the same', onTracks('extra-0'))],
            [],
        ],
        [
            'keep the Salt and Pepper level the same',
            [measured('loudness-held-v1', 'keep the Salt and Pepper level the same', onTracks('extra-1'))],
            [],
        ],
        [
            'keep the Rock, Paper level the same',
            [measured('loudness-held-v1', 'keep the Rock, Paper level the same', onTracks('extra-2'))],
            [],
        ],
    ] satisfies [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']][])(
        'reads "%s"',
        (prompt, constraints, unsupported) => {
            const context = grammarContext('Lead or Rhythm', 'Salt and Pepper', 'Rock, Paper');
            expect(compilePerceptualConstraints(prompt, context)).toEqual({ constraints, unsupported });
        }
    );

    // a name is matched with its brackets, so two names differing only by brackets never read as each other
    it.each([
        ['keep Bass DI bright', [measured('brightness-held-v1', 'keep Bass DI bright', onTracks('extra-1'))], []],
        ['keep Bass (DI) bright', [measured('brightness-held-v1', 'keep Bass (DI) bright', onTracks('extra-0'))], []],
        [
            'keep the level of Bass (DI) and Bass DI the same',
            [
                measured(
                    'loudness-held-v1',
                    'keep the level of Bass (DI) and Bass DI the same',
                    onTracks('extra-0', 'extra-1')
                ),
            ],
            [],
        ],
        [
            "don't make (the) vocal louder",
            [measured('loudness-not-raised-v1', "don't make (the) vocal louder", onTracks('vocal'))],
            [],
        ],
    ] satisfies [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']][])(
        'reads "%s" beside a Bass (DI) and a Bass DI',
        (prompt, constraints, unsupported) => {
            const context = grammarContext('Bass (DI)', 'Bass DI');
            expect(compilePerceptualConstraints(prompt, context)).toEqual({ constraints, unsupported });
        }
    );

    // A negation governing a keep, stop, prevent or leave, directly or through a permission, permits
    // what it names, so the clause protects nothing and records nothing, in every keep reader.
    it.each([
        "you don't have to keep the mix from getting wider",
        "there's no need to prevent the vocal from getting brighter",
        "you don't need to stop the mix from getting wider",
        'no need to prevent the vocal from getting louder',
        "there's no need to leave the width alone",
        // a negation right before the keep permits the move too
        "don't keep the mix from getting wider",
        // the held-noun keep, the same-level keep and the low-end keep read the same guard
        "there's no need to keep the level of the vocal",
        "you don't have to keep the Keys at the same level",
        "there's no need to leave the low end untouched",
        // every permission verb, past adverbs and a named person, and "nobody" or "no one"
        "you don't want to stop the mix from getting wider",
        "you don't really need to stop the mix from getting wider",
        "don't feel you need to stop the mix from getting wider",
        "I don't want to keep the mix from getting wider",
        "you don't really need to keep the mix from getting wider",
        'nobody needs to keep the mix from getting wider',
        'no one needs to keep the mix from getting wider',
        "you don't even have to keep the mix from getting wider",
        "you don't ever need to keep the mix from getting wider",
        "I don't need you to keep the mix from getting wider",
        "don't bother keeping the mix from getting wider",
        "don't bother to keep the mix from getting wider",
        "you don't really need to keep the vocal bright",
        // a release gives up the keep, stop or prevent it names, so it permits what that names too
        'stop keeping the mix from getting wider',
        'quit keeping the mix from getting wider',
        'you can stop keeping the mix from getting wider',
        'forget about keeping the mix from getting wider',
        'forget keeping the mix from getting wider',
        'skip keeping the mix from getting wider',
        'cease keeping the mix from getting wider',
        'disregard keeping the mix from getting wider',
        'cancel keeping the mix from getting wider',
        'undo keeping the mix from getting wider',
        'remove the constraint keeping the mix from getting wider',
        'no longer keep the mix from getting wider',
        'you no longer need to keep the mix from getting wider',
        'you no longer need to keep the mix wide',
        'no more keeping the mix from getting wider',
        'I no longer care about keeping the mix from getting wider',
        'stop worrying about keeping the mix from getting wider',
        // a release may give the keep up through the intent it was held with
        'stop caring about keeping the mix from getting wider',
        'stop trying to keep the mix from getting wider',
        'give up trying to keep the vocal from getting brighter',
        'I am done with keeping the mix from getting wider',
        'stop bothering to keep the drums from getting louder',
        'quit worrying about keeping the mix from getting wider',
        'stop trying keeping the mix from getting wider',
        "don't worry about keeping the vocal from getting brighter",
        'no point in keeping the mix from getting wider',
        'no need for keeping the mix from getting wider',
        "don't try keeping the mix from getting wider",
        "I'm done keeping the mix from getting wider",
        'instead of keeping the mix from getting brighter, make it brighter',
        'stop preventing the vocal from getting brighter',
        'you can stop preventing the vocal from getting brighter',
        'stop stopping the mix from getting wider',
        'stop keeping the vocal bright',
    ])('reads nothing from the permission "%s"', (prompt) => {
        expect(compilePerceptualConstraints(prompt, grammarContext('Keys'))).toEqual({
            constraints: [],
            unsupported: [],
        });
    });

    // A keep or stop names the move it prevents through any verb a quality becomes or shows a level
    // through, so each bounds the direction it names on its object, as "getting" does.
    const MOVE_VERB_NAMES = ['Lead Vox', 'Keys', 'Bass (DI)', 'Keys-2', 'Drums (loud)', 'Vox #2'];
    it.each([
        ['keep the mix from going brighter', 'brightness-not-raised-v1', MIX],
        ['keep Lead Vox from going wider', 'stereo-width-not-widened-v1', onTracks('extra-0')],
        ['keep the drums from going darker', 'brightness-not-lowered-v1', onTracks('drums')],
        ['keep the vocal from turning wider', 'stereo-width-not-widened-v1', onTracks('vocal')],
        ['keep the drums from growing brighter', 'brightness-not-raised-v1', onTracks('drums')],
        ['keep the mix from appearing darker', 'brightness-not-lowered-v1', MIX],
        ['keep Keys from going wider', 'stereo-width-not-widened-v1', onTracks('extra-1')],
        ['keep Bass (DI) from sounding brighter', 'brightness-not-raised-v1', onTracks('extra-2')],
        ['keep Keys-2 from sounding brighter', 'brightness-not-raised-v1', onTracks('extra-3')],
        ['keep Drums (loud) from sounding wider', 'stereo-width-not-widened-v1', onTracks('extra-4')],
        ['keep Vox #2 from sounding brighter', 'brightness-not-raised-v1', onTracks('extra-5')],
        ['keep the drums from going louder', 'loudness-not-raised-v1', onTracks('drums')],
        ['keep the mix from going quieter', 'loudness-not-lowered-v1', MIX],
        ['keep the mix from turning narrower', 'stereo-width-not-narrowed-v1', MIX],
        ['stop the vocal from looking louder', 'loudness-not-raised-v1', onTracks('vocal')],
        ['prevent the mix from coming across wider', 'stereo-width-not-widened-v1', MIX],
        ['keep the drums from ending up less dynamic', 'dynamics-not-reduced-v1', onTracks('drums')],
        ['keep the mix from feeling louder', 'loudness-not-raised-v1', MIX],
        ['keep the mix from seeming wider', 'stereo-width-not-widened-v1', MIX],
        ['keep the mix from becoming brighter', 'brightness-not-raised-v1', MIX],
    ] satisfies [string, MeasuredPerceptualConstraint['constraintId'], PerceptualConstraintScope][])(
        'bounds "%s"',
        (prompt, constraintId, scope) => {
            expect(compilePerceptualConstraints(prompt, grammarContext(...MOVE_VERB_NAMES))).toEqual({
                constraints: [measured(constraintId, prompt, scope)],
                unsupported: [],
            });
        }
    );

    // An object no reader can measure records the prevented move unsupported, never nothing.
    it.each([
        'keep every track from going wider',
        'keep every track from sounding brighter',
        'keep "Drums" from sounding brighter',
        'keep Bass (DI) from sounding brighter',
        'keep Keys-2 from sounding brighter',
        'keep Vox #2 from sounding brighter',
    ])('records "%s" unsupported', (prompt) => {
        expect(compilePerceptualConstraints(prompt, grammarContext())).toEqual({
            constraints: [],
            unsupported: [unread(prompt, NET_REASON)],
        });
    });

    // A protection whose object a separator follows goes on past it when the rest is its own
    // complement, so the clause is recorded unsupported, never dropped.
    it.each([
        ['keep Keys - from getting wider', 'keep Keys - from getting wider'],
        ['keep Keys - from getting brighter', 'keep Keys - from getting brighter'],
        ['keep Keys - from getting wider, but the drums can', 'keep Keys - from getting wider'],
        ['make the guitar pop, keep Keys - from getting wider', 'keep Keys - from getting wider'],
        ["don't let Keys - get louder", "don't let Keys - get louder"],
        ["don't make Keys - louder but the vocal can be louder", "don't make Keys - louder"],
        // a joining word or a spaced ampersand leaves the rest of the protection standing as a dash does
        ['keep Keys & from getting wider', 'keep Keys & from getting wider'],
        ['keep Keys and from getting wider', 'keep Keys and from getting wider'],
        ["don't let Keys & get louder", "don't let Keys & get louder"],
    ])('records "%s" unsupported', (prompt, clause) => {
        expect(compilePerceptualConstraints(prompt, grammarContext('Keys'))).toEqual({
            constraints: [],
            unsupported: [unread(clause, NET_REASON)],
        });
    });

    // A negation governing an earlier verb permits nothing: the keep after it still holds, with or
    // without a comma between them.
    const VOCAL_BRIGHT = measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'));
    it.each([
        ['without changing the tempo keep the vocal bright', [VOCAL_BRIGHT], []],
        ['without changing the tempo, keep the vocal bright', [VOCAL_BRIGHT], []],
        ["I don't care about the reverb keep the vocal bright", [VOCAL_BRIGHT], []],
        ["I don't care about the reverb, keep the vocal bright", [VOCAL_BRIGHT], []],
        ["don't over-compress keep the vocal bright", [VOCAL_BRIGHT], []],
        ["don't over-compress, keep the vocal bright", [VOCAL_BRIGHT], []],
        [
            'no fx please keep the vocal bright and the mix from getting wider',
            [
                measured(
                    'brightness-held-v1',
                    'keep the vocal bright and the mix from getting wider',
                    onTracks('vocal')
                ),
                measured('stereo-width-not-widened-v1', 'keep the vocal bright and the mix from getting wider', MIX),
            ],
            [],
        ],
        // a kept move after an unrelated negation is the bound the same clause states alone
        [
            'never mind the drums keep the mix from getting wider',
            [measured('stereo-width-not-widened-v1', 'keep the mix from getting wider', MIX)],
            [],
        ],
        [
            'not too much reverb keep the vocal from getting brighter',
            [measured('brightness-not-raised-v1', 'keep the vocal from getting brighter', onTracks('vocal'))],
            [],
        ],
    ] satisfies [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']][])(
        'reads "%s" past an unrelated negation',
        (prompt, constraints, unsupported) => {
            expect(compilePerceptualConstraints(prompt, grammarContext())).toEqual({ constraints, unsupported });
        }
    );

    // One keep chains kept moves and kept qualities in either order, each part read under it.
    type ChainPart = [MeasuredPerceptualConstraint['constraintId'], PerceptualConstraintScope];
    it.each([
        [
            'keep the mix from getting wider and the drums from getting louder',
            [
                ['stereo-width-not-widened-v1', MIX],
                ['loudness-not-raised-v1', onTracks('drums')],
            ],
        ],
        [
            'keep the vocal from getting louder and the drums from getting quieter',
            [
                ['loudness-not-raised-v1', onTracks('vocal')],
                ['loudness-not-lowered-v1', onTracks('drums')],
            ],
        ],
        [
            'keep the vocal from getting louder, from getting brighter',
            [
                ['loudness-not-raised-v1', onTracks('vocal')],
                ['brightness-not-raised-v1', onTracks('vocal')],
            ],
        ],
        [
            'keep the mix from getting wider and the vocal bright',
            [
                ['stereo-width-not-widened-v1', MIX],
                ['brightness-held-v1', onTracks('vocal')],
            ],
        ],
        [
            'keep the vocal from getting brighter and the mix wide',
            [
                ['brightness-not-raised-v1', onTracks('vocal')],
                ['stereo-width-held-v1', MIX],
            ],
        ],
        [
            'keep the vocal bright and the mix from getting wider',
            [
                ['brightness-held-v1', onTracks('vocal')],
                ['stereo-width-not-widened-v1', MIX],
            ],
        ],
    ] satisfies [string, ChainPart[]][])('reads every part of the chain "%s"', (prompt, parts) => {
        expect(compilePerceptualConstraints(prompt, grammarContext())).toEqual({
            constraints: parts.map(([constraintId, scope]) => measured(constraintId, prompt, scope)),
            unsupported: [],
        });
    });
});

function lowEndUntouched(clause: string): PerceptualConstraintReading['constraints'][number] {
    return {
        constraintId: 'low-end-untouched-v1',
        clause,
        scope: MIX,
        protection: { kind: 'exclude-dimension', dimension: 'low-frequency-band' },
    };
}

describe('reading a protection only over the words it governs', () => {
    const VOCAL_BRIGHT_HELD = measured('brightness-held-v1', 'Keep the vocal bright', onTracks('vocal'));

    it.each([
        // "don't be" opens nothing on its own, while a protection it heads still records
        ["don't be shy, make the drums louder", [], []],
        ["don't be any louder", [], [unread("don't be any louder", NET_REASON)]],
        // a noun clause reads its verbs and families from the direction table, continued nouns included
        [
            "don't boost the brightness of the vocal",
            [measured('brightness-not-raised-v1', "don't boost the brightness of the vocal", onTracks('vocal'))],
            [],
        ],
        [
            "don't widen the stereo image",
            [measured('stereo-width-not-widened-v1', "don't widen the stereo image", MIX)],
            [],
        ],
        [
            "don't widen the stereo image of the vocal and the brightness of the drums",
            [
                measured(
                    'stereo-width-not-widened-v1',
                    "don't widen the stereo image of the vocal and the brightness of the drums",
                    onTracks('vocal')
                ),
                measured(
                    'brightness-not-raised-v1',
                    "don't widen the stereo image of the vocal and the brightness of the drums",
                    onTracks('drums')
                ),
            ],
            [],
        ],
        // every causing verb opens a direction clause, "become" among them
        ["don't become louder", [measured('loudness-not-raised-v1', "don't become louder", MIX)], []],
        [
            'without becoming any wider',
            [measured('stereo-width-not-widened-v1', 'without becoming any wider', MIX)],
            [],
        ],
        // a measured word stated before an unrelated protective word is a plain request
        ['brighten the vocal without making it harsh', [], []],
        ['make the vocal brighter without making it thin', [], []],
        ['widen the mix without making it muddy', [], []],
        ['make the vocal louder to keep it above the guitar', [], []],
        ['brighten the vocal to stop it sounding dull', [], []],
        // a measured word the protective word governs still records
        [
            "don't make the vocal brighter without asking",
            [],
            [unread("don't make the vocal brighter without asking", NET_REASON)],
        ],
        ["the vocal level shouldn't change", [], [unread("the vocal level shouldn't change", NET_REASON)]],
        // a plain copula negation describes the sound; a modal negation states a bound
        ["the mix isn't louder", [], []],
        ['the mix is not louder', [], []],
        ["the vocal isn't brighter, make it brighter", [], []],
        ["the vocal isn't louder than the drums, fix it", [], []],
        ["the drums aren't louder", [], []],
        ["the mix wasn't louder", [], []],
        ["the vocal doesn't sound brighter", [], []],
        // a purpose clause's "doesn't" states a bound, even through a linking verb
        [
            "Add some warmth so it doesn't sound louder.",
            [measured('loudness-not-raised-v1', "it doesn't sound louder", MIX)],
            [],
        ],
        [
            "Add some warmth so the mix doesn't feel louder.",
            [measured('loudness-not-raised-v1', "the mix doesn't feel louder", MIX)],
            [],
        ],
        [
            "Add some warmth so it doesn't seem quieter.",
            [measured('loudness-not-lowered-v1', "it doesn't seem quieter", MIX)],
            [],
        ],
        [
            "Add some warmth so that the mix doesn't feel louder.",
            [measured('loudness-not-raised-v1', "the mix doesn't feel louder", MIX)],
            [],
        ],
        [
            "the vocal shouldn't be louder",
            [measured('loudness-not-raised-v1', "the vocal shouldn't be louder", onTracks('vocal'))],
            [],
        ],
        ["the mix mustn't get wider", [measured('stereo-width-not-widened-v1', "the mix mustn't get wider", MIX)], []],
        [
            "the vocal can't be brighter",
            [measured('brightness-not-raised-v1', "the vocal can't be brighter", onTracks('vocal'))],
            [],
        ],
        ["the mix won't get louder", [measured('loudness-not-raised-v1', "the mix won't get louder", MIX)], []],
        // a typeset apostrophe (U+2019) reads as a typed one, in a negation and in a modal negation
        [
            'don’t make the mix any wider',
            [measured('stereo-width-not-widened-v1', 'don’t make the mix any wider', MIX)],
            [],
        ],
        [
            'the vocal shouldn’t be louder',
            [measured('loudness-not-raised-v1', 'the vocal shouldn’t be louder', onTracks('vocal'))],
            [],
        ],
        // an object never swallows the verb of the clause after it
        [
            "don't make the bass louder and the vocal needs to be brighter",
            [measured('loudness-not-raised-v1', "don't make the bass louder", onTracks('bass'))],
            [],
        ],
        // a keep that continues a move holds nothing
        ['keep the vocal getting brighter', [], []],
        ['keep on widening', [], []],
        ['keep on widening the mix', [], []],
        // "avoid" governs what follows as a negation does, so the net records what no reader reads
        ['avoid making the mix louder', [], [unread('avoid making the mix louder', NET_REASON)]],
        ['avoiding making the drums any wider', [], [unread('avoiding making the drums any wider', NET_REASON)]],
        // the low end's own hold verbs
        ["don't mess with the low end", [lowEndUntouched("don't mess with the low end")], []],
        ['without messing with the low end', [lowEndUntouched('without messing with the low end')], []],
        // a keep or leave holding what it names governs nouns and qualities, never a direction, so a
        // later move it chains into or runs through is the request and states nothing
        ['Keep the vocal bright and the drums louder', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright and the mix wider', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright and the drums a bit louder', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright and the drums much louder', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright and the drums 3 dB louder', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright and the drums louder in the chorus', [VOCAL_BRIGHT_HELD], []],
        // a dash, ampersand or slash standing alone, or a line break, separates the keep from the move after
        // it, so the keep still holds what it names and the move is the request
        ['Keep the vocal bright - make the drums wider', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright – make the drums wider', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright — make the drums wider', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright & make the drums wider', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright / make the drums wider', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright\nmake the drums wider', [VOCAL_BRIGHT_HELD], []],
        ['Keep the vocal bright letting the drums breathe - the bass louder', [VOCAL_BRIGHT_HELD], []],
        // the net ends a clause at the same separators, so a move after one is the request, as after a comma
        ["don't make it harsh - brighten the vocal", [], []],
        ["don't make it harsh, brighten the vocal", [], []],
        // a hard boundary word ends the clause as the comma does
        ["don't make it harsh but brighten the vocal", [], []],
        ["don't make it harsh then brighten the vocal", [], []],
        ["don't make it harsh please brighten the vocal", [], []],
        ['without making it harsh\nmake the vocal brighter', [], []],
        ['stop it clipping - make the drums louder', [], []],
        ['avoid making the vocal harsh - brighten it', [], []],
        [
            'keep the vocal from getting brighter - widen the drums',
            [measured('brightness-not-raised-v1', 'keep the vocal from getting brighter', onTracks('vocal'))],
            [],
        ],
        // a hyphen inside a word separates nothing, so the continued move still reads whole
        ['keep making the lo-fi pad wider', [], []],
        // a compound catalog word and the low end read hyphenated as they read spaced
        ["don't touch the low-end", [lowEndUntouched("don't touch the low-end")], []],
        [
            'keep the vocal up-close',
            [
                {
                    constraintId: 'vocal-intimacy-v1',
                    clause: 'keep the vocal up-close',
                    scope: onTracks('vocal'),
                    protection: { kind: 'exclude-dimension', dimension: 'ambience' },
                },
            ],
            [],
        ],
        ['Leave the vocal alone and the drums louder', [], []],
        ['Leave the vocal alone and the drums a little louder', [], []],
        ['Keep the mix balanced when you make the vocal louder', [], []],
        // a quality after a held chain continues the keep, never read as a move; both entries quote the
        // whole clause on purpose, since one keep states both qualities, each read in its own family
        [
            'keep the vocal bright and the drums warm',
            [measured('brightness-held-v1', 'keep the vocal bright and the drums warm', onTracks('vocal'))],
            [
                unread(
                    'keep the vocal bright and the drums warm',
                    'No measurement the application takes shows that “warm” holds.'
                ),
            ],
        ],
        // a held chain runs through every segment it joins, and still governs no direction there
        [
            'keep the vocal bright and the mix wide and the drums louder',
            [
                measured('brightness-held-v1', 'keep the vocal bright and the mix wide', onTracks('vocal')),
                measured('stereo-width-held-v1', 'keep the vocal bright and the mix wide', MIX),
            ],
            [],
        ],
        // a held chain governs a measured noun it chains into, so one no reader consumes is recorded
        [
            'keep the vocal bright and the stereo image of the drums',
            [measured('brightness-held-v1', 'keep the vocal bright', onTracks('vocal'))],
            [unread('keep the vocal bright and the stereo image of the drums', NET_REASON)],
        ],
        // a protection's governed words end at a subordinator or a subject of its own clause: past it
        // stands the request's own move or condition
        ['Stop the vocal from getting buried by making it louder.', [], []],
        ['Prevent masking by making the vocal louder.', [], []],
        ['Prevent the vocal from getting lost by making it brighter.', [], []],
        ['Stop it from getting lost by making the vocal louder.', [], []],
        ['Prevent clipping when I make the vocal louder.', [], []],
        ['Stop the vocal from clipping when it gets louder.', [], []],
        ['Stop the drums sounding harsh when I make them brighter.', [], []],
        ['Stop the bass from getting boomy when I make it louder.', [], []],
        ['Stop the vocal from getting lost when the drums get louder.', [], []],
        ['Make the vocal louder to stop the guitars from masking it when they get louder.', [], []],
        ['Prevent the clipping you get making the vocal louder.', [], []],
        // a third-person "doesn't" beside a move describes the sound or states a purpose
        ["The vocal doesn't get louder in the chorus, raise it.", [], []],
        ["Make the vocal louder so it doesn't get lost in the mix and the drums wider.", [], []],
        // a joined segment continues only a protection that governed a measured word
        ['Make the vocal brighter without making it harsh and the drums louder.', [], []],
        ["Don't touch the vocal and the drums louder please.", [], []],
        // a keep naming the move it prevents bounds that move, so a joined direction stays in its net
        [
            'keep the mix from getting louder and the vocal quieter',
            [measured('loudness-not-raised-v1', 'keep the mix from getting louder', MIX)],
            [unread('keep the mix from getting louder and the vocal quieter', NET_REASON)],
        ],
        [
            'Keep the bass punchy and the mix quieter',
            [],
            [unread('Keep the bass punchy', 'No measurement the application takes shows that “punchy” holds.')],
        ],
        // the low end's own left state and its "no change" form
        ['leave the low end untouched', [lowEndUntouched('leave the low end untouched')], []],
        ['no changes to the low end', [lowEndUntouched('no changes to the low end')], []],
        // a semicolon ends the clause, so the bound stops at it and the next clause asks for a move
        [
            "don't make the mix any wider; brighten the vocal",
            [measured('stereo-width-not-widened-v1', "don't make the mix any wider", MIX)],
            [],
        ],
        // a brightness noun in free text opens the net as every held noun does
        ['no brightness change', [], [unread('no brightness change', NET_REASON)]],
        [
            "don't let the brightness of the vocal drift",
            [],
            [unread("don't let the brightness of the vocal drift", NET_REASON)],
        ],
    ] satisfies [string, PerceptualConstraintReading['constraints'], PerceptualConstraintReading['unsupported']][])(
        'reads "%s"',
        (prompt, constraints, unsupported) => {
            expect(compilePerceptualConstraints(prompt, grammarContext())).toEqual({ constraints, unsupported });
        }
    );
});

describe('a clause word list', () => {
    // Each list states its shorter phrase first, so only the builder's longest-first order reads the whole word.
    it.each([
        ['the avoid verbs', AVOID_VERB, 'avoiding'],
        ['the keep verbs', KEEP, 'keeping'],
        ['the scope words', SCOPE_WORD, 'master bus'],
    ])('reads %s by the longest phrase first', (_name, list, text) => {
        expect(new RegExp(`^${list}`, 'iu').exec(text)?.[0]).toBe(text);
    });
});

type HeldMetric = 'integratedLoudness' | 'crestFactor' | 'sideEnergyFraction' | 'spectralCentroid';
const HELD_UNITS: Readonly<Record<HeldMetric, string>> = {
    integratedLoudness: 'LUFS',
    crestFactor: 'dB',
    sideEnergyFraction: 'ratio',
    spectralCentroid: 'hertz',
};

/** The compiled batch's state with one actual-render proof carrying the given figures for its held target. */
function withFigures(
    state: MetricGoalState,
    targetId: string,
    metricId: HeldMetric,
    figures: { baseline: number; preview: number }
): MetricGoalState {
    const binding = state.binding;
    if (binding === null) {
        throw new Error('The compiled batch carries no binding.');
    }
    const master = targetId === 'master';
    const artifact = {
        route: master ? ('mixdown' as const) : ('isolated-subgraph' as const),
        artifact: { contentAddress: 'audio' },
    };
    const figure = (value: number) => ({
        status: 'measured' as const,
        metricVersion: 1 as const,
        unit: HELD_UNITS[metricId],
        value,
        confidence: 'exact' as const,
    });
    return {
        ...state,
        proofs: [
            {
                receiptDigest: 'receipt',
                preview: {
                    provenance: {
                        origin: 'planner',
                        callId: 'measurement',
                        turn: 2,
                        runId: RUN_ID,
                        targets: [{ targetId, baseline: artifact, preview: artifact }],
                    },
                    scope: master ? { kind: 'master' } : { kind: 'tracks', ids: [targetId] },
                    range: { startBeat: 0, endBeat: 4, sectionId: null },
                    targets: [
                        {
                            targetId,
                            targetKind: master ? 'master' : 'track',
                            baseline: { [metricId]: figure(figures.baseline) },
                            preview: { [metricId]: figure(figures.preview) },
                            deltas: {},
                        },
                    ],
                    batchContentHash: binding.contentHash,
                    revision: binding.revision,
                },
            },
        ],
    };
}

function compiledState(prompt: string) {
    const compiled = compile(prompt, [setParameter('vocal-trim', 'gain-level', -1)]);
    const state = metricGoalStateCodec(compiled.metricGoalState);
    if (state === null) {
        throw new Error('The compiled batch carries no metric goal state.');
    }
    return { compiled, state };
}

type AdmissionRow = [clause: string, targetId: string, metricId: HeldMetric, baseline: number, preview: number];

/** Each held invariant at its tolerance edge: a figure just inside admits, and just outside blocks. */
const ADMITTED_ROWS: AdmissionRow[] = [
    // A bound up lets the preview get quieter freely and louder by at most its tolerance.
    ["don't make it louder", 'master', 'integratedLoudness', -20, -22],
    ["don't make it louder", 'master', 'integratedLoudness', -20, -19.6],
    // A bound down mirrors it.
    ["don't make it quieter", 'master', 'integratedLoudness', -20, -18],
    ["don't make it quieter", 'master', 'integratedLoudness', -20, -20.4],
    // A two-way clause holds both directions.
    ["don't make the mix louder or quieter", 'master', 'integratedLoudness', -20, -19.6],
    ["don't make the mix louder or quieter", 'master', 'integratedLoudness', -20, -20.4],
    ['keep the stereo width of the Vocal', 'vocal', 'sideEnergyFraction', 0.3, 0.309],
    ['keep the stereo width of the Vocal', 'vocal', 'sideEnergyFraction', 0.3, 0.291],
    ['keep the dynamics of the Vocal', 'vocal', 'crestFactor', 12, 12.9],
    ['keep the dynamics of the Vocal', 'vocal', 'crestFactor', 12, 11.1],
    ['keep the brightness of the Bass', 'bass', 'spectralCentroid', 1000, 1049],
    ['keep the brightness of the Bass', 'bass', 'spectralCentroid', 1000, 951],
    // Exactly at each tolerance, in figures exact in binary floating point.
    ['keep the dynamics of the Vocal', 'vocal', 'crestFactor', 12, 13],
    ['keep the dynamics of the Vocal', 'vocal', 'crestFactor', 12, 11],
    ['keep the stereo width of the Vocal', 'vocal', 'sideEnergyFraction', 0.01, 0.02],
    ['keep the stereo width of the Vocal', 'vocal', 'sideEnergyFraction', 0.02, 0.01],
    ['keep the brightness of the Bass', 'bass', 'spectralCentroid', 1000, 1050],
    ['keep the brightness of the Bass', 'bass', 'spectralCentroid', 1000, 950],
    ["don't make it louder", 'master', 'integratedLoudness', -20, -19.5],
    ["don't make it quieter", 'master', 'integratedLoudness', -20, -20.5],
    // Each one-way width, brightness and dynamics bound moves freely the allowed way, by at most its
    // family's hold tolerance the forbidden way, and exactly at that tolerance.
    ["don't make the mix any wider", 'master', 'sideEnergyFraction', 0.3, 0.1],
    ["don't make the mix any wider", 'master', 'sideEnergyFraction', 0.3, 0.309],
    ["don't make the mix any wider", 'master', 'sideEnergyFraction', 0.01, 0.02],
    ["don't make the mix any narrower", 'master', 'sideEnergyFraction', 0.3, 0.6],
    ["don't make the mix any narrower", 'master', 'sideEnergyFraction', 0.3, 0.291],
    ["don't make the mix any narrower", 'master', 'sideEnergyFraction', 0.02, 0.01],
    ["don't make the mix any brighter", 'master', 'spectralCentroid', 1000, 400],
    ["don't make the mix any brighter", 'master', 'spectralCentroid', 1000, 1049],
    ["don't make the mix any brighter", 'master', 'spectralCentroid', 1000, 1050],
    ["don't make the mix any darker", 'master', 'spectralCentroid', 1000, 3000],
    ["don't make the mix any darker", 'master', 'spectralCentroid', 1000, 951],
    ["don't make the mix any darker", 'master', 'spectralCentroid', 1000, 950],
    ["don't make the mix more dynamic", 'master', 'crestFactor', 12, 4],
    ["don't make the mix more dynamic", 'master', 'crestFactor', 12, 12.9],
    ["don't make the mix more dynamic", 'master', 'crestFactor', 12, 13],
    ["don't squash the mix", 'master', 'crestFactor', 12, 20],
    ["don't squash the mix", 'master', 'crestFactor', 12, 11.1],
    ["don't squash the mix", 'master', 'crestFactor', 12, 11],
];
const BLOCKED_ROWS: AdmissionRow[] = [
    ["don't make it louder", 'master', 'integratedLoudness', -20, -19.4],
    ["don't make it quieter", 'master', 'integratedLoudness', -20, -20.6],
    ["don't make the mix louder or quieter", 'master', 'integratedLoudness', -20, -19.4],
    ["don't make the mix louder or quieter", 'master', 'integratedLoudness', -20, -20.6],
    ['keep the stereo width of the Vocal', 'vocal', 'sideEnergyFraction', 0.3, 0.311],
    ['keep the stereo width of the Vocal', 'vocal', 'sideEnergyFraction', 0.3, 0.289],
    ['keep the dynamics of the Vocal', 'vocal', 'crestFactor', 12, 13.1],
    ['keep the dynamics of the Vocal', 'vocal', 'crestFactor', 12, 10.9],
    ['keep the brightness of the Bass', 'bass', 'spectralCentroid', 1000, 1051],
    ['keep the brightness of the Bass', 'bass', 'spectralCentroid', 1000, 949],
    // Just past each tolerance, by less than 1% of it.
    ['keep the dynamics of the Vocal', 'vocal', 'crestFactor', 12, 13.0078125],
    ['keep the dynamics of the Vocal', 'vocal', 'crestFactor', 12, 10.9921875],
    ['keep the stereo width of the Vocal', 'vocal', 'sideEnergyFraction', 0.01, 0.02005],
    ['keep the stereo width of the Vocal', 'vocal', 'sideEnergyFraction', 0.02, 0.00995],
    ['keep the brightness of the Bass', 'bass', 'spectralCentroid', 1000, 1050.25],
    ['keep the brightness of the Bass', 'bass', 'spectralCentroid', 1000, 949.75],
    ["don't make it louder", 'master', 'integratedLoudness', -20, -19.4921875],
    ["don't make it quieter", 'master', 'integratedLoudness', -20, -20.5078125],
    // The forbidden way, past each tolerance and just past it.
    ["don't make the mix any wider", 'master', 'sideEnergyFraction', 0.3, 0.311],
    ["don't make the mix any wider", 'master', 'sideEnergyFraction', 0.01, 0.02005],
    ["don't make the mix any narrower", 'master', 'sideEnergyFraction', 0.3, 0.289],
    ["don't make the mix any narrower", 'master', 'sideEnergyFraction', 0.02, 0.00995],
    ["don't make the mix any brighter", 'master', 'spectralCentroid', 1000, 1051],
    ["don't make the mix any brighter", 'master', 'spectralCentroid', 1000, 1050.25],
    ["don't make the mix any darker", 'master', 'spectralCentroid', 1000, 949],
    ["don't make the mix any darker", 'master', 'spectralCentroid', 1000, 949.75],
    ["don't make the mix more dynamic", 'master', 'crestFactor', 12, 13.1],
    ["don't make the mix more dynamic", 'master', 'crestFactor', 12, 13.0078125],
    ["don't squash the mix", 'master', 'crestFactor', 12, 10.9],
    ["don't squash the mix", 'master', 'crestFactor', 12, 10.9921875],
];

/** The batch the clause rides, compiled for real, then admitted against one proof of the given figures. */
function admitHeldFigures([clause, targetId, metricId, baseline, preview]: AdmissionRow) {
    const { compiled, state } = compiledState(`Lower the trim but ${clause}`);
    expect(
        state.authorities.flatMap((authority) => authority.goals.map((goal) => [goal.metricId, goal.targetIds]))
    ).toEqual([[metricId, [targetId]]]);
    return evaluateMetricGoalAdmission({
        state: withFigures(state, targetId, metricId, { baseline, preview }),
        commandBatch: compiled.commandBatch,
        currentRevision: captureProjectRevision(),
    });
}

describe('measured holds and bounds at admission', () => {
    it.each(ADMITTED_ROWS)('under "%s", admits %s %s moving from %d to %d', (...row) => {
        expect(admitHeldFigures(row)).toMatchObject({ status: 'verified', failure: null });
    });

    it.each(BLOCKED_ROWS)('under "%s", blocks %s %s moving from %d to %d', (...row) => {
        const evaluation = admitHeldFigures(row);
        expect(evaluation).toMatchObject({ status: 'blocked', failure: 'out-of-tolerance' });
        expect(evaluation.reason).toContain(`The preview breaks “${row[0]}”`);
    });

    it('names the direction a bound was broken in', () => {
        const { compiled, state } = compiledState("Lower the trim but don't make it louder");
        const evaluation = evaluateMetricGoalAdmission({
            state: withFigures(state, 'master', 'integratedLoudness', { baseline: -20, preview: -19 }),
            commandBatch: compiled.commandBatch,
        });
        expect(evaluation.reason).toMatch(
            /integrated loudness on .* rose from -20 to -19 LUFS, a movement of 1 LUFS, beyond its 0\.5 LUFS tolerance/u
        );
    });

    it('prints a bound broken by a hair at endpoints that differ by more than the tolerance', () => {
        const { compiled, state } = compiledState("Lower the trim but don't make it louder");
        const evaluation = evaluateMetricGoalAdmission({
            state: withFigures(state, 'master', 'integratedLoudness', { baseline: -14, preview: -13.4996 }),
            commandBatch: compiled.commandBatch,
        });
        expect(evaluation.reason).toMatch(
            /integrated loudness on .* rose from -14 to -13\.4996 LUFS, a movement of 0\.5004 LUFS, beyond its 0\.5 LUFS tolerance/u
        );
    });

    it('names the fall that broke a bound down', () => {
        const { compiled, state } = compiledState("Lower the trim but don't make it quieter");
        const evaluation = evaluateMetricGoalAdmission({
            state: withFigures(state, 'master', 'integratedLoudness', { baseline: -20, preview: -21 }),
            commandBatch: compiled.commandBatch,
        });
        expect(evaluation.reason).toMatch(
            /integrated loudness on .* fell from -20 to -21 LUFS, a movement of 1 LUFS, beyond its 0\.5 LUFS tolerance/u
        );
    });

    it('refuses a bound goal stored as a hold, since its invariant states only the bound', () => {
        const { compiled, state } = compiledState("Lower the trim but don't make it louder");
        const tampered: MetricGoalState = {
            ...state,
            authorities: state.authorities.map((authority) => ({
                ...authority,
                goals: authority.goals.map((goal) => ({ ...goal, relation: 'hold' as const })),
            })),
        };
        expect(
            evaluateMetricGoalAdmission({
                state: withFigures(tampered, 'master', 'integratedLoudness', { baseline: -20, preview: -22 }),
                commandBatch: compiled.commandBatch,
            })
        ).toMatchObject({
            status: 'blocked',
            failure: 'incomparable',
            reason: 'The constraint criterion does not use its versioned perceptual invariant.',
        });
    });

    it('takes no edit dimension away: an edit no reader places stays admitted under a measured hold', () => {
        const sidechain: AppAction = {
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 'bass', targetTrackId: 'vocal' },
        };
        const ghostPoint: AppAction = {
            type: 'addAutomationPoint',
            payload: { laneId: 'ghost-lane', beat: 0, value: 0.8 },
        };
        const context = getProjectContext();
        expect(readExcludedEdit("Duck the Vocal but don't make the Vocal louder", [sidechain], context)).toBeNull();
        expect(readExcludedEdit("Duck the Vocal but don't change the level", [ghostPoint], context)).toBeNull();
        expect(readExcludedEdit('Duck the Vocal but keep the vocal intimate', [sidechain], context)).toContain(
            'cannot show leaves its ambience alone'
        );
    });
});

describe('stored bound goals', () => {
    it('round-trips a state carrying both bounds', () => {
        const { compiled, state } = compiledState(
            "Lower the trim but don't make it louder and don't make the Vocal quieter"
        );
        expect(
            state.authorities.flatMap((authority) => authority.goals.map((goal) => [goal.relation, goal.targetIds]))
        ).toEqual([
            ['no-increase', ['master']],
            ['no-decrease', ['vocal']],
        ]);
        expect(metricGoalStateCodec(JSON.stringify(state))).toEqual(state);
        expect(metricGoalStateCodec(compiled.metricGoalState)).toEqual(JSON.parse(compiled.metricGoalState ?? 'null'));
    });

    it.each([
        ["don't make the mix any wider", 'no-increase'],
        ["don't make the mix any narrower", 'no-decrease'],
        ["don't make the mix any brighter", 'no-increase'],
        ["don't make the mix any darker", 'no-decrease'],
        ["don't make the mix more dynamic", 'no-increase'],
        ["don't squash the mix", 'no-decrease'],
    ])('round-trips a state carrying the bound "%s"', (clause, relation) => {
        const { compiled, state } = compiledState(`Lower the trim but ${clause}`);
        expect(state.authorities.flatMap((authority) => authority.goals.map((goal) => goal.relation))).toEqual([
            relation,
        ]);
        expect(metricGoalStateCodec(JSON.stringify(state))).toEqual(state);
        expect(metricGoalStateCodec(compiled.metricGoalState)).toEqual(JSON.parse(compiled.metricGoalState ?? 'null'));
    });

    it('reads a hold-only state stored before the bounds existed exactly as it was written', () => {
        const { compiled } = compiledState('Lower the Vocal Trim and keep the vocal intimate');
        const decoded = metricGoalStateCodec(compiled.metricGoalState);
        expect(decoded?.authorities.flatMap((authority) => authority.goals.map((goal) => goal.relation))).toEqual([
            'hold',
            'hold',
        ]);
        expect(decoded).toEqual(JSON.parse(compiled.metricGoalState ?? 'null'));
    });

    it('still refuses a relation outside the contract', () => {
        const { state } = compiledState("Lower the trim but don't make it louder");
        const unknown = JSON.stringify(state).replace('"no-increase"', '"no-change"');
        expect(unknown).toContain('"no-change"');
        expect(metricGoalStateCodec(unknown)).toBeNull();
    });

    it('reads a movement against a bound on the same axis as a contradiction, and the free direction as none', () => {
        const { state } = compiledState("Lower the trim but don't make it louder and don't make the Vocal quieter");
        const goals = state.authorities.flatMap((authority) => authority.goals);
        const [notRaised, notLowered] = goals;
        if (notRaised === undefined || notLowered === undefined) {
            throw new Error('Expected both bounds.');
        }
        const moving = (goal: MetricGoal, relation: 'increase' | 'decrease'): MetricGoal => ({
            ...goal,
            goalId: `${goal.goalId}:moving`,
            relation,
            source: { kind: 'unsupported' },
        });
        expect(hasContradictoryMetricGoals([notRaised, moving(notRaised, 'increase')])).toBe(true);
        expect(hasContradictoryMetricGoals([notRaised, moving(notRaised, 'decrease')])).toBe(false);
        expect(hasContradictoryMetricGoals([notLowered, moving(notLowered, 'decrease')])).toBe(true);
        expect(hasContradictoryMetricGoals([notLowered, moving(notLowered, 'increase')])).toBe(false);
    });
});

describe('the card a constraint criterion is shown on', () => {
    it('adds no unmeasured-clause line to a batch that changes sound, whose criteria already state it', () => {
        const { content } = describePendingActionConfirmation({
            actions: [setParameter('vocal-trim', 'gain-level', -1)],
            context: getProjectContext(),
            prompt: 'Lower the Vocal Trim and keep it warm',
        });
        expect(
            compilePerceptualConstraints('Lower the Vocal Trim and keep it warm', getProjectContext()).unsupported
        ).toHaveLength(1);
        expect(content).not.toContain('Not measured:');
    });

    function criterionTexts(prompt: string): string[] {
        const compiled = compile(prompt, [setParameter('vocal-trim', 'gain-level', -1)]);
        if (compiled.agentApproval === null) {
            throw new Error('Expected a confirmation approval.');
        }
        const parsed = parseVersionedCommandBatchEnvelope(
            compiled.commandBatch.serialized,
            compiled.commandBatch.authority
        );
        if (parsed.status !== 'valid') {
            throw new Error(parsed.reason);
        }
        const confirmationId = persistPromptActionConfirmation({
            runId: RUN_ID,
            prompt,
            assistantMessageId: 'constraint-assistant',
            actions: [setParameter('vocal-trim', 'gain-level', -1)],
            actionLabels: ['setDeviceParameter'],
            commandEnvelopes: compiled.commandEnvelopes,
            commandBatch: compiled.commandBatch,
            agentApproval: compiled.agentApproval,
            metricGoalState: compiled.metricGoalState,
            affectedIds: ['vocal'],
            protectedUnchanged: [],
            executionMode: 'atomic',
            group: { groupId: 'perceptual-constraint-group', groupLabel: prompt },
            projectRevision: captureProjectRevision(),
            parsedCommandBatch: parsed,
            content: 'Constraint proposal',
        });
        if (confirmationId === null) {
            throw new Error('Expected a retained proposal.');
        }
        return (
            getAgentApprovalView({ confirmationId })?.metricGoals.criteria.map(
                (criterion) => criterion.criterionText
            ) ?? []
        );
    }

    it('states a bound as the one direction it limits, with its tolerance and unit', () => {
        expect(criterionTexts("Lower the trim but don't make it louder")).toEqual([
            expect.stringMatching(
                /^Constraint “don't make it louder”: integrated loudness on “Master output”, beats 0–4, must not rise by more than 0\.5 LUFS\. /u
            ),
        ]);
    });

    it.each([
        [
            'Lower the trim and keep the stereo width',
            /^Constraint “keep the stereo width”: side energy fraction on “Master output”, beats 0–4, must stay equal within 0\.01 ratio\. /u,
        ],
        [
            'Lower the trim and keep the brightness',
            /^Constraint “keep the brightness”: spectral centroid on “Master output”, beats 0–4, must stay equal within 50 Hz\. /u,
        ],
        [
            "Lower the trim but don't make it quieter",
            /^Constraint “don't make it quieter”: integrated loudness on “Master output”, beats 0–4, must not fall by more than 0\.5 LUFS\. /u,
        ],
    ])('states the tolerance and unit of the hold or bound under "%s"', (prompt, text) => {
        expect(criterionTexts(prompt)).toEqual([expect.stringMatching(text)]);
    });

    it('quotes a clause nothing measures and says so, with no empty subject', () => {
        expect(criterionTexts('Lower the Vocal Trim and keep it warm')).toEqual([
            'Constraint “keep it warm”: nothing the application measures shows that it holds, so this batch cannot be approved as verified.',
        ]);
    });
});
