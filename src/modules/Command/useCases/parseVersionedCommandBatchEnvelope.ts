import {
    VERSIONED_COMMAND_BATCH_SCHEMA_VERSION,
    type CommandBatchAuthority,
    type CommandBatchBudgets,
    type CommandBatchCondition,
    type CommandBatchConditionKind,
    type CommandBatchDependency,
    type CommandBatchGrants,
    type CommandBatchLocalBinding,
    type CommandBatchRange,
    type CommandBatchScope,
    type VersionedCommandBatchEnvelope,
} from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { getVersionedCommandBatchEffects } from './getVersionedCommandBatchEffects';
import { getVersionedCommandTargetReferences } from './getVersionedCommandTargetReferences';
import { parseVersionedCommandEnvelope } from './parseVersionedCommandEnvelope';

type ParseVersionedCommandBatchEnvelopeResult =
    { status: 'valid'; envelope: VersionedCommandBatchEnvelope } | { status: 'invalid'; reason: string };

const MAX_BATCH_ARRAY_LENGTH = 10_000;
const BUDGET_KEYS = [
    'maxCommands',
    'maxCreatedTracks',
    'maxDeletedObjects',
    'maxAffectedTracks',
    'maxAffectedClips',
    'maxAutomationPoints',
    'maxImportedAssets',
    'maxRenderJobs',
] as const;
const GRANT_KEYS = [
    'create',
    'delete',
    'routing',
    'tempo',
    'master',
    'file',
    'audioUpload',
    'remoteGeneration',
    'autoCommit',
] as const;
const BATCH_KEYS = new Set([
    'schemaVersion',
    'runId',
    'batchId',
    'projectId',
    'baseRevision',
    'idempotencyKey',
    'intent',
    'mode',
    'scope',
    'preconditions',
    'commands',
    'postconditions',
    'dependencies',
    'batchLocalBindings',
    'grants',
    'budgets',
]);
const SCOPE_KEYS = new Set(['targetIds', 'targetRanges', 'protectedTargetIds', 'protectedRanges']);
const RANGE_KEYS = new Set(['startBeat', 'endBeat']);
const CONDITION_KEYS = new Set(['kind', 'targetIds', 'value']);
const DEPENDENCY_KEYS = new Set(['commandId', 'dependsOn']);
const BINDING_KEYS = new Set(['bindingId', 'producerArgument', 'producerCommandId']);
const GRANTS_KEYS = new Set(['allowedOperationPrefixes', ...GRANT_KEYS]);
const BUDGETS_KEYS = new Set(BUDGET_KEYS);
const CONDITION_KINDS = new Set<CommandBatchConditionKind>([
    'project-revision',
    'targets-exist',
    'targets-absent',
    'targets-unchanged',
    'ranges-unlocked',
    'project-invariants-valid',
    'audio-graph-valid',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
    return Object.keys(value).every((key) => keys.has(key));
}

function isBoundedArray(value: unknown): value is unknown[] {
    return Array.isArray(value) && value.length <= MAX_BATCH_ARRAY_LENGTH;
}

function isUniqueNonEmptyStrings(value: unknown): value is string[] {
    return isBoundedArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;
}

function parseRange(value: unknown, allowPoint = false): CommandBatchRange | null {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, RANGE_KEYS) ||
        !Number.isFinite(value.startBeat) ||
        !Number.isFinite(value.endBeat)
    ) {
        return null;
    }
    const startBeat = value.startBeat as number;
    const endBeat = value.endBeat as number;
    if (startBeat < 0 || endBeat < startBeat || (!allowPoint && endBeat === startBeat)) {
        return null;
    }
    return { startBeat, endBeat };
}

