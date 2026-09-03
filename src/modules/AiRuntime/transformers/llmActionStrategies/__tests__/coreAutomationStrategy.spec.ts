import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type RuntimeAction } from '../../../models/RuntimeAction';
import {
    bridgeCoreAutomationToolCall,
    coreAutomationActionNames,
    coreAutomationStrategyRegistry,
    type CoreAutomationCallName,
} from '../coreAutomationStrategy';

const laneId = 'lane-vocal-gain';
const rejectionReasons = {
    addAutomationLane: 'Expected an available track and one new gain or pan automation lane',
    addAutomationPoint:
        'Expected an existing automation lane, an unused non-negative beat, and a value within lane bounds',
    setAutomationLaneEnabled: 'Expected an existing automation lane and a changed boolean enabled value',
    setAutomationMode: 'Expected an existing track and a changed automation mode',
    scaleAutomation: 'Expected a populated automation lane and a changed factor above 0 and at most 16',
    stretchAutomation:
        'Expected an automation lane with at least two points and a changed factor above 0 and at most 16',
    invertAutomation: 'Expected a populated automation lane',
    reverseAutomation: 'Expected an automation lane with at least two points',
    thinAutomation:
        'Expected an automation lane with more than two points and a positive tolerance within its value span',
    quantizeAutomation: 'Expected a populated lane and a changed beat grid above 0 and at most 64',
} as const;

