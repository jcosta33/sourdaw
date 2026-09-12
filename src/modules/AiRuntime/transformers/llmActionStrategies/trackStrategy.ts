import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';
import { wouldCreateRoutingCycle } from '#/utils/routingCycle';

import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { normalizeSafeProjectName } from '../../validators/normalizeSafeProjectName';
import { type LlmActionRejection } from '../llmActionBridgeContracts';
import { type ToolCallResult } from '../toolCallParser';

import {
    findProviderOutputTarget,
    findTrack,
    hasExactKeys,
    hasTrack,
    isExecutableTrackKind,
    isFiniteNumber,
    isProviderRoutableSource,
    isSafeTrackColor,
    rejection,
} from './bridgeArgumentGuards';
import { createLlmActionStrategyRegistry } from './createLlmActionStrategyRegistry';

export const trackActionNames = [
    'addTrack',
    'removeTrack',
    'renameTrack',
    'reorderTrack',
    'duplicateTrack',
    'muteTrack',
    'soloTrack',
    'armTrack',
    'setSoloSafe',
    'clearSolos',
    'setTrackGain',
    'setTrackPan',
    'setTrackColor',
    'setTrackOutput',
] as const satisfies readonly Extract<RuntimeActionType, string>[];

export type TrackCallName = (typeof trackActionNames)[number];

type TrackStrategyInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
};

type TrackStrategy<Name extends TrackCallName> = (
    input: TrackStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

type TrackStrategyDefinition<Name extends TrackCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: TrackStrategy<StrategyName>;
    };
}[Name];