function parseScope(value: unknown): CommandBatchScope | null {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, SCOPE_KEYS) ||
        !isUniqueNonEmptyStrings(value.targetIds) ||
        !isBoundedArray(value.targetRanges) ||
        !isUniqueNonEmptyStrings(value.protectedTargetIds) ||
        !isBoundedArray(value.protectedRanges)
    ) {
        return null;
    }
    const targetIds = value.targetIds;
    const protectedTargetIds = value.protectedTargetIds;
    if (targetIds.some((targetId) => protectedTargetIds.includes(targetId))) {
        return null;
    }
    const targetRanges: CommandBatchRange[] = [];
    for (const range of value.targetRanges) {
        const parsed = parseRange(range, true);
        if (!parsed) {
            return null;
        }
        targetRanges.push(parsed);
    }
    const protectedRanges: CommandBatchRange[] = [];
    for (const range of value.protectedRanges) {
        const parsed = parseRange(range);
        if (!parsed) {
            return null;
        }
        protectedRanges.push(parsed);
    }
    return {
        targetIds: [...targetIds],
        targetRanges,
        protectedTargetIds: [...protectedTargetIds],
        protectedRanges,
    };
}

function parseConditions(value: unknown): CommandBatchCondition[] | null {
    if (!isBoundedArray(value)) {
        return null;
    }
    const conditions: CommandBatchCondition[] = [];
    for (const condition of value) {
        if (
            !isRecord(condition) ||
            !hasOnlyKeys(condition, CONDITION_KEYS) ||
            !isNonEmptyString(condition.kind) ||
            !CONDITION_KINDS.has(condition.kind as CommandBatchConditionKind)
        ) {
            return null;
        }
        if (condition.targetIds !== undefined && !isUniqueNonEmptyStrings(condition.targetIds)) {
            return null;
        }
        const conditionValue = condition.value;
        if (
            conditionValue !== undefined &&
            typeof conditionValue !== 'string' &&
            typeof conditionValue !== 'boolean' &&
            !(typeof conditionValue === 'number' && Number.isFinite(conditionValue))
        ) {
            return null;
        }
        conditions.push({
            kind: condition.kind as CommandBatchConditionKind,
            targetIds: condition.targetIds ? [...condition.targetIds] : undefined,
            value: conditionValue,
        });
    }
    return conditions;
}

function parseDependencies(value: unknown): CommandBatchDependency[] | null {
    if (!isBoundedArray(value)) {
        return null;
    }
    const dependencies: CommandBatchDependency[] = [];
    for (const dependency of value) {
        if (
            !isRecord(dependency) ||
            !hasOnlyKeys(dependency, DEPENDENCY_KEYS) ||
            !isNonEmptyString(dependency.commandId) ||
            !isUniqueNonEmptyStrings(dependency.dependsOn)
        ) {
            return null;
        }
        dependencies.push({ commandId: dependency.commandId, dependsOn: [...dependency.dependsOn] });
    }
    return dependencies;
}

function parseBindings(value: unknown): CommandBatchLocalBinding[] | null {
    if (!isBoundedArray(value)) {
        return null;
    }
    const bindings: CommandBatchLocalBinding[] = [];
    for (const binding of value) {
        if (
            !isRecord(binding) ||
            !hasOnlyKeys(binding, BINDING_KEYS) ||
            !isNonEmptyString(binding.bindingId) ||
            !isNonEmptyString(binding.producerArgument) ||
            !isNonEmptyString(binding.producerCommandId)
        ) {
            return null;
        }
        bindings.push({
            bindingId: binding.bindingId,
            producerArgument: binding.producerArgument,
            producerCommandId: binding.producerCommandId,
        });
    }
    return bindings;
}

function parseGrants(value: unknown): CommandBatchGrants | null {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, GRANTS_KEYS) ||
        !isUniqueNonEmptyStrings(value.allowedOperationPrefixes)
    ) {
        return null;
    }
    for (const key of GRANT_KEYS) {
        if (typeof value[key] !== 'boolean') {
            return null;
        }
    }
    return {
        allowedOperationPrefixes: [...value.allowedOperationPrefixes],
        create: value.create as boolean,
        delete: value.delete as boolean,
        routing: value.routing as boolean,
        tempo: value.tempo as boolean,
        master: value.master as boolean,
        file: value.file as boolean,
        audioUpload: value.audioUpload as boolean,
        remoteGeneration: value.remoteGeneration as boolean,
        autoCommit: value.autoCommit as boolean,
    };
}

