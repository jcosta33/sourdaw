import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { type ToolCallResult } from '../toolCallParser';

export type TransportTimelineCallName = Extract<
    RuntimeActionType,
    | 'setTempo'
    | 'setTimeSignature'
    | 'setPlayback'
    | 'stopPlayback'
    | 'seekPlayhead'
    | 'setLoopEnabled'
    | 'setLoopRegion'
    | 'setPunchIn'
    | 'setPunchOut'
    | 'setPunchEnabled'
    | 'setMetronomeEnabled'
    | 'setMetronomeVolume'
>;

type LlmActionRejection = {
    index: number;
    name: string;
    reason: string;
};

type ProjectPunchRegion = (input: {
    beat: number;
    current: Pick<ProjectContext, 'punchInBeat' | 'punchOutBeat'>;
    edge: 'in' | 'out';
}) => Partial<Pick<ProjectContext, 'punchInBeat' | 'punchOutBeat'>> | null;

type TransportTimelineStrategyInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
    projectPunchRegion: ProjectPunchRegion;
};

type TransportTimelineStrategy<Name extends TransportTimelineCallName> = (
    input: TransportTimelineStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

type LlmActionStrategyDefinition<Name extends TransportTimelineCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: TransportTimelineStrategy<StrategyName>;
    };
}[Name];

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    if (actualKeys.length !== expectedKeys.length) {
        return false;
    }
    return expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isValidTimeSignatureDenominator(value: unknown): value is 2 | 4 | 8 | 16 {
    return value === 2 || value === 4 || value === 8 || value === 16;
}

function rejection(index: number, name: string, reason: string): LlmActionRejection {
    return { index, name, reason };
}

export function createLlmActionStrategyRegistry<Name extends TransportTimelineCallName>(
    definitions: readonly LlmActionStrategyDefinition<Name>[]
): ReadonlyMap<Name, TransportTimelineStrategy<Name>> {
    const registry = new Map<Name, TransportTimelineStrategy<Name>>();
    for (const definition of definitions) {
        if (registry.has(definition.name)) {
            throw new Error(`Duplicate LLM action strategy: ${definition.name}`);
        }
        registry.set(definition.name, definition.transform);
    }
    return registry;
}

