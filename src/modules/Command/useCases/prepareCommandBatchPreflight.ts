import {
    type CommandBatchCondition,
    type CommandBatchRange,
    type VersionedCommandBatchEnvelope,
} from '../models/VersionedCommandBatchEnvelope';

import { commandBatchPreflightPort } from './commandBatchPreflightPort';
import { type CommandBatchValidationPreparation } from './commandBatchValidation';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { isDerivedSourceSupportPath } from './isDerivedSourceSupportPath';

type CommandBatchAssetReference = {
    assetHash?: string;
    audioBufferId?: string;
};

const COMMAND_PROJECT_DOCUMENT_ID = 'root';

function rangesOverlap(left: CommandBatchRange, right: CommandBatchRange): boolean {
    if (left.startBeat === left.endBeat) {
        return left.startBeat >= right.startBeat && left.startBeat < right.endBeat;
    }
    return left.startBeat < right.endBeat && right.startBeat < left.endBeat;
}

function collectAssetReferences(
    value: unknown,
    references: CommandBatchAssetReference[],
    operation: string,
    path: string
): void {
    // A persisted identity guard is checked against its actual source owner;
    // it neither imports an asset nor asserts runtime cache availability.
    if (
        isDerivedSourceSupportPath(operation, path) &&
        (/^audioSourcePromotions\[\d+\]\.sourceInputs\.media$/.test(path) ||
            /^audioSourcePromotion\.clips\[\d+\]\.inputs$/.test(path))
    ) {
        return;
    }
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            collectAssetReferences(item, references, operation, `${path}[${index}]`);
        }
        return;
    }
    if (typeof value !== 'object' || value === null) {
        return;
    }
    const record = value as Record<string, unknown>;
    const audioBufferId = typeof record.audioBufferId === 'string' ? record.audioBufferId : undefined;
    const assetHash = typeof record.assetHash === 'string' ? record.assetHash : undefined;
    if (audioBufferId || assetHash) {
        references.push({
            ...(audioBufferId ? { audioBufferId } : {}),
            ...(assetHash ? { assetHash } : {}),
        });
    }
    for (const [key, child] of Object.entries(record)) {
        collectAssetReferences(child, references, operation, path === '' ? key : `${path}.${key}`);
    }
}

function getAssetReferences(envelope: VersionedCommandBatchEnvelope): CommandBatchAssetReference[] {
    const references: CommandBatchAssetReference[] = [];
    for (const command of envelope.commands) {
        collectAssetReferences(command.arguments, references, command.operation, '');
    }
    return references;
}

function getConditionTargetIds(conditions: readonly CommandBatchCondition[]): string[] {
    const targetIds = new Set<string>();
    for (const condition of conditions) {
        for (const targetId of condition.targetIds ?? []) {
            targetIds.add(targetId);
        }
    }
    return [...targetIds];
}

function getRequiredTargetIds(envelope: VersionedCommandBatchEnvelope): string[] {
    return [
        ...new Set([
            ...envelope.scope.targetIds,
            ...envelope.scope.protectedTargetIds,
            ...getConditionTargetIds(envelope.preconditions),
            ...getConditionTargetIds(envelope.postconditions),
        ]),
    ];
}

function validateAssets(
    references: readonly CommandBatchAssetReference[],
    availableAudioBufferIds: ReadonlySet<string>,
    availableAssetHashes: ReadonlySet<string>
): string | null {
    for (const reference of references) {
        if (reference.audioBufferId !== undefined && !availableAudioBufferIds.has(reference.audioBufferId)) {
            return `Command batch asset is unavailable: ${reference.audioBufferId}`;
        }
        if (reference.assetHash !== undefined && !availableAssetHashes.has(reference.assetHash)) {
            return `Command batch asset is unavailable: ${reference.assetHash}`;
        }
    }
    return null;
}

