import { type AppAction } from '#/utils/handlerContract';

import { type CommandBatchRange, type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

const SEMANTIC_PROJECT_DIFF_SCHEMA_VERSION = 1 as const;

type SemanticRecovery = 'inverse' | 'compensable' | 'irreversible';
type SemanticFactKind = 'created' | 'moved' | 'renamed' | 'edited' | 'routed' | 'automated' | 'asset' | 'project';
type AudioImpactLevel = 'none' | 'audible' | 'structural' | 'external';

type BuildSemanticProjectDiffInput = {
    envelope: VersionedCommandBatchEnvelope;
    projectDocument?: Readonly<Record<string, unknown>>;
    recoveryByCommandId?: Readonly<Record<string, SemanticRecovery>>;
    warnings?: readonly string[];
};

type SemanticFact = {
    commandId: string | null;
    groupId: string;
    objectIds: readonly string[];
    summary: string;
};

type DestructiveClassification =
    'deletion' | 'replacement' | 'consolidation' | 'overwrite' | 'source-mutation' | 'irreversible-external-effect';

const CREATED_OPERATIONS = new Set<AppAction['type']>([
    'addTrack',
    'createBus',
    'duplicateTrack',
    'addClip',
    'duplicateClip',
    'duplicateClipToNextBar',
    'splitClip',
    'createVcaGroup',
    'addDevice',
    'addSend',
    'addSidechainRoute',
    'addAdjustmentRegion',
    'addAutomationLane',
    'addAutomationPoint',
    'addMarker',
    'addSection',
]);
const MOVED_OPERATIONS = new Set<AppAction['type']>([
    'moveAdjustmentRegion',
    'moveChordEvent',
    'moveClip',
    'nudgeClip',
    'reorderTrack',
    'trimClipEnd',
    'trimClipStart',
]);
const ROUTED_OPERATIONS = new Set<AppAction['type']>([
    'createBus',
    'addSend',
    'setSend',
    'removeSend',
    'setTrackOutput',
    'addSidechainRoute',
    'removeSidechainRoute',
]);
const PROJECT_OPERATIONS = new Set<AppAction['type']>([
    'setTempo',
    'setTimeSignature',
    'addTimeSignatureChange',
    'removeTimeSignatureChange',
    'setProductionBrief',
    'insertTime',
    'deleteTime',
    'duplicateTimeRange',
]);
const DELETION_OPERATIONS = new Set<AppAction['type']>([
    'removeTrack',
    'removeClip',
    'removeMarker',
    'removeSection',
    'removeDevice',
    'removeSend',
    'removeSidechainRoute',
    'removeAdjustmentRegion',
    'removeAutomationLane',
    'removeAutomationPoint',
    'deleteTrackAlternative',
    'deleteGrooveTemplate',
    'deleteDrumPreviewBranches',
]);
const REPLACEMENT_OPERATIONS = new Set<AppAction['type']>([
    'bounceInPlace',
    'flattenTrack',
    'freezeTrack',
    'loadPreset',
    'loadTrackTemplate',
    'restoreProjectVersion',
]);
const CONSOLIDATION_OPERATIONS = new Set<AppAction['type']>([
    'glueClips',
    'consolidateAllTracks',
    'consolidateSelection',
    'createCompGroup',
]);
const OVERWRITE_OPERATIONS = new Set<AppAction['type']>([
    'copyMidiArticulations',
    'commitScratchPad',
    'setDeviceState',
    'setExternalPluginState',
    'setProductionBrief',
]);
const SOURCE_MUTATION_OPERATIONS = new Set<AppAction['type']>([
    'commitPitchEdit',
    'normalizeClip',
    'reverseClip',
    'stripSilence',
    'enableWarping',
]);
const EXTERNAL_EFFECT_OPERATIONS = new Set<AppAction['type']>([
    'renderProjectSections',
    'importStemSet',
    'importAudioFile',
    'importDawProject',
    'importMidiFile',
    'exportDawProject',
    'exportMidi',
    'exportProject',
    'generateAudio',
    'stemSeparate',
    'audioToMidi',
]);
const STRUCTURAL_AUDIO_OPERATIONS = new Set<AppAction['type']>([
    'setTempo',
    'setTimeSignature',
    'addTrack',
    'removeTrack',
    'createBus',
    'addDevice',
    'removeDevice',
    ...ROUTED_OPERATIONS,
]);
const NO_AUDIO_OPERATIONS = new Set<AppAction['type']>([
    'addMarker',
    'removeMarker',
    'setMarkerColor',
    'addSection',
    'removeSection',
    'renameSection',
    'renameTrack',
    'renameClip',
    'setTrackColor',
    'setClipColor',
    'selectTrack',
]);

function groupId(command: VersionedCommandEnvelope): string {
    return command.commandId;
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}

function commandObjectIds(command: VersionedCommandEnvelope): string[] {
    return unique([
        ...command.objectReferences.map((reference) => reference.id),
        ...command.applicationAssignedIds.map((assigned) => assigned.value),
    ]);
}

function semanticFactKinds(command: VersionedCommandEnvelope): SemanticFactKind[] {
    const kinds: SemanticFactKind[] = [];
    if (CREATED_OPERATIONS.has(command.operation)) {
        kinds.push('created');
    }
    if (MOVED_OPERATIONS.has(command.operation)) {
        kinds.push('moved');
    }
    if (command.operation.startsWith('rename')) {
        kinds.push('renamed');
    }
    if (ROUTED_OPERATIONS.has(command.operation)) {
        kinds.push('routed');
    }
    if (command.operation.toLowerCase().includes('automation')) {
        kinds.push('automated');
    }
    if (EXTERNAL_EFFECT_OPERATIONS.has(command.operation)) {
        kinds.push('asset');
    }
    if (PROJECT_OPERATIONS.has(command.operation)) {
        kinds.push('project');
    }
    if (kinds.length === 0) {
        kinds.push('edited');
    }
    return kinds;
}

function destructiveClassification(command: VersionedCommandEnvelope): DestructiveClassification | null {
    if (DELETION_OPERATIONS.has(command.operation)) {
        return 'deletion';
    }
    if (REPLACEMENT_OPERATIONS.has(command.operation)) {
        return 'replacement';
    }
    if (CONSOLIDATION_OPERATIONS.has(command.operation)) {
        return 'consolidation';
    }
    if (OVERWRITE_OPERATIONS.has(command.operation)) {
        return 'overwrite';
    }
    if (SOURCE_MUTATION_OPERATIONS.has(command.operation)) {
        return 'source-mutation';
    }
    if (EXTERNAL_EFFECT_OPERATIONS.has(command.operation)) {
        return 'irreversible-external-effect';
    }
    return null;
}

function commandTimeRange(command: VersionedCommandEnvelope): CommandBatchRange | null {
    const beats = command.time
        .filter((time) => time.domain === 'musical' && time.unit === 'beats')
        .map((time) => time.value);
    if (beats.length === 0) {
        return null;
    }
    return { startBeat: Math.min(...beats), endBeat: Math.max(...beats) };
}

function impactForCommand(command: VersionedCommandEnvelope): AudioImpactLevel {
    if (EXTERNAL_EFFECT_OPERATIONS.has(command.operation)) {
        return 'external';
    }
    if (STRUCTURAL_AUDIO_OPERATIONS.has(command.operation)) {
        return 'structural';
    }
    if (NO_AUDIO_OPERATIONS.has(command.operation)) {
        return 'none';
    }
    return 'audible';
}

function greatestImpact(commands: readonly VersionedCommandEnvelope[]): AudioImpactLevel {
    const rank: Record<AudioImpactLevel, number> = { none: 0, audible: 1, structural: 2, external: 3 };
    return commands.reduce<AudioImpactLevel>((greatest, command) => {
        const current = impactForCommand(command);
        return rank[current] > rank[greatest] ? current : greatest;
    }, 'none');
}

function impactSummary(level: AudioImpactLevel): string {
    if (level === 'external') {
        return 'The preview includes an external render, import, export, or generated asset effect.';
    }
    if (level === 'structural') {
        return 'The preview changes timing or audio-graph topology.';
    }
    if (level === 'audible') {
        return 'The preview changes audible project parameters or content.';
    }
    return 'The preview changes metadata only.';
}

function documentTrackIds(document: Readonly<Record<string, unknown>> | undefined): ReadonlySet<string> {
    if (!document) {
        return new Set();
    }
    const tracksSlot = document.tracks;
    if (typeof tracksSlot !== 'object' || tracksSlot === null || Array.isArray(tracksSlot)) {
        return new Set();
    }
    const tracks = (tracksSlot as Readonly<Record<string, unknown>>).tracks;
    if (!Array.isArray(tracks)) {
        return new Set();
    }
    return new Set(
        tracks.flatMap((track) => {
            if (typeof track !== 'object' || track === null || Array.isArray(track)) {
                return [];
            }
            const id = (track as Readonly<Record<string, unknown>>).id;
            return typeof id === 'string' ? [id] : [];
        })
    );
}

function affectedTrackIds(
    commands: readonly VersionedCommandEnvelope[],
    document: Readonly<Record<string, unknown>> | undefined
): string[] {
    const projectTrackIds = documentTrackIds(document);
    const referenced = commands.flatMap((command) =>
        command.objectReferences.flatMap((reference) =>
            reference.argument.toLowerCase().includes('track') || projectTrackIds.has(reference.id)
                ? [reference.id]
                : []
        )
    );
    const created = commands.flatMap((command) =>
        command.applicationAssignedIds.flatMap((assigned) =>
            assigned.argument.toLowerCase().includes('track') ||
            command.operation === 'addTrack' ||
            command.operation === 'createBus' ||
            command.operation === 'duplicateTrack'
                ? [assigned.value]
                : []
        )
    );
    return unique([...referenced, ...created]).sort();
}

function factsForCommands(commands: readonly VersionedCommandEnvelope[]) {
    const facts: Record<SemanticFactKind, SemanticFact[]> = {
        created: [],
        moved: [],
        renamed: [],
        edited: [],
        routed: [],
        automated: [],
        asset: [],
        project: [],
    };
    for (const command of commands) {
        for (const kind of semanticFactKinds(command)) {
            facts[kind].push({
                commandId: command.commandId,
                groupId: groupId(command),
                objectIds: commandObjectIds(command),
                summary: command.expectedEffect,
            });
        }
    }
    return facts;
}

export function buildSemanticProjectDiff(input: BuildSemanticProjectDiffInput) {
    const commands = input.envelope.commands;
    const facts = factsForCommands(commands);
    const protectedUnchanged: SemanticFact[] = input.envelope.scope.protectedTargetIds.map((objectId) => ({
        commandId: null,
        groupId: 'protected-unchanged',
        objectIds: [objectId],
        summary: `Protected object remains unchanged: ${objectId}`,
    }));
    const destructiveChanges = commands.flatMap((command) => {
        const classification = destructiveClassification(command);
        if (!classification) {
            return [];
        }
        return [
            {
                classification,
                commandIds: [command.commandId],
                consequence: command.expectedEffect,
                groupId: groupId(command),
                objectIds: commandObjectIds(command),
                recovery: input.recoveryByCommandId?.[command.commandId] ?? ('irreversible' as const),
            },
        ];
    });
    const warningValues = [...(input.warnings ?? [])];
    if (destructiveChanges.length > 0) {
        warningValues.push(
            `${destructiveChanges.length} destructive change${destructiveChanges.length === 1 ? '' : 's'} requires explicit acceptance.`
        );
    }
    if (protectedUnchanged.length > 0) {
        warningValues.push(
            `${protectedUnchanged.length} protected object${protectedUnchanged.length === 1 ? '' : 's'} remains unchanged.`
        );
    }
    if (destructiveChanges.some((change) => change.recovery === 'irreversible')) {
        warningValues.push('At least one destructive change has no inverse or compensation path.');
    }
    const ranges = commands.flatMap((command) => {
        const range = commandTimeRange(command);
        return range ? [range] : [];
    });
    const impact = greatestImpact(commands);
    const groups = unique(commands.map(groupId)).map((id) => {
        const groupCommands = commands.filter((command) => groupId(command) === id);
        const groupImpact = greatestImpact(groupCommands);
        const groupDestructiveChanges = destructiveChanges.filter((change) => change.groupId === id);
        return {
            id,
            summary: groupCommands.map((command) => command.expectedEffect).join(' '),
            commandIds: groupCommands.map((command) => command.commandId),
            affectedTrackIds: affectedTrackIds(groupCommands, input.projectDocument),
            affectedTimeRanges: groupCommands.flatMap((command) => {
                const range = commandTimeRange(command);
                return range ? [range] : [];
            }),
            estimatedAudioImpact: { level: groupImpact, summary: impactSummary(groupImpact) },
            warnings: groupDestructiveChanges.map((change) => `${change.classification}: ${change.consequence}`),
            destructiveChanges: groupDestructiveChanges,
        };
    });

    return {
        schemaVersion: SEMANTIC_PROJECT_DIFF_SCHEMA_VERSION,
        baseRevision: input.envelope.baseRevision,
        batchId: input.envelope.batchId,
        summary: input.envelope.intent,
        intentGroups: groups,
        affectedTrackIds: affectedTrackIds(commands, input.projectDocument),
        affectedTimeRanges: ranges,
        estimatedAudioImpact: { level: impact, summary: impactSummary(impact) },
        warnings: unique(warningValues),
        destructiveChanges,
        facts: { ...facts, protectedUnchanged },
    };
}