function parseBudgets(value: unknown): CommandBatchBudgets | null {
    if (!isRecord(value) || !hasOnlyKeys(value, BUDGETS_KEYS)) {
        return null;
    }
    for (const key of BUDGET_KEYS) {
        const budget = value[key];
        if (!Number.isSafeInteger(budget) || (budget as number) < 0) {
            return null;
        }
    }
    return value as CommandBatchBudgets;
}

function getCommandTargetIds(command: VersionedCommandEnvelope): string[] {
    const targets = new Set<string>();
    for (const reference of getVersionedCommandTargetReferences(command)) {
        if (reference.scope === 'stable') {
            targets.add(reference.id);
        }
    }
    return [...targets];
}

function parseCommands(value: unknown): VersionedCommandEnvelope[] | null {
    if (!isBoundedArray(value) || value.length === 0) {
        return null;
    }
    const commands: VersionedCommandEnvelope[] = [];
    for (const command of value) {
        if (!isRecord(command)) {
            return null;
        }
        const parsed = parseVersionedCommandEnvelope(JSON.stringify(command));
        if (parsed.status === 'invalid') {
            return null;
        }
        commands.push(parsed.envelope);
    }
    return commands;
}

function validateCommandScope(commands: readonly VersionedCommandEnvelope[], scope: CommandBatchScope): string | null {
    const declaredTargets = new Set(scope.targetIds);
    const protectedTargets = new Set(scope.protectedTargetIds);
    for (const command of commands) {
        for (const targetId of getCommandTargetIds(command)) {
            if (!declaredTargets.has(targetId) || protectedTargets.has(targetId)) {
                return `Command target ${targetId} is outside the declared batch scope`;
            }
        }
        for (const time of command.time) {
            if (time.domain !== 'musical' || time.unit !== 'beats') {
                continue;
            }
            if (
                !scope.targetRanges.some((range) => time.value >= range.startBeat && time.value <= range.endBeat) ||
                scope.protectedRanges.some((range) => time.value >= range.startBeat && time.value < range.endBeat)
            ) {
                return `Command time ${time.value} beats is outside the declared batch scope`;
            }
        }
    }
    return null;
}

function validateConditions(
    preconditions: readonly CommandBatchCondition[],
    postconditions: readonly CommandBatchCondition[],
    scope: CommandBatchScope,
    baseRevision: string
): string | null {
    if (!preconditions.some((condition) => condition.kind === 'project-revision' && condition.value === baseRevision)) {
        return 'Command batch requires an exact base-revision precondition';
    }
    const declaredIds = new Set([...scope.targetIds, ...scope.protectedTargetIds]);
    for (const condition of [...preconditions, ...postconditions]) {
        if (condition.targetIds?.some((targetId) => !declaredIds.has(targetId))) {
            return `Command batch condition enlarges the declared scope: ${condition.kind}`;
        }
    }
    return null;
}

function validateDependencies(
    commands: readonly VersionedCommandEnvelope[],
    dependencies: readonly CommandBatchDependency[]
): string | null {
    const positions = new Map(commands.map((command, index) => [command.commandId, index]));
    const covered = new Set<string>();
    for (const dependency of dependencies) {
        const commandIndex = positions.get(dependency.commandId);
        if (commandIndex === undefined || covered.has(dependency.commandId)) {
            return `Batch dependencies reference an unknown or duplicate command: ${dependency.commandId}`;
        }
        covered.add(dependency.commandId);
        if (dependency.dependsOn.some((id) => (positions.get(id) ?? Number.POSITIVE_INFINITY) >= commandIndex)) {
            return `Batch dependencies are missing or out of order for ${dependency.commandId}`;
        }
    }
    for (const [index, command] of commands.entries()) {
        const declared = dependencies.find((dependency) => dependency.commandId === command.commandId)?.dependsOn ?? [];
        if (
            declared.length !== command.dependencyIds.length ||
            declared.some((dependencyId) => !command.dependencyIds.includes(dependencyId)) ||
            command.dependencyIds.some((dependencyId) => (positions.get(dependencyId) ?? index) >= index)
        ) {
            return `Batch dependencies are missing or out of order for ${command.commandId}`;
        }
    }
    return null;
}

