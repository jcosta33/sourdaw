import {
    type CommandBatchCondition,
    type CommandBatchRange,
    type VersionedCommandBatchEnvelope,
} from '../models/VersionedCommandBatchEnvelope';

import { commandBatchPreflightPort } from './commandBatchPreflightPort';
import { type CommandBatchValidationPreparation } from './commandBatchValidation';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';

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

function collectAssetReferences(value: unknown, references: CommandBatchAssetReference[]): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectAssetReferences(item, references);
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
    for (const child of Object.values(record)) {
        collectAssetReferences(child, references);
    }
}

function getAssetReferences(envelope: VersionedCommandBatchEnvelope): CommandBatchAssetReference[] {
    const references: CommandBatchAssetReference[] = [];
    for (const command of envelope.commands) {
        collectAssetReferences(command.arguments, references);
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

export function prepareCommandBatchPreflight(
    envelope: VersionedCommandBatchEnvelope
): CommandBatchValidationPreparation {
    const targetIds = getRequiredTargetIds(envelope);
    const assetReferences = getAssetReferences(envelope);
    let before: ReturnType<typeof commandBatchPreflightPort.capture>;
    try {
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
    const conditionFailure = validateConditions({
        conditions: envelope.preconditions,
        envelope,
        lockedRanges: before.lockedRanges,
        revision: commandProjectRevisionPort.isConfigured()
            ? commandProjectRevisionPort.capture()
            : envelope.baseRevision,
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
        postconditions: {
            documentId: COMMAND_PROJECT_DOCUMENT_ID,
            validate(projectDocument): string | null {
                let after: ReturnType<typeof commandBatchPreflightPort.capture>;
                try {
                    after = commandBatchPreflightPort.capture({ assetReferences, projectDocument, targetIds });
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
                    revision: commandProjectRevisionPort.isConfigured()
                        ? commandProjectRevisionPort.capture()
                        : envelope.baseRevision,
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
                        (targetId) => after.targetFingerprints[targetId] !== protectedFingerprints[targetId]
                    );
                    if (changed) {
                        return `Command batch changed protected target: ${changed}`;
                    }
                }
                return null;
            },
        },
    };
}