function validateConditions(input: {
    conditions: readonly CommandBatchCondition[];
    envelope: VersionedCommandBatchEnvelope;
    lockedRanges: readonly CommandBatchRange[];
    revision: string;
    targetFingerprints: Readonly<Record<string, string>>;
}): string | null {
    for (const condition of input.conditions) {
        if (condition.kind === 'project-revision' && condition.value !== input.revision) {
            return 'Command batch base revision does not match current project state';
        }
        if (condition.kind === 'targets-exist') {
            const missing = (condition.targetIds ?? []).find(
                (targetId) => input.targetFingerprints[targetId] === undefined
            );
            if (missing) {
                return `Command batch target does not exist: ${missing}`;
            }
        }
        if (condition.kind === 'targets-absent') {
            const present = (condition.targetIds ?? []).find(
                (targetId) => input.targetFingerprints[targetId] !== undefined
            );
            if (present) {
                return `Command batch target already exists: ${present}`;
            }
        }
        if (
            condition.kind === 'ranges-unlocked' &&
            input.envelope.scope.targetRanges.some((range) =>
                input.lockedRanges.some((lockedRange) => rangesOverlap(range, lockedRange))
            )
        ) {
            return 'Command batch target range is locked';
        }
    }
    return null;
}

function readValidationRevision(baseRevision: string): string {
    if (!commandProjectRevisionPort.isConfigured()) {
        return baseRevision;
    }
    if (commandProjectRevisionPort.matchesLiveIgnoringSaveWrites(baseRevision)) {
        return baseRevision;
    }
    return commandProjectRevisionPort.capture();
}