function validateBatchLocalBindings(
    commands: readonly VersionedCommandEnvelope[],
    bindings: readonly CommandBatchLocalBinding[]
): string | null {
    const positions = new Map(commands.map((command, index) => [command.commandId, index]));
    const bindingIds = bindings.map((binding) => binding.bindingId);
    if (new Set(bindingIds).size !== bindingIds.length) {
        return 'Batch-local binding IDs must be unique';
    }
    for (const binding of bindings) {
        const producerIndex = positions.get(binding.producerCommandId);
        const producer = producerIndex === undefined ? undefined : commands[producerIndex];
        if (
            !producer ||
            !producer.applicationAssignedIds.some((assigned) => assigned.argument === binding.producerArgument)
        ) {
            return `Batch-local binding producer is invalid: ${binding.bindingId}`;
        }
    }
    const bindingsById = new Map(bindings.map((binding) => [binding.bindingId, binding]));
    for (const [consumerIndex, command] of commands.entries()) {
        for (const reference of command.objectReferences) {
            if (reference.scope !== 'batch-local') {
                continue;
            }
            const binding = bindingsById.get(reference.id);
            const producerIndex = binding ? positions.get(binding.producerCommandId) : undefined;
            if (
                !binding ||
                producerIndex === undefined ||
                producerIndex >= consumerIndex ||
                !command.dependencyIds.includes(binding.producerCommandId)
            ) {
                return `Batch-local reference is missing or out of order: ${reference.id}`;
            }
        }
    }
    return null;
}

function validateGrants(commands: readonly VersionedCommandEnvelope[], grants: CommandBatchGrants): string | null {
    for (const command of commands) {
        if (!grants.allowedOperationPrefixes.some((prefix) => command.operation.startsWith(prefix))) {
            return `Command operation prefix is not granted: ${command.operation}`;
        }
    }
    const effects = getVersionedCommandBatchEffects(commands);
    for (const grant of effects.requiredGrants) {
        if (!grants[grant]) {
            return `Command batch requires the ${grant} grant`;
        }
    }
    return null;
}

function validateBudgets(commands: readonly VersionedCommandEnvelope[], budgets: CommandBatchBudgets): string | null {
    if (commands.length > budgets.maxCommands) {
        return 'Command batch exceeds maxCommands';
    }
    const effects = getVersionedCommandBatchEffects(commands);
    const counts: Array<[keyof CommandBatchBudgets, number]> = [
        ['maxCreatedTracks', effects.createdTracks],
        ['maxDeletedObjects', effects.deletedObjects],
        ['maxAffectedTracks', effects.affectedTrackIds.size],
        ['maxAffectedClips', effects.affectedClipIds.size],
        ['maxAutomationPoints', effects.automationPoints],
        ['maxImportedAssets', effects.importedAssets],
        ['maxRenderJobs', effects.renderJobs],
    ];
    const exceeded = counts.find(([key, count]) => count > budgets[key]);
    if (exceeded) {
        return `Command batch exceeds ${exceeded[0]}`;
    }
    return null;
}

