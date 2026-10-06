import { type ArbitraryCommandListEvidence } from '../compileArbitraryCommandList';

type SelectorEvidence = ArbitraryCommandListEvidence['selectors'][number];
type ItemEvidence = ArbitraryCommandListEvidence['items'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isIndexArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((entry) => Number.isSafeInteger(entry) && entry >= 0);
}

function isCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

function isPrecondition(value: unknown): value is SelectorEvidence['preconditions'][number] {
    return isRecord(value) && typeof value.stableId === 'string' && typeof value.fingerprint === 'string';
}

function isSelectorSlice(value: unknown): value is SelectorEvidence['slice'] {
    return (
        value === undefined ||
        (isRecord(value) &&
            isStringArray(value.setStableIds) &&
            isCount(value.offset) &&
            isRecord(value.selector) &&
            typeof value.selector.entity === 'string')
    );
}

function isSelectorEvidence(value: unknown): value is SelectorEvidence {
    return (
        isRecord(value) &&
        typeof value.itemId === 'string' &&
        isStringArray(value.stableIds) &&
        isStringArray(value.excludedIds) &&
        isStringArray(value.protectedExclusions) &&
        Array.isArray(value.preconditions) &&
        value.preconditions.every(isPrecondition) &&
        (value.predicate === undefined ||
            (isRecord(value.predicate) &&
                typeof value.predicate.entity === 'string' &&
                isRecord(value.predicate.match))) &&
        isSelectorSlice(value.slice)
    );
}

function isDirectTarget(value: unknown): value is NonNullable<ItemEvidence['directTargets']>[number] {
    return (
        isRecord(value) &&
        typeof value.argument === 'string' &&
        typeof value.capability === 'string' &&
        (value.cardinality === 'one' || value.cardinality === 'many') &&
        isStringArray(value.stableIds)
    );
}

function isItemEvidence(value: unknown): value is ItemEvidence {
    return (
        isRecord(value) &&
        typeof value.itemId === 'string' &&
        typeof value.commandName === 'string' &&
        isStringArray(value.canonicalStableIds) &&
        isStringArray(value.declaredCommandIdentities) &&
        isStringArray(value.dependsOn) &&
        isStringArray(value.stableIds) &&
        isIndexArray(value.representativeCommandIndexes) &&
        isCount(value.declaredCommandCount) &&
        isCount(value.omittedCommandCount) &&
        isCount(value.commandStart) &&
        isCount(value.commandCount) &&
        isOptionalString(value.targetArgument) &&
        isOptionalString(value.targetCapability) &&
        (value.targetCardinality === undefined || value.targetCardinality === 'many') &&
        (value.directTargets === undefined ||
            (Array.isArray(value.directTargets) && value.directTargets.every(isDirectTarget)))
    );
}

function isCommand(value: unknown): value is ArbitraryCommandListEvidence['commands'][number] {
    return isRecord(value) && typeof value.name === 'string' && isRecord(value.arguments);
}

function isArbitraryCommandListEvidence(value: unknown): value is ArbitraryCommandListEvidence {
    return (
        isRecord(value) &&
        value.schemaVersion === 1 &&
        typeof value.snapshotRevision === 'string' &&
        isStringArray(value.providerKnownTargetIds) &&
        Array.isArray(value.selectors) &&
        value.selectors.every(isSelectorEvidence) &&
        Array.isArray(value.items) &&
        value.items.every(isItemEvidence) &&
        Array.isArray(value.commands) &&
        value.commands.every(isCommand) &&
        (value.creativeAuthorityId === null || typeof value.creativeAuthorityId === 'string') &&
        isStringArray(value.expandedMidiTransforms)
    );
}

/**
 * Reads back the compiled slice a schedule kept serialized for a later batch. The run persisted it,
 * but it crossed a storage boundary, so its shape is checked before the evidence validator and the
 * bridge trust any field of it; anything unreadable is refused rather than half-proposed.
 */
export function readBulkSetSliceEvidence(serialized: string): ArbitraryCommandListEvidence | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized);
    } catch {
        return null;
    }
    return isArbitraryCommandListEvidence(parsed) ? parsed : null;
}
