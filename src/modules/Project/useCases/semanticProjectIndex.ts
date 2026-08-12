import { clipSelectionStore, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { getPluginById } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { sidechainStore } from '#/modules/Routing/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';

import {
    type SemanticIndexDiagnostics,
    type SemanticIndexEntity,
    type SemanticProjectIndexSnapshot,
    type SemanticProjectRevision,
} from '../models/SemanticProjectQuery';
import { projectStore } from '../stores/projectStore';

import { semanticRangeOverlaps } from './semanticRangeOverlap';

type PartitionName = keyof SemanticIndexDiagnostics;

type PartitionCache = {
    sources: readonly unknown[];
    entities: SemanticIndexEntity[];
};

const partitionCache: Record<PartitionName, PartitionCache> = {
    tracks: { sources: [], entities: [] },
    sections: { sources: [], entities: [] },
    routing: { sources: [], entities: [] },
    automation: { sources: [], entities: [] },
    tempo: { sources: [], entities: [] },
    history: { sources: [], entities: [] },
    brief: { sources: [], entities: [] },
    selection: { sources: [], entities: [] },
};

const diagnostics: SemanticIndexDiagnostics = {
    tracks: 0,
    sections: 0,
    routing: 0,
    automation: 0,
    tempo: 0,
    history: 0,
    brief: 0,
    selection: 0,
};

function emptyEntity(input: Pick<SemanticIndexEntity, 'id' | 'kind'>): SemanticIndexEntity {
    return {
        ...input,
        signature: '',
        tags: [],
        roles: [],
        selected: false,
        locked: false,
        deviceTypes: [],
        deviceCategories: [],
        routeFromIds: [],
        routeToIds: [],
        hasAutomation: false,
    };
}

function signEntity(entity: SemanticIndexEntity): SemanticIndexEntity {
    const { signature: _signature, ...value } = entity;
    return { ...entity, signature: JSON.stringify(value) };
}

function refreshPartition(
    name: PartitionName,
    sources: readonly unknown[],
    build: () => SemanticIndexEntity[]
): SemanticIndexEntity[] {
    const cached = partitionCache[name];
    if (
        cached.sources.length === sources.length &&
        sources.every((source, index) => Object.is(source, cached.sources[index]))
    ) {
        return cached.entities;
    }
    cached.sources = sources;
    cached.entities = build().map((entity) => signEntity(entity));
    diagnostics[name] += 1;
    return cached.entities;
}

function getString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function getNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getClipAssetType(clip: { type: 'audio' | 'midi'; assetHash?: string }): string {
    if (clip.type === 'midi') {
        return 'midi';
    }
    return clip.assetHash ? 'managed-audio' : 'audio';
}

function createBoundedRevisionToken(projectRevision: string, semanticSignature: string): string {
    let fnv = 2_166_136_261;
    let djb = 5_381;
    for (const character of `${projectRevision}\u0000${semanticSignature}`) {
        const codePoint = character.codePointAt(0) ?? 0;
        fnv = Math.imul(fnv ^ codePoint, 16_777_619);
        djb = Math.imul(djb, 33) ^ codePoint;
    }
    return `spq1.${(fnv >>> 0).toString(36)}.${(djb >>> 0).toString(36)}`;
}

function parseRevision(value: string): SemanticProjectRevision {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid Automerge project revision');
    }
    if (!('documentIdentityEpoch' in parsed) || !('mutationEpoch' in parsed) || !('documents' in parsed)) {
        throw new Error('Incomplete Automerge project revision');
    }
    const documentIdentityEpoch = getNumber(parsed.documentIdentityEpoch);
    const mutationEpoch = getNumber(parsed.mutationEpoch);
    if (documentIdentityEpoch === null || mutationEpoch === null || !Array.isArray(parsed.documents)) {
        throw new Error('Invalid Automerge project revision fields');
    }
    const documentValues: unknown[] = parsed.documents;
    const documents = documentValues.map((document) => {
        if (!document || typeof document !== 'object' || !('docId' in document) || !('heads' in document)) {
            throw new Error('Invalid Automerge document revision');
        }
        const record: Record<string, unknown> = document;
        const docId = getString(record.docId);
        const heads = record.heads;
        if (docId === null || !Array.isArray(heads) || !heads.every((head: unknown) => typeof head === 'string')) {
            throw new Error('Invalid Automerge document heads');
        }
        return { docId, heads: heads.filter((head): head is string => typeof head === 'string') };
    });
    return { documentIdentityEpoch, mutationEpoch, documents };
}

