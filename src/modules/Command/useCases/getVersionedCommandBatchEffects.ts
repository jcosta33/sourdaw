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

type VersionedCommandBatchDynamicEffects = {
    affectedTrackIds?: readonly string[];
    affectedClipIds?: readonly string[];
    affectedTargetIds?: readonly string[];
    automationPoints?: number;
    deletedObjects?: number;
};

const CREATE_OPERATIONS = new Set([
    'importStemSet',
    'addTrack',
    'createBus',
    'duplicateTrack',
    'addClip',
    'duplicateClip',
    'duplicateClipToNextBar',
    'splitClip',
    'glueClips',
    'createDrumPreviewBranches',
    'createVcaGroup',
    'addDevice',
    'addSend',
    'addSidechainRoute',
    'addAdjustmentRegion',
    'addAutomationLane',
    'addAutomationPoint',
    'automateSendRange',
    'automateSendRanges',
    'automateTrackGainRange',
    'renderProjectSections',
    'addMarker',
    'addSection',
]);
const DELETE_OPERATIONS = new Set([
    'removeTrack',
    'removeClip',
    'removeMarker',
    'removeSection',
    'removeDevice',
    'removeSend',
    'removeSidechainRoute',
    'removeAdjustmentRegion',
    'glueClips',
    'thinAutomation',
]);
const ROUTING_OPERATIONS = new Set([
    'createBus',
    'addSend',
    'setSend',
    'removeSend',
    'setTrackOutput',
    'addSidechainRoute',
    'removeSidechainRoute',
]);
const TEMPO_OPERATIONS = new Set(['setTempo', 'setTimeSignature']);
const MASTER_OPERATIONS = new Set(['setMasterGain']);
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
    dynamicEffects: VersionedCommandBatchDynamicEffects = {}
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
