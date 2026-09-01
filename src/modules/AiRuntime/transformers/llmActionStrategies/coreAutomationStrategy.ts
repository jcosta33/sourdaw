import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { type LlmActionRejection } from '../llmActionBridgeContracts';
import { type ToolCallResult } from '../toolCallParser';

import { createLlmActionStrategyRegistry } from './createLlmActionStrategyRegistry';

export const coreAutomationActionNames = [
    'addAutomationLane',
    'addAutomationPoint',
    'setAutomationLaneEnabled',
    'setAutomationMode',
    'scaleAutomation',
    'stretchAutomation',
    'invertAutomation',
    'reverseAutomation',
    'thinAutomation',
    'quantizeAutomation',
] as const satisfies readonly Extract<RuntimeActionType, string>[];

export type CoreAutomationCallName = (typeof coreAutomationActionNames)[number];

type CoreAutomationStrategyInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
};

type CoreAutomationStrategy<Name extends CoreAutomationCallName> = (
    input: CoreAutomationStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

type CoreAutomationStrategyDefinition<Name extends CoreAutomationCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: CoreAutomationStrategy<StrategyName>;
    };
}[Name];

const automationLaneDisplayNameByParameterId = {
    gain: 'Gain',
    pan: 'Pan',
} as const;

type ExecutableAutomationParameterId = keyof typeof automationLaneDisplayNameByParameterId;
type ProviderAutomationMode = NonNullable<ProjectContext['tracks'][number]['automationMode']>;

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isExecutableAutomationParameterId(value: unknown): value is ExecutableAutomationParameterId {
    return typeof value === 'string' && Object.hasOwn(automationLaneDisplayNameByParameterId, value);
}

function findAutomationLane(context: ProjectContext, laneId: unknown) {
    if (typeof laneId !== 'string') {
        return undefined;
    }
    return (context.automationLanes ?? []).find((lane) => lane.id === laneId);
}

function wouldScaleAutomationChange(
    lane: NonNullable<ProjectContext['automationLanes']>[number],
    factor: number
): boolean {
    return lane.points.some((point) => {
        const scaledValue = Math.min(lane.maxValue, Math.max(lane.minValue, point.value * factor));
        return scaledValue !== point.value;
    });
}

function isProviderAutomationCurve(
    value: unknown
): value is 'linear' | 'step' | 'exponential' | 's-curve' | 'stairs' | 'smooth' | 'bezier' {
    return (
        value === 'linear' ||
        value === 'step' ||
        value === 'exponential' ||
        value === 's-curve' ||
        value === 'stairs' ||
        value === 'smooth' ||
        value === 'bezier'
    );
}

function isProviderAutomationMode(value: unknown): value is ProviderAutomationMode {
    return value === 'read' || value === 'write' || value === 'touch' || value === 'latch' || value === 'off';
}

function findTrack(context: ProjectContext, trackId: unknown) {
    if (typeof trackId !== 'string') {
        return undefined;
    }
    return context.tracks.find((track) => track.id === trackId);
}

function rejection(index: number, name: string, reason: string): LlmActionRejection {
    return { index, name, reason };
}

