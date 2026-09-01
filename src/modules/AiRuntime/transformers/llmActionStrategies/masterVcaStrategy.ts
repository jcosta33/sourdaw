import { FADER_MAX_GAIN, VCA_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { normalizeSafeProjectName } from '../../validators/normalizeSafeProjectName';
import { type LlmActionRejection } from '../llmActionBridgeContracts';
import { type ToolCallResult } from '../toolCallParser';

import { createLlmActionStrategyRegistry } from './createLlmActionStrategyRegistry';

export const masterVcaActionNames = [
    'setMasterGain',
    'setVcaGain',
    'createVcaGroup',
    'assignToVca',
    'removeFromVca',
] as const satisfies readonly Extract<RuntimeActionType, string>[];

export type MasterVcaCallName = (typeof masterVcaActionNames)[number];

type MasterVcaStrategyInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
};

type MasterVcaStrategy<Name extends MasterVcaCallName> = (
    input: MasterVcaStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

type MasterVcaStrategyDefinition<Name extends MasterVcaCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: MasterVcaStrategy<StrategyName>;
    };
}[Name];

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function rejection(index: number, name: string, reason: string): LlmActionRejection {
    return { index, name, reason };
}

function findVcaGroup(context: ProjectContext, vcaGroupId: unknown) {
    if (typeof vcaGroupId !== 'string') {
        return undefined;
    }
    return (context.vcaGroups ?? []).find((group) => group.id === vcaGroupId);
}

function findVcaMemberTrack(context: ProjectContext, trackId: unknown) {
    if (typeof trackId !== 'string') {
        return undefined;
    }
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    if (
        !track ||
        (track.kind !== 'audio' && track.kind !== 'midi' && track.kind !== 'bus' && track.kind !== 'folder')
    ) {
        return undefined;
    }
    return track;
}

export function normalizeVcaGroupName(name: string): string {
    return name
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function isCanonicalVcaMembership(
    context: ProjectContext,
    track: ProjectContext['tracks'][number],
    group: NonNullable<ProjectContext['vcaGroups']>[number]
): boolean {
    if (track.vcaGroupId !== group.id) {
        return false;
    }
    return (context.vcaGroups ?? []).every((candidate) => {
        const membershipCount = candidate.trackIds.filter((trackId) => trackId === track.id).length;
        return candidate.id === group.id ? membershipCount === 1 : membershipCount === 0;
    });
}

function hasAnyVcaMembership(context: ProjectContext, track: ProjectContext['tracks'][number]): boolean {
    return (
        (track.vcaGroupId !== null && track.vcaGroupId !== undefined) ||
        (context.vcaGroups ?? []).some((group) => group.trackIds.includes(track.id))
    );
}

const masterVcaStrategyDefinitions = [
    {
        name: 'setMasterGain',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['gain']) ||
                !isFiniteNumber(args.gain) ||
                args.gain < 0 ||
                args.gain > FADER_MAX_GAIN ||
                args.gain === context.masterGain
            ) {
                return rejection(
                    index,
                    call.name,
                    `Expected only a changed finite master gain from 0 through ${FADER_MAX_GAIN}`
                );
            }
            return { type: 'setMasterGain', payload: { gain: args.gain } };
        },
    },
    {
        name: 'setVcaGain',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const group = findVcaGroup(context, args.vcaGroupId);
            if (
                !hasExactKeys(args, ['vcaGroupId', 'gain']) ||
                !group ||
                !isFiniteNumber(args.gain) ||
                args.gain < 0 ||
                args.gain > VCA_MAX_GAIN ||
                args.gain === group.gain
            ) {
                return rejection(
                    index,
                    call.name,
                    `Expected an existing VCA group and a changed finite gain from 0 through ${VCA_MAX_GAIN}`
                );
            }
            return { type: 'setVcaGain', payload: { vcaGroupId: group.id, gain: args.gain } };
        },
    },
    {
        name: 'createVcaGroup',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const name = normalizeSafeProjectName(args.name);
            const trackIds = args.trackIds;
            if (
                !hasExactKeys(args, ['name', 'trackIds']) ||
                !name ||
                !Array.isArray(trackIds) ||
                trackIds.length === 0 ||
                !trackIds.every((trackId): trackId is string => findVcaMemberTrack(context, trackId) !== undefined) ||
                new Set(trackIds).size !== trackIds.length ||
                (context.vcaGroups ?? []).some(
                    (group) => normalizeVcaGroupName(group.name) === normalizeVcaGroupName(name)
                )
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one safe unique VCA name and a non-empty unique list of eligible existing track IDs'
                );
            }
            return { type: 'createVcaGroup', payload: { name, trackIds: [...trackIds] } };
        },
    },
    {
        name: 'assignToVca',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const track = findVcaMemberTrack(context, args.trackId);
            const group = findVcaGroup(context, args.vcaGroupId);
            if (
                !hasExactKeys(args, ['trackId', 'vcaGroupId']) ||
                !track ||
                !group ||
                isCanonicalVcaMembership(context, track, group)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an eligible existing track and a different or inconsistent existing VCA membership'
                );
            }
            return { type: 'assignToVca', payload: { trackId: track.id, vcaGroupId: group.id } };
        },
    },
    {
        name: 'removeFromVca',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const track = findVcaMemberTrack(context, args.trackId);
            if (!hasExactKeys(args, ['trackId']) || !track || !hasAnyVcaMembership(context, track)) {
                return rejection(index, call.name, 'Expected an eligible existing track with current VCA membership');
            }
            return { type: 'removeFromVca', payload: { trackId: track.id } };
        },
    },
] as const satisfies readonly MasterVcaStrategyDefinition<MasterVcaCallName>[];

export const masterVcaStrategyRegistry = createLlmActionStrategyRegistry<
    MasterVcaCallName,
    MasterVcaStrategyInput,
    RuntimeAction | LlmActionRejection
>(masterVcaStrategyDefinitions, masterVcaActionNames);

function isMasterVcaCallName(value: string): value is MasterVcaCallName {
    return masterVcaActionNames.some((actionName) => actionName === value);
}

export function bridgeMasterVcaToolCall(input: MasterVcaStrategyInput): RuntimeAction | LlmActionRejection | null {
    if (!isMasterVcaCallName(input.call.name)) {
        return null;
    }
    const strategy = masterVcaStrategyRegistry.get(input.call.name);
    if (!strategy) {
        throw new Error(`Missing LLM action strategy: ${input.call.name}`);
    }
    return strategy(input);
}