export function parseVersionedCommandBatchEnvelope(
    serialized: string,
    authority?: CommandBatchAuthority
): ParseVersionedCommandBatchEnvelopeResult {
    let value: unknown;
    try {
        value = JSON.parse(serialized);
    } catch {
        return { status: 'invalid', reason: 'Command batch must be valid JSON' };
    }
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, BATCH_KEYS) ||
        value.schemaVersion !== VERSIONED_COMMAND_BATCH_SCHEMA_VERSION
    ) {
        return { status: 'invalid', reason: 'Unsupported command batch schema version' };
    }
    if (
        !isNonEmptyString(value.runId) ||
        !isNonEmptyString(value.batchId) ||
        !isNonEmptyString(value.projectId) ||
        !isNonEmptyString(value.baseRevision) ||
        !isNonEmptyString(value.idempotencyKey) ||
        !isNonEmptyString(value.intent) ||
        (value.mode !== 'preview' && value.mode !== 'commit')
    ) {
        return { status: 'invalid', reason: 'Command batch identity and mode are required' };
    }
    const scope = parseScope(value.scope);
    const preconditions = parseConditions(value.preconditions);
    const commands = parseCommands(value.commands);
    const postconditions = parseConditions(value.postconditions);
    const dependencies = parseDependencies(value.dependencies);
    const batchLocalBindings = parseBindings(value.batchLocalBindings);
    const grants = parseGrants(value.grants);
    const budgets = parseBudgets(value.budgets);
    if (!scope) {
        return { status: 'invalid', reason: 'Command batch scope is malformed' };
    }
    if (!preconditions) {
        return { status: 'invalid', reason: 'Command batch preconditions are malformed' };
    }
    if (!commands) {
        return { status: 'invalid', reason: 'Command batch commands are malformed' };
    }
    if (!postconditions) {
        return { status: 'invalid', reason: 'Command batch postconditions are malformed' };
    }
    if (!dependencies) {
        return { status: 'invalid', reason: 'Command batch dependencies are malformed' };
    }
    if (!batchLocalBindings) {
        return { status: 'invalid', reason: 'Command batch local bindings are malformed' };
    }
    if (!grants) {
        return { status: 'invalid', reason: 'Command batch grants are malformed' };
    }
    if (!budgets) {
        return { status: 'invalid', reason: 'Command batch budgets are malformed' };
    }
    if (
        authority &&
        (value.projectId !== authority.projectId ||
            value.baseRevision !== authority.baseRevision ||
            JSON.stringify(scope) !== JSON.stringify(authority.scope) ||
            JSON.stringify(grants) !== JSON.stringify(authority.grants) ||
            JSON.stringify(budgets) !== JSON.stringify(authority.budgets))
    ) {
        return { status: 'invalid', reason: 'Command batch exceeds application-issued authority' };
    }
    const commandIds = commands.map((command) => command.commandId);
    if (new Set(commandIds).size !== commandIds.length) {
        return { status: 'invalid', reason: 'Command IDs must be unique within a batch' };
    }
    if (commands.some((command) => command.normalizedProjectRevision !== value.baseRevision)) {
        return { status: 'invalid', reason: 'Command batch base revision does not match its commands' };
    }
    if (commands.some((command) => command.groupId !== undefined && command.groupId !== value.batchId)) {
        return { status: 'invalid', reason: 'Command group IDs do not match the batch identity' };
    }
    const failure =
        validateConditions(preconditions, postconditions, scope, value.baseRevision) ??
        validateCommandScope(commands, scope) ??
        validateDependencies(commands, dependencies) ??
        validateBatchLocalBindings(commands, batchLocalBindings) ??
        validateGrants(commands, grants) ??
        validateBudgets(commands, budgets);
    if (failure) {
        return { status: 'invalid', reason: failure };
    }
    return {
        status: 'valid',
        envelope: {
            schemaVersion: VERSIONED_COMMAND_BATCH_SCHEMA_VERSION,
            runId: value.runId,
            batchId: value.batchId,
            projectId: value.projectId,
            baseRevision: value.baseRevision,
            idempotencyKey: value.idempotencyKey,
            intent: value.intent,
            mode: value.mode,
            scope,
            preconditions,
            commands,
            postconditions,
            dependencies,
            batchLocalBindings,
            grants,
            budgets,
        },
    };
}
