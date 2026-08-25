import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type AgentPlanProposal } from '../models/AgentRun';
import { type ProjectContext } from '../models/ProjectContext';
import { normalizeAgentPlanProposal } from '../transformers/normalizeAgentPlanProposal';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { isAgentReferenceCapabilityCandidate } from './agentReference/isAgentReferenceCapabilityCandidate';

const MAX_ITEMS = 16;
const MAX_COMMANDS = 32;
const MAX_REPEAT = 8;

type Entity = 'track' | 'clip' | 'device' | 'automation-lane';

type Candidate = {
    id: string;
    entity: Entity;
    name?: string;
    kind?: string;
    type?: string;
    trackId?: string;
    muted?: boolean;
    locked?: boolean;
    bypassed?: boolean;
    enabled?: boolean;
};

export type ArbitraryCommandListSelectorEvidence = {
    itemId: string;
    stableIds: string[];
    excludedIds: string[];
    protectedExclusions: string[];
    preconditions: Array<{ stableId: string; fingerprint: string }>;
};

export type ArbitraryCommandListDirectTargetEvidence = {
    argument: string;
    capability: string;
    cardinality: 'one' | 'many';
    stableIds: string[];
};

type CompiledItemEvidence = {
    canonicalStableIds: string[];
    declaredCommandIdentities: string[];
    itemId: string;
    commandName: string;
    dependsOn: string[];
    declaredCommandCount: number;
    omittedCommandCount: number;
    representativeCommandIndexes: number[];
    stableIds: string[];
    commandStart: number;
    commandCount: number;
    targetArgument?: string;
    targetCapability?: string;
    targetCardinality?: 'many';
    directTargets?: ArbitraryCommandListDirectTargetEvidence[];
};

export type ArbitraryCommandListEvidence = {
    schemaVersion: 1;
    snapshotRevision: string;
    proposalScope: AgentPlanProposal['scope'];
    selectors: ArbitraryCommandListSelectorEvidence[];
    items: CompiledItemEvidence[];
    commands: ToolCallResult[];
};

type AcceptedCompilation = {
    status: 'accepted';
    calls: ToolCallResult[];
    evidence: ArbitraryCommandListSelectorEvidence[];
    compilerEvidence?: ArbitraryCommandListEvidence;
    snapshotRevision: string;
};

type RejectedCompilation = { status: 'rejected'; reason: string };

export type ArbitraryCommandListCompilation = AcceptedCompilation | RejectedCompilation;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every((key) => keys.includes(key));
}

function isSafeId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function collectCandidates(context: ProjectContext): Candidate[] {
    const tracks = context.tracks.map((track) => ({
        id: track.id,
        entity: 'track' as const,
        name: track.name,
        kind: track.kind,
        muted: track.muted,
    }));
    const clips = context.tracks.flatMap((track) =>
        track.clips.map((clip) => ({
            id: clip.id,
            entity: 'clip' as const,
            name: clip.name,
            type: clip.type,
            trackId: track.id,
            muted: clip.muted,
            locked: clip.locked,
        }))
    );
    const devices = context.tracks.flatMap((track) =>
        track.devices.map((device) => ({
            id: device.id,
            entity: 'device' as const,
            name: device.name,
            type: device.type,
            trackId: track.id,
            bypassed: device.bypassed,
        }))
    );
    const lanes = (context.automationLanes ?? []).map((lane) => ({
        id: lane.id,
        entity: 'automation-lane' as const,
        name: lane.name,
        trackId: lane.trackId,
        enabled: lane.enabled,
    }));
    return [...tracks, ...clips, ...devices, ...lanes];
}

function containsForbiddenProviderAuthority(value: unknown): boolean {
    if (!isRecord(value)) {
        return Array.isArray(value) && value.some(containsForbiddenProviderAuthority);
    }
    return Object.entries(value).some(
        ([key, nested]) =>
            /approval|token|expected(?:state)?|revision/iu.test(key) || containsForbiddenProviderAuthority(nested)
    );
}

function parseIdList(value: unknown, label: string): string[] | RejectedCompilation {
    if (!Array.isArray(value) || value.length > MAX_COMMANDS) {
        return { status: 'rejected', reason: `${label} must contain bounded stable IDs.` };
    }
    const ids: string[] = [];
    for (const entry of value) {
        if (!isSafeId(entry)) {
            return { status: 'rejected', reason: `${label} must contain bounded stable IDs.` };
        }
        if (ids.includes(entry)) {
            return { status: 'rejected', reason: `${label} contains duplicate stable IDs.` };
        }
        ids.push(entry);
    }
    return ids;
}