function buildTrackEntities(): SemanticIndexEntity[] {
    return (trackStore.value?.tracks ?? []).flatMap((track) => {
        const deviceTypes = track.devices.map((device) => device.type);
        const deviceCategories = [
            ...new Set(track.devices.map((device) => getPluginById(device.type)?.category ?? 'external')),
        ];
        const trackEntity: SemanticIndexEntity = {
            ...emptyEntity({ id: track.id, kind: 'track' }),
            name: track.name,
            tags: [track.kind, ...deviceTypes],
            ...(track.parentId ? { parentId: track.parentId } : {}),
            trackKind: track.kind,
            muted: track.muted,
            soloed: track.soloed,
            frozen: track.frozen,
            gain: track.gain,
            pan: track.pan,
            outputId: track.outputId,
            deviceTypes,
            deviceCategories,
            sendBusIds: track.sends.map((send) => send.busId),
            routeToIds: [track.outputId, ...track.sends.map((send) => send.busId)].filter(
                (target): target is string => typeof target === 'string'
            ),
        };
        const clips = [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)].map(
            (clip): SemanticIndexEntity => ({
                ...emptyEntity({ id: clip.id, kind: 'clip' }),
                name: clip.name,
                tags: [clip.type, clip.assetHash ? 'managed-asset' : 'project-content'],
                parentId: track.id,
                trackId: track.id,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
                locked: clip.locked,
                muted: clip.muted,
                contentType: clip.type,
                assetType: getClipAssetType(clip),
                audioBufferId: clip.audioBufferId,
                assetHash: clip.assetHash,
            })
        );
        const devices = track.devices.map((device): SemanticIndexEntity => ({
            ...emptyEntity({ id: device.id, kind: 'device' }),
            name: device.name,
            parentId: track.id,
            trackId: track.id,
            deviceType: device.type,
            tags: [device.type, getPluginById(device.type)?.category ?? 'external'],
            deviceTypes: [device.type],
            deviceCategories: [getPluginById(device.type)?.category ?? 'external'],
            bypassed: device.bypassed,
            parameters: { ...device.parameterValues },
        }));
        return [trackEntity, ...clips, ...devices];
    });
}

function buildSectionEntities(): SemanticIndexEntity[] {
    const sections = (markerStore.value?.sections ?? []).map((section): SemanticIndexEntity => ({
        ...emptyEntity({ id: section.id, kind: 'section' }),
        name: section.name,
        startBeat: section.startBeat,
        endBeat: section.endBeat,
    }));
    const markers = (markerStore.value?.markers ?? []).map((marker): SemanticIndexEntity => ({
        ...emptyEntity({ id: marker.id, kind: 'marker' }),
        name: marker.name,
        startBeat: marker.beat,
        endBeat: marker.beat,
        beat: marker.beat,
    }));
    return [...sections, ...markers];
}

function buildAutomationEntities(): SemanticIndexEntity[] {
    return (automationStore.value?.lanes ?? []).map((lane): SemanticIndexEntity => {
        const startBeats = [
            ...lane.points.map((point) => point.beat),
            ...lane.objects.map((object) => object.startBeat),
        ];
        const endBeats = [...lane.points.map((point) => point.beat), ...lane.objects.map((object) => object.endBeat)];
        return {
            ...emptyEntity({ id: lane.id, kind: 'automation-lane' }),
            name: lane.parameterName,
            parentId: lane.trackId,
            trackId: lane.trackId,
            clipId: lane.clipId,
            enabled: lane.enabled,
            parameterId: lane.parameterId,
            pointCount: lane.points.length,
            ...(startBeats.length > 0 ? { startBeat: Math.min(...startBeats), endBeat: Math.max(...endBeats) } : {}),
            hasAutomation: true,
        };
    });
}