function createTrack(id: string, automationMode: ProjectContext['tracks'][number]['automationMode'] = 'read') {
    return {
        id,
        name: id,
        kind: 'audio' as const,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode,
        vcaGroupId: null,
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

const projectContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 8,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 8,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [createTrack('track-vocals'), createTrack('track-drums')],
    automationLanes: [
        {
            id: laneId,
            trackId: 'track-vocals',
            parameterId: 'gain',
            name: 'Gain',
            enabled: true,
            minValue: 0,
            maxValue: 1,
            points: [
                { beat: 0.25, value: 0.2, curve: 'linear' },
                { beat: 2.25, value: 0.5, curve: 'linear' },
                { beat: 4.25, value: 0.8, curve: 'linear' },
            ],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'automation',
    playheadPosition: 0,
};

function bridge(call: { arguments: Record<string, unknown>; name: string }, context: ProjectContext = projectContext) {
    return bridgeCoreAutomationToolCall({ call, context, index: 11 });
}

function expectRejected(
    name: CoreAutomationCallName,
    argumentsPayload: Record<string, unknown>,
    reason: string = rejectionReasons[name],
    context = projectContext
) {
    expect(bridge({ name, arguments: argumentsPayload }, context)).toEqual({ index: 11, name, reason });
}

type ExactKeyCase<Name extends CoreAutomationCallName> = {
    [StrategyName in Name]: {
        action: Extract<RuntimeAction, { type: StrategyName }>;
        arguments: Record<string, unknown>;
        name: StrategyName;
    };
}[Name];

const exactKeyCases = [
    {
        name: 'addAutomationLane',
        arguments: { trackId: 'track-drums', parameterId: 'pan' },
        action: {
            type: 'addAutomationLane',
            payload: { trackId: 'track-drums', parameterId: 'pan', parameterName: 'Pan' },
        },
    },
    {
        name: 'addAutomationPoint',
        arguments: { laneId, beat: 8, value: 0.4, curve: 'smooth' },
        action: { type: 'addAutomationPoint', payload: { laneId, beat: 8, value: 0.4, curve: 'smooth' } },
    },
    {
        name: 'setAutomationLaneEnabled',
        arguments: { laneId, enabled: false },
        action: { type: 'setAutomationLaneEnabled', payload: { laneId, enabled: false } },
    },
    {
        name: 'setAutomationMode',
        arguments: { trackId: 'track-vocals', mode: 'touch' },
        action: { type: 'setAutomationMode', payload: { trackId: 'track-vocals', mode: 'touch' } },
    },
    {
        name: 'scaleAutomation',
        arguments: { laneId, factor: 1.5 },
        action: { type: 'scaleAutomation', payload: { laneId, factor: 1.5 } },
    },
    {
        name: 'stretchAutomation',
        arguments: { laneId, factor: 2 },
        action: { type: 'stretchAutomation', payload: { laneId, factor: 2 } },
    },
    {
        name: 'invertAutomation',
        arguments: { laneId },
        action: { type: 'invertAutomation', payload: { laneId } },
    },
    {
        name: 'reverseAutomation',
        arguments: { laneId },
        action: { type: 'reverseAutomation', payload: { laneId } },
    },
    {
        name: 'thinAutomation',
        arguments: { laneId, tolerance: 0.25 },
        action: { type: 'thinAutomation', payload: { laneId, tolerance: 0.25 } },
    },
    {
        name: 'quantizeAutomation',
        arguments: { laneId, gridSize: 1 },
        action: { type: 'quantizeAutomation', payload: { laneId, gridSize: 1 } },
    },
] as const satisfies readonly ExactKeyCase<CoreAutomationCallName>[];

type ExactKeyCaseName = (typeof exactKeyCases)[number]['name'];
type AllExactKeyGuardsCovered = Exclude<CoreAutomationCallName, ExactKeyCaseName> extends never ? true : never;

function assertAllExactKeyGuardsCovered(
    cases: AllExactKeyGuardsCovered extends true ? typeof exactKeyCases : never
): typeof exactKeyCases {
    return cases;
}

describe('coreAutomationStrategy', () => {
    it('registers every core automation strategy exactly once and delegates unrelated calls', () => {
        expect([...coreAutomationStrategyRegistry.keys()]).toEqual(coreAutomationActionNames);
        expect(bridge({ name: 'setTempo', arguments: { bpm: 128 } })).toBeNull();
    });

    it('grounds each strategy as its exact RuntimeAction and rejects extra arguments', () => {
        for (const testCase of assertAllExactKeyGuardsCovered(exactKeyCases)) {
            expect(bridge({ name: testCase.name, arguments: testCase.arguments })).toEqual(testCase.action);
            expectRejected(testCase.name, { ...testCase.arguments, unexpected: true });
            expectRejected(testCase.name, {});
        }
    });

    it('admits only available gain or pan lanes and a non-duplicate target', () => {
        for (const argumentsPayload of [
            { trackId: 'missing', parameterId: 'gain' },
            { trackId: 'track-drums', parameterId: 'mute' },
            { trackId: true, parameterId: 'gain' },
            { trackId: 'track-vocals', parameterId: 'gain' },
        ]) {
            expectRejected('addAutomationLane', argumentsPayload);
        }
    });

    it('requires a unique finite point inside finite lane bounds and an admitted curve', () => {
        expect(bridge({ name: 'addAutomationPoint', arguments: { laneId, beat: 8, value: 0 } })).toEqual({
            type: 'addAutomationPoint',
            payload: { laneId, beat: 8, value: 0 },
        });
        expect(bridge({ name: 'addAutomationPoint', arguments: { laneId, beat: 8, value: 1 } })).toEqual({
            type: 'addAutomationPoint',
            payload: { laneId, beat: 8, value: 1 },
        });
        for (const curve of ['linear', 'step', 'exponential', 's-curve', 'stairs', 'smooth', 'bezier'] as const) {
            expect(bridge({ name: 'addAutomationPoint', arguments: { laneId, beat: 8, value: 0.5, curve } })).toEqual({
                type: 'addAutomationPoint',
                payload: { laneId, beat: 8, value: 0.5, curve },
            });
        }
        expectRejected(
            'addAutomationPoint',
            { laneId, beat: 8, value: 0.5, curve: 'invalid' },
            'Expected one supported automation curve'
        );
        for (const argumentsPayload of [
            { laneId: 'missing', beat: 8, value: 0.5 },
            { laneId, beat: -0.1, value: 0.5 },
            { laneId, beat: '8', value: 0.5 },
            { laneId, beat: true, value: 0.5 },
            { laneId, beat: Number.NaN, value: 0.5 },
            { laneId, beat: 8, value: '0.5' },
            { laneId, beat: 8, value: true },
            { laneId, beat: 8, value: Number.POSITIVE_INFINITY },
            { laneId, beat: 8, value: -0.01 },
            { laneId, beat: 8, value: 1.01 },
            { laneId, beat: 0.25, value: 0.5 },
        ]) {
            expectRejected('addAutomationPoint', argumentsPayload);
        }
        expectRejected('addAutomationPoint', { laneId, beat: 8, value: 0.5 }, rejectionReasons.addAutomationPoint, {
            ...projectContext,
            automationLanes: [{ ...projectContext.automationLanes![0]!, minValue: Number.NaN }],
        });
        expectRejected('addAutomationPoint', { laneId, beat: 8, value: 0.5 }, rejectionReasons.addAutomationPoint, {
            ...projectContext,
            automationLanes: [{ ...projectContext.automationLanes![0]!, maxValue: Number.POSITIVE_INFINITY }],
        });
    });

    it('requires changed boolean lane enablement and a changed supported track mode', () => {
        expect(
            bridge(
                { name: 'setAutomationLaneEnabled', arguments: { laneId, enabled: true } },
                {
                    ...projectContext,
                    automationLanes: [{ ...projectContext.automationLanes![0]!, enabled: false }],
                }
            )
        ).toEqual({
            type: 'setAutomationLaneEnabled',
            payload: { laneId, enabled: true },
        });
        for (const argumentsPayload of [
            { laneId: 'missing', enabled: false },
            { laneId, enabled: 'false' },
            { laneId, enabled: 0 },
            { laneId, enabled: true },
        ]) {
            expectRejected('setAutomationLaneEnabled', argumentsPayload);
        }
        const modeCases = [
            { current: 'off', requested: 'read' },
            { current: 'read', requested: 'write' },
            { current: 'read', requested: 'touch' },
            { current: 'read', requested: 'latch' },
            { current: 'read', requested: 'off' },
        ] as const;
        for (const { current, requested } of modeCases) {
            const context = {
                ...projectContext,
                tracks: [createTrack('track-vocals', current), createTrack('track-drums')],
            };
            expect(
                bridge({ name: 'setAutomationMode', arguments: { trackId: 'track-vocals', mode: requested } }, context)
            ).toEqual({
                type: 'setAutomationMode',
                payload: { trackId: 'track-vocals', mode: requested },
            });
        }
        for (const argumentsPayload of [
            { trackId: 'missing', mode: 'touch' },
            { trackId: 'track-vocals', mode: 'invalid' },
            { trackId: 'track-vocals', mode: true },
            { trackId: 'track-vocals', mode: 'read' },
        ]) {
            expectRejected('setAutomationMode', argumentsPayload);
        }
    });

    it('requires changed finite scale and stretch factors inside their inclusive maximum', () => {
        expect(bridge({ name: 'scaleAutomation', arguments: { laneId, factor: 16 } })).toEqual({
            type: 'scaleAutomation',
            payload: { laneId, factor: 16 },
        });
        expect(bridge({ name: 'scaleAutomation', arguments: { laneId, factor: 0.5 } })).toEqual({
            type: 'scaleAutomation',
            payload: { laneId, factor: 0.5 },
        });
        expect(bridge({ name: 'stretchAutomation', arguments: { laneId, factor: 16 } })).toEqual({
            type: 'stretchAutomation',
            payload: { laneId, factor: 16 },
        });
        expect(bridge({ name: 'stretchAutomation', arguments: { laneId, factor: 0.5 } })).toEqual({
            type: 'stretchAutomation',
            payload: { laneId, factor: 0.5 },
        });
        for (const name of ['scaleAutomation', 'stretchAutomation'] as const) {
            for (const factor of [0, -0.01, 16.01, 1, Number.NaN, '2', true]) {
                expectRejected(name, { laneId, factor });
            }
        }
        expectRejected('scaleAutomation', { laneId, factor: 2 }, rejectionReasons.scaleAutomation, {
            ...projectContext,
            automationLanes: [{ ...projectContext.automationLanes![0]!, points: [] }],
        });
        expectRejected('stretchAutomation', { laneId, factor: 2 }, rejectionReasons.stretchAutomation, {
            ...projectContext,
            automationLanes: [
                { ...projectContext.automationLanes![0]!, points: [{ beat: 0, value: 0.5, curve: 'linear' }] },
            ],
        });
        expectRejected('scaleAutomation', { laneId, factor: 2 }, rejectionReasons.scaleAutomation, {
            ...projectContext,
            automationLanes: [
                {
                    ...projectContext.automationLanes![0]!,
                    points: [{ beat: 0, value: 1, curve: 'linear' }],
                },
            ],
        });
    });

    it('requires populated lanes for inversion, at least two points for reversal, and valid optional thinning', () => {
        const emptyContext: ProjectContext = {
            ...projectContext,
            automationLanes: [{ ...projectContext.automationLanes![0]!, points: [] }],
        };
        const onePointContext: ProjectContext = {
            ...projectContext,
            automationLanes: [
                { ...projectContext.automationLanes![0]!, points: [{ beat: 0, value: 0.5, curve: 'linear' }] },
            ],
        };
        expectRejected('invertAutomation', { laneId }, rejectionReasons.invertAutomation, emptyContext);
        expectRejected('reverseAutomation', { laneId }, rejectionReasons.reverseAutomation, onePointContext);
        expectRejected('thinAutomation', { laneId }, rejectionReasons.thinAutomation, {
            ...projectContext,
            automationLanes: [
                {
                    ...projectContext.automationLanes![0]!,
                    points: projectContext.automationLanes![0]!.points.slice(0, 2),
                },
            ],
        });
        expect(bridge({ name: 'thinAutomation', arguments: { laneId } })).toEqual({
            type: 'thinAutomation',
            payload: { laneId },
        });
        for (const tolerance of [0, -0.01, 1.01, Number.NaN, '0.1', true]) {
            expectRejected('thinAutomation', { laneId, tolerance });
        }
    });

    it('requires a populated lane and a changed finite quantize grid through its inclusive maximum', () => {
        expect(bridge({ name: 'quantizeAutomation', arguments: { laneId, gridSize: 64 } })).toEqual({
            type: 'quantizeAutomation',
            payload: { laneId, gridSize: 64 },
        });
        expect(bridge({ name: 'quantizeAutomation', arguments: { laneId, gridSize: 0.5 } })).toEqual({
            type: 'quantizeAutomation',
            payload: { laneId, gridSize: 0.5 },
        });
        for (const gridSize of [0, -0.01, 64.01, Number.NaN, '1', true]) {
            expectRejected('quantizeAutomation', { laneId, gridSize });
        }
        expectRejected('quantizeAutomation', { laneId, gridSize: 1 }, rejectionReasons.quantizeAutomation, {
            ...projectContext,
            automationLanes: [
                { ...projectContext.automationLanes![0]!, points: [{ beat: 0, value: 0.5, curve: 'linear' }] },
            ],
        });
        expectRejected('quantizeAutomation', { laneId, gridSize: 1 }, rejectionReasons.quantizeAutomation, {
            ...projectContext,
            automationLanes: [{ ...projectContext.automationLanes![0]!, points: [] }],
        });
    });
});
