import { type CommandBatchDynamicEffects } from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import {
    executableAppActionEffectsByType,
    getExecutableAppActionEffect,
    type ExecutableAppActionEffect,
} from './executableAppActionEffects';

type CommandGrant = 'create' | 'delete' | 'routing' | 'tempo' | 'master' | 'file' | 'audioUpload' | 'remoteGeneration';

export type VersionedCommandBatchEffects = {
    requiredGrants: ReadonlySet<CommandGrant>;
    createdTracks: number;
    deletedObjects: number;
    affectedTrackIds: ReadonlySet<string>;
    affectedClipIds: ReadonlySet<string>;
    automationPoints: number;
    importedAssets: number;
    renderJobs: number;
};

// The five governed grant families are derived from the effect map, whose rows are traced
// through each production handler, so they cannot drift from what handlers actually do
// (#4115): an action carries the create grant exactly when its row declares `creates`, the
// delete grant exactly when it declares `removes`, and the routing, tempo, and master
// grants exactly when its unconditional `dimensions` name routing, project-timing, or
// master. Conditional dimensions stay out by design: they need an execution-time policy,
// not a request-time grant (see executableAppActionEffects.ts).
function collectGrantOperations(matches: (effect: ExecutableAppActionEffect) => boolean): ReadonlySet<string> {
    const operations = new Set<string>();
    for (const actionType of Object.keys(executableAppActionEffectsByType)) {
        const effect = getExecutableAppActionEffect(actionType);
        if (effect !== null && matches(effect)) {
            operations.add(actionType);
        }
    }
    return operations;
}

export const CREATE_OPERATIONS = collectGrantOperations((effect) => (effect.creates?.length ?? 0) > 0);
export const DELETE_OPERATIONS = collectGrantOperations((effect) => (effect.removes?.length ?? 0) > 0);
export const ROUTING_OPERATIONS = collectGrantOperations((effect) => effect.dimensions.includes('routing'));
export const TEMPO_OPERATIONS = collectGrantOperations((effect) => effect.dimensions.includes('project-timing'));
export const MASTER_OPERATIONS = collectGrantOperations((effect) => effect.dimensions.includes('master'));

// No effect-map field separates file access, audio upload, or remote generation from one
// another — importStemSet and renderProjectSections share the 'external' dimension while
// needing different grants here — so these three families stay hand-maintained.
const FILE_OPERATIONS = new Set(['importStemSet', 'renderProjectSections']);
const AUDIO_UPLOAD_OPERATIONS = new Set(['importStemSet']);
const REMOTE_GENERATION_OPERATIONS = new Set<string>();

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayLength(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
}

function addReferencedIds(
    command: VersionedCommandEnvelope,
    affectedTrackIds: Set<string>,
    affectedClipIds: Set<string>
): void {
    for (const reference of command.objectReferences) {
        if (reference.scope !== 'stable') {
            continue;
        }
        const argument = reference.argument.toLowerCase();
        if (argument.includes('track')) {
            affectedTrackIds.add(reference.id);
        }
        if (argument.includes('clip')) {
            affectedClipIds.add(reference.id);
        }
    }
}

function getCreatedTrackCount(command: VersionedCommandEnvelope): number {
    if (command.operation === 'importStemSet') {
        return arrayLength(command.arguments.stems) + 1;
    }
    if (
        command.operation === 'addTrack' ||
        command.operation === 'createBus' ||
        command.operation === 'duplicateTrack'
    ) {
        return 1;
    }
    return 0;
}

function getAutomationPointCount(command: VersionedCommandEnvelope): number {
    if (command.operation === 'addAutomationPoint') {
        return 1;
    }
    if (command.operation === 'automateSendRange' || command.operation === 'automateTrackGainRange') {
        return arrayLength(command.arguments.trackIds) * 2;
    }
    if (command.operation === 'automateSendRanges') {
        return arrayLength(command.arguments.trackIds) * arrayLength(command.arguments.sectionIds) * 2;
    }
    return 0;
}

function getDeletedObjectCount(command: VersionedCommandEnvelope): number {
    if (command.operation === 'removeTrack') {
        return (
            1 +
            arrayLength(command.arguments.expectedClipIds) +
            arrayLength(command.arguments.expectedAlternativeClipIds)
        );
    }
    if (command.operation === 'glueClips') {
        return Math.max(1, arrayLength(command.arguments.clipIds));
    }
    if (command.operation === 'thinAutomation') {
        return 0;
    }
    return DELETE_OPERATIONS.has(command.operation) ? 1 : 0;
}

function getRenderJobCount(command: VersionedCommandEnvelope): number {
    if (command.operation !== 'renderProjectSections') {
        return 0;
    }
    return arrayLength(command.arguments.sectionIds);
}

function getImportedAssetCount(command: VersionedCommandEnvelope): number {
    if (command.operation !== 'importStemSet') {
        return 0;
    }
    return arrayLength(command.arguments.stems);
}

function addRequiredGrants(command: VersionedCommandEnvelope, requiredGrants: Set<CommandGrant>): void {
    const operation = command.operation;
    if (CREATE_OPERATIONS.has(operation)) {
        requiredGrants.add('create');
    }
    if (DELETE_OPERATIONS.has(operation)) {
        requiredGrants.add('delete');
    }
    if (ROUTING_OPERATIONS.has(operation)) {
        requiredGrants.add('routing');
    }
    if (TEMPO_OPERATIONS.has(operation)) {
        requiredGrants.add('tempo');
    }
    if (MASTER_OPERATIONS.has(operation)) {
        requiredGrants.add('master');
    }
    if (FILE_OPERATIONS.has(operation)) {
        requiredGrants.add('file');
    }
    if (AUDIO_UPLOAD_OPERATIONS.has(operation)) {
        requiredGrants.add('audioUpload');
    }
    if (REMOTE_GENERATION_OPERATIONS.has(operation)) {
        requiredGrants.add('remoteGeneration');
    }
}

export function getVersionedCommandBatchEffects(
    commands: readonly VersionedCommandEnvelope[],
    dynamicEffects: CommandBatchDynamicEffects = {}
): VersionedCommandBatchEffects {
    const requiredGrants = new Set<CommandGrant>();
    const affectedTrackIds = new Set(dynamicEffects.affectedTrackIds ?? []);
    const affectedClipIds = new Set(dynamicEffects.affectedClipIds ?? []);
    let createdTracks = 0;
    let deletedObjects = dynamicEffects.deletedObjects ?? 0;
    let automationPoints = dynamicEffects.automationPoints ?? 0;
    let importedAssets = 0;
    let renderJobs = 0;
    for (const command of commands) {
        addRequiredGrants(command, requiredGrants);
        addReferencedIds(command, affectedTrackIds, affectedClipIds);
        createdTracks += getCreatedTrackCount(command);
        deletedObjects += getDeletedObjectCount(command);
        automationPoints += getAutomationPointCount(command);
        importedAssets += getImportedAssetCount(command);
        renderJobs += getRenderJobCount(command);
        if (command.operation === 'importStemSet' && isRecord(command.arguments)) {
            for (const stem of Array.isArray(command.arguments.stems) ? command.arguments.stems : []) {
                if (isRecord(stem) && typeof stem.trackId === 'string') {
                    affectedTrackIds.add(stem.trackId);
                }
            }
        }
    }
    return {
        requiredGrants,
        createdTracks,
        deletedObjects,
        affectedTrackIds,
        affectedClipIds,
        automationPoints,
        importedAssets,
        renderJobs,
    };
}