function buildRoutingEntities(): SemanticIndexEntity[] {
    const trackRoutes = (trackStore.value?.tracks ?? []).flatMap((track) => {
        const output = track.outputId
            ? [
                  {
                      ...emptyEntity({ id: `${track.id}:output`, kind: 'output-route' }),
                      sourceId: track.id,
                      targetId: track.outputId,
                      routeFromIds: [track.id],
                      routeToIds: [track.outputId],
                  } satisfies SemanticIndexEntity,
              ]
            : [];
        const sends = track.sends.map((send): SemanticIndexEntity => ({
            ...emptyEntity({ id: `${track.id}:send:${send.busId}`, kind: 'send' }),
            sourceId: track.id,
            targetId: send.busId,
            level: send.level,
            preFader: send.preFader,
            routeFromIds: [track.id],
            routeToIds: [send.busId],
        }));
        return [...output, ...sends];
    });
    const sidechains = (sidechainStore.value?.routes ?? []).map((route): SemanticIndexEntity => ({
        ...emptyEntity({ id: route.id, kind: 'sidechain-route' }),
        sourceId: route.sourceTrackId,
        targetId: route.targetTrackId,
        targetDeviceId: route.targetDeviceId,
        targetParameterId: route.targetParameterId,
        gain: route.gain,
        routeFromIds: [route.sourceTrackId],
        routeToIds: [route.targetTrackId, route.targetDeviceId],
    }));
    return [...trackRoutes, ...sidechains];
}

function buildTempoEntities(): SemanticIndexEntity[] {
    const transport = transportStore.value;
    const base: SemanticIndexEntity = {
        ...emptyEntity({ id: 'tempo-base', kind: 'tempo' }),
        name: 'Project tempo',
        startBeat: 0,
        endBeat: 0,
        tempo: transport?.tempo ?? 120,
        meter: [transport?.timeSignatureNumerator ?? 4, transport?.timeSignatureDenominator ?? 4],
    };
    const tempos = (tempoMapStore.value?.changes ?? []).map((change): SemanticIndexEntity => ({
        ...emptyEntity({ id: change.id, kind: 'tempo-change' }),
        name: `Tempo at beat ${String(change.beat)}`,
        startBeat: change.beat,
        endBeat: change.beat,
        beat: change.beat,
        tempo: change.tempo,
        curve: change.curve,
    }));
    const meters = (timeSignatureMapStore.value?.changes ?? []).map((change): SemanticIndexEntity => ({
        ...emptyEntity({ id: change.id, kind: 'meter-change' }),
        name: `Meter at beat ${String(change.beat)}`,
        startBeat: change.beat,
        endBeat: change.beat,
        beat: change.beat,
        meter: [change.numerator, change.denominator],
    }));
    return [base, ...tempos, ...meters];
}

function buildHistoryEntities(): SemanticIndexEntity[] {
    return (actionHistoryStore.value?.entries ?? []).map((entry): SemanticIndexEntity => ({
        ...emptyEntity({ id: entry.id, kind: 'history-entry' }),
        name: entry.label,
        actionKind: entry.actionKind,
        source: entry.source,
        timestamp: entry.timestamp,
        reverted: entry.reverted,
        groupId: entry.groupId,
        groupLabel: entry.groupLabel,
    }));
}

function buildBriefEntities(): SemanticIndexEntity[] {
    const project = projectStore.value;
    if (!project) {
        return [];
    }
    const brief = project.productionBrief;
    return [
        {
            ...emptyEntity({ id: String(project.createdAt), kind: 'project-metadata' }),
            name: project.name,
            createdAt: project.createdAt,
            keyRoot: project.keyRoot,
            scaleName: project.scaleName,
        },
        {
            ...emptyEntity({ id: brief.id, kind: 'production-brief' }),
            name: 'Production brief',
            brief: structuredClone(brief),
        },
        ...brief.trackRoles.map((role): SemanticIndexEntity => ({
            ...emptyEntity({ id: role.id, kind: 'track-role' }),
            name: role.role,
            parentId: role.trackId,
            trackId: role.trackId,
            role: role.role,
            roles: [role.role],
        })),
        ...brief.locks.map((lock): SemanticIndexEntity => ({
            ...emptyEntity({ id: lock.id, kind: 'production-lock' }),
            name: lock.statement,
            scope: structuredClone(lock.scope),
            locked: true,
        })),
        ...brief.decisions.map((decision): SemanticIndexEntity => ({
            ...emptyEntity({ id: decision.id, kind: 'production-decision' }),
            name: decision.statement,
            scope: structuredClone(decision.scope),
            status: decision.status,
            locked: decision.status === 'locked',
            sourceRunId: decision.sourceRunId,
            relatedBatchId: decision.relatedBatchId,
        })),
    ];
}