function parseSelector(value: unknown):
    | {
          targetArgument: string;
          entity: Entity;
          where: Record<string, string>;
          excludedIds: string[];
          condition: { field: 'muted' | 'locked' | 'bypassed' | 'enabled'; equals: boolean } | undefined;
          exactly: number;
      }
    | RejectedCompilation {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, ['targetArgument', 'entity', 'where', 'excludeIds', 'condition', 'quantity'])
    ) {
        return { status: 'rejected', reason: 'Bulk selector does not match the versioned application contract.' };
    }
    if (
        !isSafeId(value.targetArgument) ||
        !['track', 'clip', 'device', 'automation-lane'].includes(String(value.entity))
    ) {
        return { status: 'rejected', reason: 'Bulk selector has an invalid target argument or entity.' };
    }
    if (
        !isRecord(value.quantity) ||
        !hasOnlyKeys(value.quantity, ['unit', 'exactly']) ||
        value.quantity.unit !== 'targets'
    ) {
        return { status: 'rejected', reason: 'Bulk selector requires an exact target quantity with unit targets.' };
    }
    const exactly = value.quantity.exactly;
    if (typeof exactly !== 'number' || !Number.isInteger(exactly) || exactly < 1 || exactly > MAX_COMMANDS) {
        return { status: 'rejected', reason: 'Bulk selector target quantity is outside the application bound.' };
    }
    const where = value.where === undefined ? {} : value.where;
    if (
        !isRecord(where) ||
        !hasOnlyKeys(where, ['name', 'kind', 'type', 'trackId']) ||
        Object.values(where).some((entry) => !isSafeId(entry))
    ) {
        return { status: 'rejected', reason: 'Bulk selector has an invalid semantic match clause.' };
    }
    const excluded = value.excludeIds === undefined ? [] : parseIdList(value.excludeIds, 'Bulk selector exclusion');
    if ('status' in excluded) {
        return excluded;
    }
    let condition: { field: 'muted' | 'locked' | 'bypassed' | 'enabled'; equals: boolean } | undefined;
    if (value.condition !== undefined) {
        if (
            !isRecord(value.condition) ||
            !hasOnlyKeys(value.condition, ['field', 'equals']) ||
            !['muted', 'locked', 'bypassed', 'enabled'].includes(String(value.condition.field)) ||
            typeof value.condition.equals !== 'boolean'
        ) {
            return { status: 'rejected', reason: 'Bulk selector has an invalid conditional clause.' };
        }
        condition = value.condition as typeof condition;
    }
    return {
        targetArgument: value.targetArgument,
        entity: value.entity as Entity,
        where: where as Record<string, string>,
        excludedIds: excluded,
        condition,
        exactly,
    };
}

function resolveSelector(input: {
    candidates: readonly Candidate[];
    selector: ReturnType<typeof parseSelector> & { status?: never };
    protectedTargetIds: ReadonlySet<string>;
    itemId: string;
}): { stableIds: string[]; evidence: ArbitraryCommandListSelectorEvidence } | RejectedCompilation {
    const candidates = input.candidates.filter((candidate) => {
        if (candidate.entity !== input.selector.entity) {
            return false;
        }
        if (Object.entries(input.selector.where).some(([key, value]) => candidate[key as keyof Candidate] !== value)) {
            return false;
        }
        return (
            input.selector.condition === undefined ||
            candidate[input.selector.condition.field] === input.selector.condition.equals
        );
    });
    const excludedIds = new Set([...input.selector.excludedIds, ...input.protectedTargetIds]);
    const protectedExclusions = candidates
        .filter((candidate) => input.protectedTargetIds.has(candidate.id))
        .map((candidate) => candidate.id);
    const stableIds = candidates.filter((candidate) => !excludedIds.has(candidate.id)).map((candidate) => candidate.id);
    if (stableIds.length !== input.selector.exactly) {
        return {
            status: 'rejected',
            reason: `Bulk selector ${input.itemId} resolved ${String(stableIds.length)} targets, not its exact quantity.`,
        };
    }
    return {
        stableIds,
        evidence: {
            itemId: input.itemId,
            stableIds,
            excludedIds: [...input.selector.excludedIds],
            protectedExclusions,
            preconditions: stableIds.map((stableId) => {
                const candidate = candidates.find((entry) => entry.id === stableId);
                return { stableId, fingerprint: JSON.stringify(candidate) };
            }),
        },
    };
}