export function prepareCommandBatchPreflight(
    envelope: VersionedCommandBatchEnvelope,
    options: { allowCompatibleProjectDivergence?: boolean } = {}
): CommandBatchValidationPreparation {
    const targetIds = getRequiredTargetIds(envelope);
    const assetReferences = getAssetReferences(envelope);
    let before: ReturnType<typeof commandBatchPreflightPort.capture>;
    let beforeRevision: string;
    try {
        beforeRevision = readValidationRevision(envelope.baseRevision);
        before = commandBatchPreflightPort.capture({ assetReferences, targetIds });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { status: 'rejected', reason: `Command batch preflight failed: ${reason}` };
    }
    if (!before) {
        return { status: 'rejected', reason: 'Command batch preflight state is unavailable' };
    }
    if (before.projectId !== envelope.projectId) {
        return { status: 'rejected', reason: 'Command batch project does not match the active project' };
    }
    if (!before.projectInvariantsValid) {
        return { status: 'rejected', reason: 'Command batch project invariants are invalid' };
    }
    if (!before.audioGraphValid) {
        return { status: 'rejected', reason: 'Command batch audio graph is invalid' };
    }
    const preconditions = options.allowCompatibleProjectDivergence
        ? envelope.preconditions.filter((condition) => condition.kind !== 'project-revision')
        : envelope.preconditions;
    const conditionFailure = validateConditions({
        conditions: preconditions,
        envelope,
        lockedRanges: before.lockedRanges,
        revision: beforeRevision,
        targetFingerprints: before.targetFingerprints,
    });
    if (conditionFailure) {
        return { status: 'rejected', reason: conditionFailure };
    }
    const assetFailure = validateAssets(
        assetReferences,
        new Set(before.availableAudioBufferIds),
        new Set(before.availableAssetHashes)
    );
    if (assetFailure) {
        return { status: 'rejected', reason: assetFailure };
    }
    const protectedFingerprints = Object.fromEntries(
        envelope.scope.protectedTargetIds.flatMap((targetId) => {
            const fingerprint = before.targetFingerprints[targetId];
            return fingerprint === undefined ? [] : [[targetId, fingerprint]];
        })
    );

    return {
        status: 'ready',
        prepareExecution() {
            let executionRevision: string;
            let executionValidationRevision: string;
            let isMutationAuthorized: () => boolean;
            try {
                executionValidationRevision = readValidationRevision(envelope.baseRevision);
                executionRevision = commandProjectRevisionPort.capture();
                isMutationAuthorized = commandProjectRevisionPort.captureMutationAuthorization();
                // The caller enters its exact storage scope before any handler can publish.
                if (!isMutationAuthorized()) {
                    return { status: 'rejected', reason: 'Command batch execution source is unavailable' };
                }
                const revisionFailure = validateConditions({
                    conditions: preconditions.filter((condition) => condition.kind === 'project-revision'),
                    envelope,
                    lockedRanges: before.lockedRanges,
                    revision: executionValidationRevision,
                    targetFingerprints: before.targetFingerprints,
                });
                if (revisionFailure) {
                    return { status: 'rejected', reason: revisionFailure };
                }
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                return { status: 'rejected', reason: `Command batch execution preparation failed: ${reason}` };
            }
            return {
                status: 'ready',
                validation: {
                    preparePostconditions() {
                        let validationRevision: string;
                        try {
                            // Historical reads must finish before Automerge opens the candidate.
                            const currentValidationRevision = readValidationRevision(envelope.baseRevision);
                            const currentRevision = commandProjectRevisionPort.capture();
                            if (!isMutationAuthorized()) {
                                return {
                                    status: 'rejected',
                                    reason: 'Command batch project changed after execution source preparation',
                                };
                            }
                            // Only this exact owner's published prefix may retain its admitted source.
                            // A compatible foreign source keeps its own revision, never the old base.
                            validationRevision =
                                currentRevision === executionRevision
                                    ? currentValidationRevision
                                    : executionValidationRevision;
                        } catch (error) {
                            const reason = error instanceof Error ? error.message : String(error);
                            return {
                                status: 'rejected',
                                reason: `Command batch postcondition preparation failed: ${reason}`,
                            };
                        }
                        return {
                            status: 'ready',
                            postconditions: {
                                documentId: COMMAND_PROJECT_DOCUMENT_ID,
                                validate(projectDocument): string | null {
                                    let after: ReturnType<typeof commandBatchPreflightPort.capture>;
                                    try {
                                        if (!isMutationAuthorized()) {
                                            return 'Command batch project changed after execution source preparation';
                                        }
                                        after = commandBatchPreflightPort.capture({
                                            assetReferences,
                                            projectDocument,
                                            targetIds,
                                        });
                                        if (!isMutationAuthorized()) {
                                            return 'Command batch project changed after execution source preparation';
                                        }
                                    } catch (error) {
                                        const reason = error instanceof Error ? error.message : String(error);
                                        return `Command batch postcondition validation failed: ${reason}`;
                                    }
                                    if (!after) {
                                        return 'Command batch preflight state became unavailable';
                                    }
                                    if (!after.projectInvariantsValid) {
                                        return 'Command batch violated project invariants';
                                    }
                                    if (!after.audioGraphValid) {
                                        return 'Command batch produced an invalid audio graph';
                                    }
                                    const postconditionFailure = validateConditions({
                                        conditions: envelope.postconditions,
                                        envelope,
                                        lockedRanges: after.lockedRanges,
                                        revision: validationRevision,
                                        targetFingerprints: after.targetFingerprints,
                                    });
                                    if (postconditionFailure) {
                                        return postconditionFailure;
                                    }
                                    for (const condition of envelope.postconditions) {
                                        if (condition.kind !== 'targets-unchanged') {
                                            continue;
                                        }
                                        const changed = Object.keys(protectedFingerprints).find(
                                            (targetId) =>
                                                after.targetFingerprints[targetId] !== protectedFingerprints[targetId]
                                        );
                                        if (changed) {
                                            return `Command batch changed protected target: ${changed}`;
                                        }
                                    }
                                    return null;
                                },
                            },
                        };
                    },
                },
            };
        },
    };
}