function buildSelectionEntities(): SemanticIndexEntity[] {
    const selection = clipSelectionStore.value;
    const selectedClipIds = [
        ...new Set([
            ...(selection?.selectedClipIds ?? []),
            ...(selection?.selectedClipId ? [selection.selectedClipId] : []),
        ]),
    ];
    return [
        {
            ...emptyEntity({ id: 'project-selection', kind: 'selection' }),
            selectedTrackId: trackStore.value?.selectedTrackId ?? null,
            selectedClipIds,
        },
    ];
}

function isScopeForEntity(scope: unknown, entity: SemanticIndexEntity): boolean {
    if (!scope || typeof scope !== 'object' || !('kind' in scope)) {
        return false;
    }
    if (scope.kind === 'project') {
        return true;
    }
    if (scope.kind === 'track' && 'trackId' in scope && typeof scope.trackId === 'string') {
        return entity.id === scope.trackId || entity.parentId === scope.trackId;
    }
    if (scope.kind === 'section' && 'sectionId' in scope && typeof scope.sectionId === 'string') {
        if (entity.id === scope.sectionId) {
            return true;
        }
        const section = markerStore.value?.sections.find((candidate) => candidate.id === scope.sectionId);
        return Boolean(
            section &&
            entity.startBeat !== undefined &&
            entity.endBeat !== undefined &&
            semanticRangeOverlaps(entity.startBeat, entity.endBeat, section.startBeat, section.endBeat)
        );
    }
    if (
        scope.kind === 'object' &&
        'objectId' in scope &&
        typeof scope.objectId === 'string' &&
        entity.id === scope.objectId
    ) {
        return true;
    }
    if (
        scope.kind === 'range' &&
        'startBeat' in scope &&
        'endBeat' in scope &&
        typeof scope.startBeat === 'number' &&
        typeof scope.endBeat === 'number' &&
        entity.startBeat !== undefined &&
        entity.endBeat !== undefined
    ) {
        return semanticRangeOverlaps(entity.startBeat, entity.endBeat, scope.startBeat, scope.endBeat);
    }
    if (scope.kind === 'decision' && 'decisionId' in scope && typeof scope.decisionId === 'string') {
        return entity.id === scope.decisionId;
    }
    return false;
}

function decorateEntities(
    entities: readonly SemanticIndexEntity[],
    automation: readonly SemanticIndexEntity[],
    routing: readonly SemanticIndexEntity[]
): SemanticIndexEntity[] {
    const selection = clipSelectionStore.value;
    const selectedTrackId = trackStore.value?.selectedTrackId;
    const selectedIds = new Set([
        ...(selectedTrackId ? [selectedTrackId] : []),
        ...(selection?.selectedClipIds ?? []),
        ...(selection?.selectedClipId ? [selection.selectedClipId] : []),
    ]);
    const brief = projectStore.value?.productionBrief;
    const rolesByTrack = new Map<string, string[]>();
    for (const role of brief?.trackRoles ?? []) {
        rolesByTrack.set(role.trackId, [...(rolesByTrack.get(role.trackId) ?? []), role.role]);
    }
    const protectedScopes = [
        ...(brief?.locks.map((lock) => lock.scope) ?? []),
        ...(brief?.decisions.filter((decision) => decision.status === 'locked').map((decision) => decision.scope) ??
            []),
    ];
    const automatedTrackIds = new Set(
        automation.map((lane) => lane.parentId).filter((id): id is string => Boolean(id))
    );
    const routesBySource = new Map<string, string[]>();
    const routesByTarget = new Map<string, string[]>();
    for (const route of routing) {
        for (const sourceId of route.routeFromIds) {
            routesBySource.set(sourceId, [...(routesBySource.get(sourceId) ?? []), ...route.routeToIds]);
        }
        for (const targetId of route.routeToIds) {
            routesByTarget.set(targetId, [...(routesByTarget.get(targetId) ?? []), ...route.routeFromIds]);
        }
    }
    return entities.map((entity) => {
        const trackId = entity.kind === 'track' ? entity.id : entity.parentId;
        const roles = trackId ? (rolesByTrack.get(trackId) ?? []) : entity.roles;
        const decorated: SemanticIndexEntity = {
            ...entity,
            roles,
            tags: [...new Set([...entity.tags, ...roles])],
            selected: selectedIds.has(entity.id),
            locked: entity.locked || protectedScopes.some((scope) => isScopeForEntity(scope, entity)),
            hasAutomation: entity.hasAutomation || Boolean(trackId && automatedTrackIds.has(trackId)),
            routeFromIds: [...new Set([...entity.routeFromIds, ...(routesByTarget.get(entity.id) ?? [])])],
            routeToIds: [...new Set([...entity.routeToIds, ...(routesBySource.get(entity.id) ?? [])])],
        };
        return signEntity(decorated);
    });
}