function hasExactScope(plan: ReturnType<typeof normalizeAgentPlanProposal>, stableIds: readonly string[]): boolean {
    return (
        plan !== null &&
        plan.scope.targetIds.length === stableIds.length &&
        plan.scope.targetIds.every((id, index) => id === stableIds[index])
    );
}

function isIdempotentSetCommand(name: string): boolean {
    return name.startsWith('set') || ['armTrack', 'bypassDevice', 'muteTrack', 'soloTrack'].includes(name);
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function getCanonicalCommandIdentity(command: ToolCallResult): string {
    return canonicalJson(command);
}

function getTargetWriteIdentity(
    name: string,
    targetRules: readonly { argument: string }[],
    arguments_: Readonly<Record<string, unknown>>
): string {
    return canonicalJson({
        name,
        targetArguments: Object.fromEntries(
            targetRules.map((targetRule) => [targetRule.argument, arguments_[targetRule.argument]])
        ),
    });
}

function detectDependencyCycle(items: readonly Record<string, unknown>[]): string | null {
    const dependencies = new Map<string, string[]>();
    for (const item of items) {
        const id = item.id;
        if (!isSafeId(id) || dependencies.has(id)) {
            return 'Structured command list item IDs must be unique stable identifiers.';
        }
        const dependsOn =
            item.dependsOn === undefined ? [] : parseIdList(item.dependsOn, 'Structured command dependencies');
        if ('status' in dependsOn) {
            return dependsOn.reason;
        }
        dependencies.set(id, dependsOn);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
        if (visiting.has(id)) {
            return true;
        }
        if (visited.has(id)) {
            return false;
        }
        visiting.add(id);
        const cycle = (dependencies.get(id) ?? []).some(
            (dependency) => !dependencies.has(dependency) || visit(dependency)
        );
        visiting.delete(id);
        visited.add(id);
        return cycle;
    };
    return [...dependencies.keys()].some(visit) ? 'Structured command list has an unknown or cyclic dependency.' : null;
}

/**
 * Turns the provider's bounded semantic list into ordinary registered commands.
 * The provider never receives generated IDs, state guards, approval authority, or
 * a per-target execution turn; the snapshot is resolved exactly once here.
 */
export function compileArbitraryCommandList(input: {
    calls: readonly ToolCallResult[];
    context: ProjectContext;
    revision: string;
}): ArbitraryCommandListCompilation {
    const proposalCalls = input.calls.filter((call) => call.name === 'command.batch.propose');
    if (proposalCalls.length !== 1) {
        return { status: 'accepted', calls: [...input.calls], evidence: [], snapshotRevision: input.revision };
    }
    const proposal = proposalCalls[0]!;
    if (!isRecord(proposal.arguments) || proposal.arguments.list === undefined) {
        return { status: 'accepted', calls: [...input.calls], evidence: [], snapshotRevision: input.revision };
    }
    if (input.revision.length === 0) {
        return {
            status: 'rejected',
            reason: 'Structured command list requires a revision-bearing immutable project snapshot.',
        };
    }
    if (!hasOnlyKeys(proposal.arguments, ['list', 'plan']) || !isRecord(proposal.arguments.list)) {
        return {
            status: 'rejected',
            reason: 'Structured command list does not match the versioned application contract.',
        };
    }
    const plan = normalizeAgentPlanProposal(proposal.arguments.plan);
    const list = proposal.arguments.list;
    if (
        list.schemaVersion !== 1 ||
        !Array.isArray(list.items) ||
        list.items.length === 0 ||
        list.items.length > MAX_ITEMS
    ) {
        return { status: 'rejected', reason: 'Structured command list has an unsupported version or item budget.' };
    }
    if (list.items.some((item) => !isRecord(item))) {
        return { status: 'rejected', reason: 'Structured command list contains an invalid item.' };
    }
    const items = list.items as Record<string, unknown>[];
    const dependencyRejection = detectDependencyCycle(items);
    if (dependencyRejection !== null) {
        return { status: 'rejected', reason: dependencyRejection };
    }
    const candidates = collectCandidates(input.context);
    const protectedTargetIds = new Set(plan?.scope.protectedTargetIds ?? []);
    const commands: ToolCallResult[] = [];
    const evidence: ArbitraryCommandListSelectorEvidence[] = [];
    const compiledItems: CompiledItemEvidence[] = [];
    const orderedTargetIds: string[] = [];
    const targetWrites = new Map<string, { destructive: boolean; itemId: string }>();
    const targetCommandArguments = new Map<string, string>();
    const canonicalCommandIndexes = new Map<string, number>();

    for (const [index, item] of items.entries()) {
        const commandStart = commands.length;
        if (!hasOnlyKeys(item, ['id', 'name', 'arguments', 'selector', 'repeat', 'dependsOn'])) {
            return { status: 'rejected', reason: 'Structured command item contains unsupported authority fields.' };
        }
        if (!isSafeId(item.id) || !isSafeId(item.name) || !isRecord(item.arguments)) {
            return { status: 'rejected', reason: 'Structured command item has an invalid command shape.' };
        }
        if (containsForbiddenProviderAuthority(item.arguments)) {
            return { status: 'rejected', reason: 'Provider supplied application-owned authority or expected state.' };
        }
        const rules = getExecutableAppActionGroundingRules(item.name);
        if (rules === null) {
            return {
                status: 'rejected',
                reason: `Structured command ${item.name} is not an executable catalog command.`,
            };
        }
        const dependsOn =
            item.dependsOn === undefined ? [] : parseIdList(item.dependsOn, 'Structured command dependencies');
        if ('status' in dependsOn) {
            return dependsOn;
        }
        const priorIds = new Set(items.slice(0, index).map((entry) => entry.id));
        if (dependsOn.some((dependency) => !priorIds.has(dependency))) {
            return {
                status: 'rejected',
                reason: 'Structured command dependencies must refer to earlier ordered items.',
            };
        }
        let repeat = 1;
        if (item.repeat !== undefined) {
            if (
                !isRecord(item.repeat) ||
                !hasOnlyKeys(item.repeat, ['count']) ||
                !Number.isInteger(item.repeat.count)
            ) {
                return {
                    status: 'rejected',
                    reason: 'Structured command repetition does not match the application contract.',
                };
            }
            repeat = item.repeat.count as number;
            if (repeat < 1 || repeat > MAX_REPEAT) {
                return { status: 'rejected', reason: 'Structured command repetition exceeds the application bound.' };
            }
        }
        if (item.selector === undefined) {
            const declaredCommandIdentities: string[] = [];
            let omittedCommandCount = 0;
            const representativeCommandIndexes: number[] = [];
            if (
                rules.targetRules.some(
                    (rule) =>
                        rule.cardinality === 'many' ||
                        typeof item.arguments[rule.argument] !== 'string' ||
                        !item.arguments[rule.argument].startsWith('$')
                )
            ) {
                return { status: 'rejected', reason: 'Targeted command requires a bounded semantic bulk selector.' };
            }
            for (let occurrence = 0; occurrence < repeat; occurrence += 1) {
                const command = { name: item.name, arguments: { ...item.arguments } };
                const commandKey = getCanonicalCommandIdentity(command);
                declaredCommandIdentities.push(commandKey);
                const canonicalCommandIndex = canonicalCommandIndexes.get(commandKey);
                if (isIdempotentSetCommand(item.name) && canonicalCommandIndex !== undefined) {
                    omittedCommandCount += 1;
                    representativeCommandIndexes.push(canonicalCommandIndex);
                    continue;
                }
                const commandIndex = commands.length;
                canonicalCommandIndexes.set(commandKey, commandIndex);
                representativeCommandIndexes.push(commandIndex);
                commands.push(command);
            }
            if (commands.length > MAX_COMMANDS) {
                return {
                    status: 'rejected',
                    reason: 'Structured command list exceeds the application command budget.',
                };
            }
            compiledItems.push({
                canonicalStableIds: [],
                declaredCommandIdentities,
                itemId: item.id,
                commandName: item.name,
                dependsOn,
                declaredCommandCount: repeat,
                omittedCommandCount,
                representativeCommandIndexes,
                stableIds: [],
                commandStart,
                commandCount: commands.length - commandStart,
            });
            continue;
        }
        const selector = parseSelector(item.selector);
        if ('status' in selector) {
            return selector;
        }
        const targetRule = rules.targetRules.find((rule) => rule.argument === selector.targetArgument);
        if (targetRule === undefined || targetRule.cardinality === 'many') {
            return {
                status: 'rejected',
                reason: 'Bulk selector is incompatible with the discovered command target contract.',
            };
        }
        if (selector.targetArgument in item.arguments) {
            return { status: 'rejected', reason: 'Provider may not supply target IDs for a semantic bulk selector.' };
        }
        const resolved = resolveSelector({ candidates, selector, protectedTargetIds, itemId: item.id });
        if ('status' in resolved) {
            return resolved;
        }
        if (
            !resolved.stableIds.every((stableId) =>
                isAgentReferenceCapabilityCandidate({
                    capability: targetRule.capability,
                    context: input.context,
                    id: stableId,
                })
            )
        ) {
            return {
                status: 'rejected',
                reason: 'Bulk selector resolved a target outside the command capability contract.',
            };
        }
        evidence.push(resolved.evidence);
        for (const stableId of resolved.stableIds) {
            if (!orderedTargetIds.includes(stableId)) {
                orderedTargetIds.push(stableId);
            }
        }
        if (repeat > 1 && !isIdempotentSetCommand(item.name)) {
            return {
                status: 'rejected',
                reason: `Structured command repetition is not safely composable: ${item.name}`,
            };
        }
        const canonicalStableIds: string[] = [];
        const declaredCommandIdentities: string[] = [];
        let omittedCommandCount = 0;
        const representativeCommandIndexes: number[] = [];
        for (const stableId of resolved.stableIds) {
            const isDestructive = /^remove|^delete/u.test(item.name);
            const previousWrite = targetWrites.get(stableId);
            if (previousWrite && (isDestructive || previousWrite.destructive) && previousWrite.itemId !== item.id) {
                return {
                    status: 'rejected',
                    reason: 'Structured command list contains contradictory target dependencies.',
                };
            }
            targetWrites.set(stableId, { destructive: isDestructive, itemId: item.id });
            for (let occurrence = 0; occurrence < repeat; occurrence += 1) {
                const command = {
                    name: item.name,
                    arguments: { ...item.arguments, [selector.targetArgument]: stableId },
                };
                const commandKey = getCanonicalCommandIdentity(command);
                declaredCommandIdentities.push(commandKey);
                const targetCommandKey = getTargetWriteIdentity(item.name, rules.targetRules, command.arguments);
                const priorArguments = targetCommandArguments.get(targetCommandKey);
                if (priorArguments !== undefined && priorArguments !== commandKey) {
                    return {
                        status: 'rejected',
                        reason: `Structured command writes for ${item.name} on ${stableId} are not safely composable.`,
                    };
                }
                targetCommandArguments.set(targetCommandKey, commandKey);
                const canonicalCommandIndex = canonicalCommandIndexes.get(commandKey);
                if (isIdempotentSetCommand(item.name) && canonicalCommandIndex !== undefined) {
                    omittedCommandCount += 1;
                    representativeCommandIndexes.push(canonicalCommandIndex);
                    continue;
                }
                const commandIndex = commands.length;
                canonicalCommandIndexes.set(commandKey, commandIndex);
                representativeCommandIndexes.push(commandIndex);
                canonicalStableIds.push(stableId);
                commands.push(command);
            }
        }
        if (commands.length > MAX_COMMANDS) {
            return { status: 'rejected', reason: 'Structured command list exceeds the application command budget.' };
        }
        compiledItems.push({
            canonicalStableIds,
            declaredCommandIdentities,
            itemId: item.id,
            commandName: item.name,
            dependsOn,
            declaredCommandCount: resolved.stableIds.length * repeat,
            omittedCommandCount,
            representativeCommandIndexes,
            stableIds: [...resolved.stableIds],
            commandStart,
            commandCount: commands.length - commandStart,
            targetArgument: selector.targetArgument,
            targetCapability: targetRule.capability,
        });
    }
    if (!hasExactScope(plan, orderedTargetIds)) {
        return {
            status: 'rejected',
            reason: 'Structured command list resolved scope does not exactly match the provider proposal.',
        };
    }
    return {
        status: 'accepted',
        snapshotRevision: input.revision,
        evidence,
        compilerEvidence:
            plan === null
                ? undefined
                : {
                      schemaVersion: 1,
                      snapshotRevision: input.revision,
                      proposalScope: structuredClone(plan.scope),
                      selectors: structuredClone(evidence),
                      items: structuredClone(compiledItems),
                      commands: structuredClone(commands),
                  },
        calls: input.calls.map((call) =>
            call === proposal ? { name: call.name, arguments: { plan: proposal.arguments.plan, commands } } : call
        ),
    };
}