const coreAutomationStrategyDefinitions = [
    {
        name: 'addAutomationLane',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const track = findTrack(context, args.trackId);
            if (
                !hasExactKeys(args, ['trackId', 'parameterId']) ||
                !track ||
                !isExecutableAutomationParameterId(args.parameterId) ||
                (context.automationLanes ?? []).some(
                    (lane) => lane.trackId === track.id && lane.parameterId === args.parameterId
                )
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an available track and one new gain or pan automation lane'
                );
            }
            return {
                type: 'addAutomationLane',
                payload: {
                    trackId: track.id,
                    parameterId: args.parameterId,
                    parameterName: automationLaneDisplayNameByParameterId[args.parameterId],
                },
            };
        },
    },
    {
        name: 'addAutomationPoint',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const lane = findAutomationLane(context, args.laneId);
            const hasValidKeys =
                hasExactKeys(args, ['laneId', 'beat', 'value']) ||
                hasExactKeys(args, ['laneId', 'beat', 'value', 'curve']);
            if (args.curve !== undefined && !isProviderAutomationCurve(args.curve)) {
                return rejection(index, call.name, 'Expected one supported automation curve');
            }
            if (
                !hasValidKeys ||
                !lane ||
                !isFiniteNumber(args.beat) ||
                args.beat < 0 ||
                !isFiniteNumber(args.value) ||
                !Number.isFinite(lane.minValue) ||
                !Number.isFinite(lane.maxValue) ||
                args.value < lane.minValue ||
                args.value > lane.maxValue ||
                lane.points.some((point) => point.beat === args.beat)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an existing automation lane, an unused non-negative beat, and a value within lane bounds'
                );
            }
            return {
                type: 'addAutomationPoint',
                payload: {
                    laneId: lane.id,
                    beat: args.beat,
                    value: args.value,
                    ...(args.curve === undefined ? {} : { curve: args.curve }),
                },
            };
        },
    },
    {
        name: 'setAutomationLaneEnabled',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const lane = findAutomationLane(context, args.laneId);
            if (
                !hasExactKeys(args, ['laneId', 'enabled']) ||
                !lane ||
                typeof args.enabled !== 'boolean' ||
                args.enabled === lane.enabled
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an existing automation lane and a changed boolean enabled value'
                );
            }
            return { type: 'setAutomationLaneEnabled', payload: { laneId: lane.id, enabled: args.enabled } };
        },
    },
    {
        name: 'setAutomationMode',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const track = findTrack(context, args.trackId);
            if (
                !hasExactKeys(args, ['trackId', 'mode']) ||
                !track ||
                !isProviderAutomationMode(args.mode) ||
                args.mode === track.automationMode
            ) {
                return rejection(index, call.name, 'Expected an existing track and a changed automation mode');
            }
            return { type: 'setAutomationMode', payload: { trackId: track.id, mode: args.mode } };
        },
    },
    {
        name: 'scaleAutomation',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const lane = findAutomationLane(context, args.laneId);
            if (
                !hasExactKeys(args, ['laneId', 'factor']) ||
                !lane ||
                lane.points.length === 0 ||
                !isFiniteNumber(args.factor) ||
                args.factor <= 0 ||
                args.factor > 16 ||
                args.factor === 1 ||
                !wouldScaleAutomationChange(lane, args.factor)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected a populated automation lane and a changed factor above 0 and at most 16'
                );
            }
            return { type: 'scaleAutomation', payload: { laneId: lane.id, factor: args.factor } };
        },
    },
    {
        name: 'stretchAutomation',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const lane = findAutomationLane(context, args.laneId);
            if (
                !hasExactKeys(args, ['laneId', 'factor']) ||
                !lane ||
                lane.points.length < 2 ||
                !isFiniteNumber(args.factor) ||
                args.factor <= 0 ||
                args.factor > 16 ||
                args.factor === 1
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an automation lane with at least two points and a changed factor above 0 and at most 16'
                );
            }
            return { type: 'stretchAutomation', payload: { laneId: lane.id, factor: args.factor } };
        },
    },
    {
        name: 'invertAutomation',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const lane = findAutomationLane(context, args.laneId);
            if (!hasExactKeys(args, ['laneId']) || !lane || lane.points.length === 0) {
                return rejection(index, call.name, 'Expected a populated automation lane');
            }
            return { type: 'invertAutomation', payload: { laneId: lane.id } };
        },
    },
    {
        name: 'reverseAutomation',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const lane = findAutomationLane(context, args.laneId);
            if (!hasExactKeys(args, ['laneId']) || !lane || lane.points.length < 2) {
                return rejection(index, call.name, 'Expected an automation lane with at least two points');
            }
            return { type: 'reverseAutomation', payload: { laneId: lane.id } };
        },
    },
    {
        name: 'thinAutomation',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const lane = findAutomationLane(context, args.laneId);
            const hasValidKeys = hasExactKeys(args, ['laneId']) || hasExactKeys(args, ['laneId', 'tolerance']);
            const tolerance = args.tolerance ?? 0.01;
            const laneSpan = lane ? lane.maxValue - lane.minValue : 0;
            if (
                !hasValidKeys ||
                !lane ||
                lane.points.length <= 2 ||
                !isFiniteNumber(tolerance) ||
                tolerance <= 0 ||
                !Number.isFinite(laneSpan) ||
                tolerance > laneSpan
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an automation lane with more than two points and a positive tolerance within its value span'
                );
            }
            return {
                type: 'thinAutomation',
                payload: { laneId: lane.id, ...(args.tolerance === undefined ? {} : { tolerance }) },
            };
        },
    },
    {
        name: 'quantizeAutomation',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const lane = findAutomationLane(context, args.laneId);
            const gridSize = args.gridSize;
            if (
                !hasExactKeys(args, ['laneId', 'gridSize']) ||
                !lane ||
                lane.points.length === 0 ||
                !isFiniteNumber(gridSize) ||
                gridSize <= 0 ||
                gridSize > 64 ||
                lane.points.every((point) => Math.round(point.beat / gridSize) * gridSize === point.beat)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected a populated lane and a changed beat grid above 0 and at most 64'
                );
            }
            return { type: 'quantizeAutomation', payload: { laneId: lane.id, gridSize } };
        },
    },
] as const satisfies readonly CoreAutomationStrategyDefinition<CoreAutomationCallName>[];

export const coreAutomationStrategyRegistry = createLlmActionStrategyRegistry<
    CoreAutomationCallName,
    CoreAutomationStrategyInput,
    RuntimeAction | LlmActionRejection
>(coreAutomationStrategyDefinitions, coreAutomationActionNames);

function isCoreAutomationCallName(value: string): value is CoreAutomationCallName {
    return coreAutomationActionNames.some((actionName) => actionName === value);
}

export function bridgeCoreAutomationToolCall(
    input: CoreAutomationStrategyInput
): RuntimeAction | LlmActionRejection | null {
    if (!isCoreAutomationCallName(input.call.name)) {
        return null;
    }
    const strategy = coreAutomationStrategyRegistry.get(input.call.name);
    if (!strategy) {
        throw new Error(`Missing LLM action strategy: ${input.call.name}`);
    }
    return strategy(input);
}