function readIndexOnce(projectRevisionToken: string): SemanticProjectIndexSnapshot {
    const trackState = trackStore.value;
    const markerState = markerStore.value;
    const automationState = automationStore.value;
    const sidechainState = sidechainStore.value;
    const transportState = transportStore.value;
    const tempoMapState = tempoMapStore.value;
    const meterMapState = timeSignatureMapStore.value;
    const historyState = actionHistoryStore.value;
    const projectState = projectStore.value;
    const selectionState = clipSelectionStore.value;
    const routingTrackProjection = JSON.stringify(
        trackState?.tracks.map((track) => ({ id: track.id, outputId: track.outputId, sends: track.sends })) ?? []
    );

    const rawTracks = refreshPartition('tracks', [trackState?.tracks], buildTrackEntities);
    const sections = refreshPartition('sections', [markerState], buildSectionEntities);
    const automation = refreshPartition('automation', [automationState], buildAutomationEntities);
    const routing = refreshPartition('routing', [routingTrackProjection, sidechainState], buildRoutingEntities);
    const tempo = refreshPartition(
        'tempo',
        [
            transportState?.tempo,
            transportState?.timeSignatureNumerator,
            transportState?.timeSignatureDenominator,
            tempoMapState?.changes,
            meterMapState?.changes,
        ],
        buildTempoEntities
    );
    const history = refreshPartition('history', [historyState], buildHistoryEntities);
    const brief = refreshPartition(
        'brief',
        [
            projectState?.name,
            projectState?.createdAt,
            projectState?.keyRoot,
            projectState?.scaleName,
            projectState?.productionBrief,
        ],
        buildBriefEntities
    );
    const selection = refreshPartition(
        'selection',
        [trackState?.selectedTrackId, selectionState?.selectedClipId, selectionState?.selectedClipIds],
        buildSelectionEntities
    );

    const tracks = decorateEntities(rawTracks, automation, routing);
    const decoratedSections = decorateEntities(sections, automation, routing);
    const decoratedAutomation = decorateEntities(automation, automation, routing);
    const decoratedBrief = decorateEntities(brief, automation, routing);
    const revision = parseRevision(projectRevisionToken);
    const revisionToken = createBoundedRevisionToken(
        projectRevisionToken,
        JSON.stringify([
            tracks.map((entity) => entity.signature),
            decoratedSections.map((entity) => entity.signature),
            decoratedAutomation.map((entity) => entity.signature),
            routing.map((entity) => entity.signature),
            tempo.map((entity) => entity.signature),
            history.map((entity) => entity.signature),
            decoratedBrief.map((entity) => entity.signature),
            selection.map((entity) => entity.signature),
        ])
    );
    return {
        entities: [
            ...tracks,
            ...decoratedSections,
            ...decoratedAutomation,
            ...routing,
            ...tempo,
            ...history,
            ...decoratedBrief,
            ...selection,
        ],
        tracks,
        sections: decoratedSections,
        routing,
        automation: decoratedAutomation,
        tempo,
        history,
        selection,
        revisionToken,
        revision,
    };
}

function readSemanticProjectIndex(): SemanticProjectIndexSnapshot {
    const before = captureProjectRevision();
    const snapshot = readIndexOnce(before);
    const after = captureProjectRevision();
    if (before !== after) {
        throw new Error('Project changed while building semantic query index');
    }
    return snapshot;
}

function getDiagnostics(): SemanticIndexDiagnostics {
    return { ...diagnostics };
}

export const semanticProjectIndex = {
    read: readSemanticProjectIndex,
    getDiagnostics,
};