const transportTimelineStrategyDefinitions = [
    {
        name: 'setTempo',
        transform: ({ call, index }) => {
            const args = call.arguments;
            if (!hasExactKeys(args, ['bpm']) || !isFiniteNumber(args.bpm) || args.bpm < 20 || args.bpm > 300) {
                return rejection(index, call.name, 'Expected only a finite bpm from 20 through 300');
            }
            return { type: 'setTempo', payload: { bpm: args.bpm } };
        },
    },
    {
        name: 'setTimeSignature',
        transform: ({ call, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['numerator', 'denominator']) ||
                !isFiniteNumber(args.numerator) ||
                !Number.isInteger(args.numerator) ||
                args.numerator < 1 ||
                args.numerator > 32 ||
                !isValidTimeSignatureDenominator(args.denominator)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an integer numerator from 1 through 32 and denominator 2, 4, 8, or 16'
                );
            }
            return { type: 'setTimeSignature', payload: { numerator: args.numerator, denominator: args.denominator } };
        },
    },
    {
        name: 'setPlayback',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (!hasExactKeys(args, ['playing']) || typeof args.playing !== 'boolean') {
                return rejection(index, call.name, 'Expected only a boolean playing value');
            }
            if (args.playing === context.isPlaying) {
                return rejection(
                    index,
                    call.name,
                    'Requested playback state already matches the current transport state'
                );
            }
            return { type: 'setPlayback', payload: { playing: args.playing } };
        },
    },
    {
        name: 'stopPlayback',
        transform: ({ call, index }) => {
            if (!hasExactKeys(call.arguments, [])) {
                return rejection(index, call.name, 'Expected no arguments');
            }
            return { type: 'stopPlayback' };
        },
    },
    {
        name: 'seekPlayhead',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['beat']) ||
                !isFiniteNumber(args.beat) ||
                args.beat < 0 ||
                args.beat === context.playheadPosition
            ) {
                return rejection(index, call.name, 'Expected only a changed finite beat greater than or equal to 0');
            }
            return { type: 'seekPlayhead', payload: { beat: args.beat } };
        },
    },
    {
        name: 'setLoopEnabled',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['enabled']) ||
                typeof args.enabled !== 'boolean' ||
                (args.enabled && context.loopEnd <= context.loopStart)
            ) {
                return rejection(index, call.name, 'Expected a boolean enabled value and a valid existing loop region');
            }
            return { type: 'setLoopEnabled', payload: { enabled: args.enabled } };
        },
    },
    {
        name: 'setLoopRegion',
        transform: ({ call, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['startBeat', 'endBeat']) ||
                !isFiniteNumber(args.startBeat) ||
                !isFiniteNumber(args.endBeat) ||
                args.startBeat < 0 ||
                args.endBeat <= args.startBeat
            ) {
                return rejection(index, call.name, 'Expected finite loop beats with 0 <= startBeat < endBeat');
            }
            return { type: 'setLoopRegion', payload: { startBeat: args.startBeat, endBeat: args.endBeat } };
        },
    },
    {
        name: 'setPunchIn',
        transform: ({ call, context, index, projectPunchRegion }) => {
            const args = call.arguments;
            const beat = args.beat;
            const expected = 'Expected exactly one finite punch-in beat with 0 <= beat < Number.MAX_VALUE';
            if (!hasExactKeys(args, ['beat']) || !isFiniteNumber(beat)) {
                return rejection(index, call.name, expected);
            }
            const hasValidCurrentRegion =
                isFiniteNumber(context.punchInBeat) &&
                isFiniteNumber(context.punchOutBeat) &&
                context.punchInBeat >= 0 &&
                context.punchOutBeat > context.punchInBeat;
            if (beat < 0 || beat >= Number.MAX_VALUE || !hasValidCurrentRegion) {
                return rejection(index, call.name, expected);
            }

            const current = { punchInBeat: context.punchInBeat, punchOutBeat: context.punchOutBeat };
            const patch = projectPunchRegion({ current, beat, edge: 'in' });
            if (patch === null) {
                return rejection(index, call.name, 'Requested punch endpoint cannot produce a finite punch region');
            }
            const next = { ...current, ...patch };
            if (next.punchInBeat === current.punchInBeat && next.punchOutBeat === current.punchOutBeat) {
                return rejection(index, call.name, 'Requested punch endpoint already matches project state');
            }
            return { type: 'setPunchIn', payload: { beat } };
        },
    },
    {
        name: 'setPunchOut',
        transform: ({ call, context, index, projectPunchRegion }) => {
            const args = call.arguments;
            const beat = args.beat;
            const expected = 'Expected exactly one finite punch-out beat with 0 < beat <= Number.MAX_VALUE';
            if (!hasExactKeys(args, ['beat']) || !isFiniteNumber(beat)) {
                return rejection(index, call.name, expected);
            }
            const hasValidCurrentRegion =
                isFiniteNumber(context.punchInBeat) &&
                isFiniteNumber(context.punchOutBeat) &&
                context.punchInBeat >= 0 &&
                context.punchOutBeat > context.punchInBeat;
            if (beat <= 0 || beat > Number.MAX_VALUE || !hasValidCurrentRegion) {
                return rejection(index, call.name, expected);
            }

            const current = { punchInBeat: context.punchInBeat, punchOutBeat: context.punchOutBeat };
            const patch = projectPunchRegion({ current, beat, edge: 'out' });
            if (patch === null) {
                return rejection(index, call.name, 'Requested punch endpoint cannot produce a finite punch region');
            }
            const next = { ...current, ...patch };
            if (next.punchInBeat === current.punchInBeat && next.punchOutBeat === current.punchOutBeat) {
                return rejection(index, call.name, 'Requested punch endpoint already matches project state');
            }
            return { type: 'setPunchOut', payload: { beat } };
        },
    },
    {
        name: 'setPunchEnabled',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (!hasExactKeys(args, ['enabled']) || typeof args.enabled !== 'boolean') {
                return rejection(index, call.name, 'Expected only a boolean enabled value');
            }
            if (context.isPlaying || context.isRecording) {
                return rejection(index, call.name, 'Transport Punch In/Out can change only while transport is stopped');
            }
            if (context.punchInEnabled === args.enabled) {
                return rejection(
                    index,
                    call.name,
                    'Requested Transport Punch In/Out state already matches project state'
                );
            }
            return { type: 'setPunchEnabled', payload: { enabled: args.enabled } };
        },
    },
    {
        name: 'setMetronomeEnabled',
        transform: ({ call, index }) => {
            const args = call.arguments;
            if (!hasExactKeys(args, ['enabled']) || typeof args.enabled !== 'boolean') {
                return rejection(index, call.name, 'Expected only a boolean enabled value');
            }
            return { type: 'setMetronomeEnabled', payload: { enabled: args.enabled } };
        },
    },
    {
        name: 'setMetronomeVolume',
        transform: ({ call, index }) => {
            const args = call.arguments;
            if (!hasExactKeys(args, ['volume']) || !isFiniteNumber(args.volume) || args.volume < 0 || args.volume > 1) {
                return rejection(index, call.name, 'Expected only a finite metronome volume from 0 through 1');
            }
            return { type: 'setMetronomeVolume', payload: { volume: args.volume } };
        },
    },
] as const satisfies readonly LlmActionStrategyDefinition<TransportTimelineCallName>[];

type RegisteredTransportTimelineCallName = (typeof transportTimelineStrategyDefinitions)[number]['name'];
type AllTransportTimelineStrategiesRegistered =
    Exclude<TransportTimelineCallName, RegisteredTransportTimelineCallName> extends never ? true : never;

function assertAllTransportTimelineStrategiesRegistered(
    definitions: AllTransportTimelineStrategiesRegistered extends true
        ? typeof transportTimelineStrategyDefinitions
        : never
): typeof transportTimelineStrategyDefinitions {
    return definitions;
}

export const transportTimelineStrategyRegistry = createLlmActionStrategyRegistry<TransportTimelineCallName>(
    assertAllTransportTimelineStrategiesRegistered(transportTimelineStrategyDefinitions)
);

function isTransportTimelineCallName(value: string): value is TransportTimelineCallName {
    return transportTimelineStrategyDefinitions.some((definition) => definition.name === value);
}

export function bridgeTransportTimelineToolCall(
    input: TransportTimelineStrategyInput
): RuntimeAction | LlmActionRejection | null {
    if (!isTransportTimelineCallName(input.call.name)) {
        return null;
    }
    const strategy = transportTimelineStrategyRegistry.get(input.call.name);
    return strategy ? strategy(input) : null;
}
