import {
    type CommandBatchActionEffect,
    type CommandBatchCountReader,
    commandBatchEffectByActionType,
} from '../models/CommandBatchActionEffect';
import { type CommandBatchDynamicEffects } from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function readCount(
    command: VersionedCommandEnvelope,
    select: (effect: CommandBatchActionEffect) => CommandBatchCountReader | undefined
): number {
    const reader = select(commandBatchEffectByActionType[command.operation]);
    return reader === undefined ? 0 : reader(command.arguments);
}

function getDeletedObjectCount(command: VersionedCommandEnvelope): number {
    const effect = commandBatchEffectByActionType[command.operation];
    if (effect.deletedObjects !== undefined) {
        return effect.deletedObjects(command.arguments);
    }
    if (typeof effect.delete === 'function') {
        return effect.delete(command.arguments);
    }
    return effect.delete ? 1 : 0;
}

function requiresGrant(grant: true | CommandBatchCountReader | undefined, command: VersionedCommandEnvelope): boolean {
    return typeof grant === 'function' ? grant(command.arguments) > 0 : grant === true;
}

function addRequiredGrants(command: VersionedCommandEnvelope, requiredGrants: Set<CommandGrant>): void {
    const effect = commandBatchEffectByActionType[command.operation];
    if (requiresGrant(effect.create, command)) {
        requiredGrants.add('create');
    }
    if (requiresGrant(effect.delete, command)) {
        requiredGrants.add('delete');
    }
    if (effect.routing) {
        requiredGrants.add('routing');
    }
    if (effect.tempo) {
        requiredGrants.add('tempo');
    }
    if (effect.master) {
        requiredGrants.add('master');
    }
    if (effect.file) {
        requiredGrants.add('file');
    }
    if (effect.audioUpload) {
        requiredGrants.add('audioUpload');
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
        createdTracks += readCount(command, (effect) => effect.createdTracks);
        deletedObjects += getDeletedObjectCount(command);
        automationPoints += readCount(command, (effect) => effect.automationPoints);
        importedAssets += readCount(command, (effect) => effect.importedAssets);
        renderJobs += readCount(command, (effect) => effect.renderJobs);
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