const trackStrategyDefinitions = [
    {
        name: 'addTrack',
        transform: ({ call, index }) => {
            const args = call.arguments;
            const name = normalizeSafeProjectName(args.name);
            if (!hasExactKeys(args, ['name', 'kind']) || !name || !isExecutableTrackKind(args.kind)) {
                return rejection(index, call.name, 'Expected a safe name and one of audio, midi, or folder');
            }
            return {
                type: 'addTrack',
                payload: { name, kind: args.kind, select: false },
            };
        },
    },
    {
        name: 'removeTrack',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const track = findTrack(context, args.trackId);
            if (!hasExactKeys(args, ['trackId']) || !track || track.kind === 'master') {
                return rejection(index, call.name, 'Expected only an available non-master trackId');
            }
            return { type: 'removeTrack', payload: { trackId: track.id } };
        },
    },
    {
        name: 'renameTrack',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (!hasExactKeys(args, ['trackId', 'name']) || !hasTrack(context, args.trackId)) {
                return rejection(index, call.name, 'Expected an available trackId and name');
            }
            const name = normalizeSafeProjectName(args.name);
            if (!name) {
                return rejection(
                    index,
                    call.name,
                    'Expected a non-empty name no longer than 120 characters without framing or control characters'
                );
            }
            return { type: 'renameTrack', payload: { trackId: args.trackId, name } };
        },
    },
    {
        name: 'duplicateTrack',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findTrack(context, args.trackId);
            if (!hasExactKeys(args, ['trackId']) || !source || !isExecutableTrackKind(source.kind)) {
                return rejection(
                    index,
                    call.name,
                    'Expected one duplicable audio, MIDI, bus, or folder source trackId'
                );
            }
            return { type: 'duplicateTrack', payload: { trackId: source.id, select: false } };
        },
    },
    {
        name: 'muteTrack',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['trackId', 'muted']) ||
                !hasTrack(context, args.trackId) ||
                typeof args.muted !== 'boolean'
            ) {
                return rejection(index, call.name, 'Expected an available trackId and boolean muted value');
            }
            return { type: 'muteTrack', payload: { trackId: args.trackId, muted: args.muted } };
        },
    },
    {
        name: 'soloTrack',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['trackId', 'soloed']) ||
                !hasTrack(context, args.trackId) ||
                typeof args.soloed !== 'boolean'
            ) {
                return rejection(index, call.name, 'Expected an available trackId and boolean soloed value');
            }
            return { type: 'soloTrack', payload: { trackId: args.trackId, soloed: args.soloed } };
        },
    },
    {
        name: 'armTrack',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const track = findTrack(context, args.trackId);
            if (
                !hasExactKeys(args, ['trackId', 'armed']) ||
                !track ||
                track.kind === 'vca' ||
                typeof args.armed !== 'boolean'
            ) {
                return rejection(index, call.name, 'Expected an armable trackId and boolean armed value');
            }
            return { type: 'armTrack', payload: { trackId: track.id, armed: args.armed } };
        },
    },
    {
        name: 'setSoloSafe',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const track = findTrack(context, args.trackId);
            if (
                !hasExactKeys(args, ['trackId', 'soloSafe']) ||
                !track ||
                typeof args.soloSafe !== 'boolean' ||
                args.soloSafe === track.soloSafe
            ) {
                return rejection(index, call.name, 'Expected an available trackId and changed boolean soloSafe value');
            }
            return { type: 'setSoloSafe', payload: { trackId: track.id, soloSafe: args.soloSafe } };
        },
    },
    {
        name: 'clearSolos',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (!hasExactKeys(args, []) || !context.tracks.some((track) => track.soloed)) {
                return rejection(index, call.name, 'Expected no arguments and at least one currently soloed track');
            }
            return { type: 'clearSolos' };
        },
    },
    {
        name: 'setTrackGain',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['trackId', 'gain']) ||
                !hasTrack(context, args.trackId) ||
                !isFiniteNumber(args.gain) ||
                args.gain < 0 ||
                args.gain > FADER_MAX_GAIN
            ) {
                return rejection(
                    index,
                    call.name,
                    `Expected an available trackId and finite gain from 0 through ${FADER_MAX_GAIN}`
                );
            }
            return { type: 'setTrackGain', payload: { trackId: args.trackId, gain: args.gain } };
        },
    },
    {
        name: 'setTrackPan',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['trackId', 'pan']) ||
                !hasTrack(context, args.trackId) ||
                !isFiniteNumber(args.pan) ||
                args.pan < -50 ||
                args.pan > 50
            ) {
                return rejection(index, call.name, 'Expected an available trackId and finite pan from -50 through 50');
            }
            return { type: 'setTrackPan', payload: { trackId: args.trackId, pan: args.pan } };
        },
    },
    {
        name: 'setTrackColor',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['trackId', 'color']) ||
                !hasTrack(context, args.trackId) ||
                !isSafeTrackColor(args.color)
            ) {
                return rejection(index, call.name, 'Expected an available trackId and six-digit hexadecimal color');
            }
            return { type: 'setTrackColor', payload: { trackId: args.trackId, color: args.color.toLowerCase() } };
        },
    },
    {
        name: 'reorderTrack',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['trackId', 'newIndex']) ||
                !hasTrack(context, args.trackId) ||
                !isFiniteNumber(args.newIndex) ||
                !Number.isInteger(args.newIndex) ||
                args.newIndex < 0 ||
                args.newIndex >= context.tracks.length
            ) {
                return rejection(index, call.name, 'Expected an available trackId and an in-range integer newIndex');
            }
            return { type: 'reorderTrack', payload: { trackId: args.trackId, newIndex: args.newIndex } };
        },
    },
    {
        name: 'setTrackOutput',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findTrack(context, args.trackId);
            const target = findProviderOutputTarget(context, args.outputId);
            if (
                !hasExactKeys(args, ['trackId', 'outputId']) ||
                !isProviderRoutableSource(source) ||
                typeof source.outputId !== 'string' ||
                !target ||
                source.id === target.id
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected a routable source track and a distinct bus or master output'
                );
            }
            if (
                wouldCreateRoutingCycle({
                    sourceId: source.id,
                    targetId: target.id,
                    tracks: context.tracks,
                    sidechainRoutes: context.sidechainRoutes ?? [],
                })
            ) {
                return rejection(index, call.name, 'Expected a new acyclic output route');
            }
            return {
                type: 'setTrackOutput',
                payload: { trackId: source.id, outputId: target.id, expectedOutputId: source.outputId },
            };
        },
    },
] as const satisfies readonly TrackStrategyDefinition<TrackCallName>[];

export const trackStrategyRegistry = createLlmActionStrategyRegistry<
    TrackCallName,
    TrackStrategyInput,
    RuntimeAction | LlmActionRejection
>(trackStrategyDefinitions, trackActionNames);

function isTrackCallName(value: string): value is TrackCallName {
    return trackActionNames.some((actionName) => actionName === value);
}

export function bridgeTrackToolCall(input: TrackStrategyInput): RuntimeAction | LlmActionRejection | null {
    if (!isTrackCallName(input.call.name)) {
        return null;
    }
    const strategy = trackStrategyRegistry.get(input.call.name);
    if (!strategy) {
        throw new Error(`Missing LLM action strategy: ${input.call.name}`);
    }
    return strategy(input);
}
