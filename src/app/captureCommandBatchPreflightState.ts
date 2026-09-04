import { getProjectContext } from '#/modules/AiRuntime/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { compileAudioGraphTopology } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { captureCommandTargetFingerprints } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { captureProjectIdentity, DOC_PREFIX_ROOT, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

type CaptureCommandBatchPreflightStateInput = {
    assetReferences: readonly { assetHash?: string; audioBufferId?: string }[];
    projectDocument?: Readonly<Record<string, unknown>>;
    targetIds: readonly string[];
};

type CaptureAgentProjectInspectionStateInput = {
    projectDocument: Readonly<Record<string, unknown>>;
    targetIds: readonly string[];
};

function hasUniqueNonEmptyIds(values: readonly { id: string }[]): boolean {
    return (
        values.every((value) => value.id.length > 0) && new Set(values.map((value) => value.id)).size === values.length
    );
}

function projectInvariantsAreValid(context: ReturnType<typeof getProjectContext>): boolean {
    const tracks = context.tracks;
    if (!hasUniqueNonEmptyIds(tracks)) {
        return false;
    }
    const trackIds = new Set(tracks.map((track) => track.id));
    const clips = tracks.flatMap((track) => track.clips);
    const devices = tracks.flatMap((track) => track.devices);
    if (!hasUniqueNonEmptyIds(clips) || !hasUniqueNonEmptyIds(devices)) {
        return false;
    }
    const clipIds = new Set(clips.map((clip) => clip.id));
    const deviceOwners = new Map<string, string>();
    for (const track of tracks) {
        if (!Number.isFinite(track.gain) || !Number.isFinite(track.pan)) {
            return false;
        }
        for (const device of track.devices) {
            deviceOwners.set(device.id, track.id);
        }
        if (
            track.outputId &&
            track.outputId !== 'master' &&
            track.outputId !== 'hw_out' &&
            !trackIds.has(track.outputId)
        ) {
            return false;
        }
        if (track.sends?.some((send) => !trackIds.has(send.busId))) {
            return false;
        }
    }
    if (
        clips.some(
            (clip) =>
                !Number.isFinite(clip.startBeat) ||
                !Number.isFinite(clip.endBeat) ||
                clip.startBeat < 0 ||
                clip.endBeat < clip.startBeat
        )
    ) {
        return false;
    }
    if (
        context.sidechainRoutes?.some(
            (route) =>
                !trackIds.has(route.sourceTrackId) ||
                !trackIds.has(route.targetTrackId) ||
                deviceOwners.get(route.targetDeviceId) !== route.targetTrackId
        )
    ) {
        return false;
    }
    if (
        context.automationLanes?.some(
            (lane) => !trackIds.has(lane.trackId) || (lane.clipId !== undefined && !clipIds.has(lane.clipId))
        )
    ) {
        return false;
    }
    if (
        context.sections?.some(
            (section) =>
                !Number.isFinite(section.startBeat) ||
                !Number.isFinite(section.endBeat) ||
                section.startBeat < 0 ||
                section.endBeat <= section.startBeat
        )
    ) {
        return false;
    }
    return context.vcaGroups?.every((group) => group.trackIds.every((trackId) => trackIds.has(trackId))) ?? true;
}

function recordId(id: unknown, ids: Set<string>, duplicates: Set<string>): void {
    if (typeof id !== 'string' || id.length === 0) {
        return;
    }
    if (ids.has(id)) {
        duplicates.add(id);
    }
    ids.add(id);
}

function findDuplicateIds(value: unknown, ids: Set<string>, duplicates: Set<string>, visited: WeakSet<object>): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            findDuplicateIds(item, ids, duplicates, visited);
        }
        return;
    }
    if (typeof value !== 'object' || value === null || visited.has(value)) {
        return;
    }
    visited.add(value);
    const record = value as Record<string, unknown>;
    recordId(record.id, ids, duplicates);
    for (const child of Object.values(record)) {
        findDuplicateIds(child, ids, duplicates, visited);
    }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Readonly<Record<string, unknown>>;
}

/**
 * The live projection's own fingerprint for every target the document backs,
 * reported beside the document fingerprint rather than folded into it. Approval
 * binding compares two live captures and wants both; `targets-unchanged`
 * compares a staged document against a live one, so a projection half there
 * would let a remote patch that never reached the staged document count as this
 * batch's own effect. Projection-only targets still establish no authority.
 */
function selectAdvertisedFingerprints(input: {
    advertised: Readonly<Record<string, string>>;
    document: Readonly<Record<string, string>>;
    targetIds: readonly string[];
}): Record<string, string> {
    return Object.fromEntries(
        input.targetIds.flatMap((targetId) => {
            const advertised = input.advertised[targetId];
            return advertised === undefined || input.document[targetId] === undefined ? [] : [[targetId, advertised]];
        })
    );
}

function addSystemTargetFingerprints(
    targetFingerprints: Record<string, string>,
    targetIds: readonly string[]
): Record<string, string> {
    const fingerprints = { ...targetFingerprints };
    const targets = new Set(targetIds);
    if (targets.has('master') && fingerprints.master === undefined) {
        fingerprints.master = 'system-output:master';
    }
    if (targets.has('hw_out')) {
        fingerprints.hw_out = 'system-output:hw_out';
    }
    return fingerprints;
}

function isValidOptionalField(
    record: Readonly<Record<string, unknown>>,
    key: string,
    validate: (value: unknown) => boolean
): boolean {
    return !Object.hasOwn(record, key) || validate(record[key]);
}

function isValidRawTransportSlot(value: unknown): boolean {
    const transport = asRecord(value);
    if (!transport) {
        return false;
    }
    const finite = (candidate: unknown) => typeof candidate === 'number' && Number.isFinite(candidate);
    const nonNegative = (candidate: unknown) => finite(candidate) && (candidate as number) >= 0;
    const boolean = (candidate: unknown) => typeof candidate === 'boolean';
    if (
        !isValidOptionalField(
            transport,
            'tempo',
            (candidate) => finite(candidate) && (candidate as number) >= 20 && (candidate as number) <= 300
        ) ||
        !isValidOptionalField(
            transport,
            'timeSignatureNumerator',
            (candidate) =>
                finite(candidate) &&
                Number.isInteger(candidate) &&
                (candidate as number) >= 1 &&
                (candidate as number) <= 32
        ) ||
        !isValidOptionalField(
            transport,
            'timeSignatureDenominator',
            (candidate) => candidate === 2 || candidate === 4 || candidate === 8 || candidate === 16
        ) ||
        !['isLooping', 'metronomeEnabled', 'punchInEnabled', 'countInEnabled', 'preRollEnabled'].every((key) =>
            isValidOptionalField(transport, key, boolean)
        ) ||
        !['loopStart', 'loopEnd', 'punchInBeat', 'punchOutBeat', 'masterGain'].every((key) =>
            isValidOptionalField(transport, key, nonNegative)
        ) ||
        !isValidOptionalField(
            transport,
            'metronomeVolume',
            (candidate) => finite(candidate) && (candidate as number) >= 0 && (candidate as number) <= 1
        ) ||
        !['countInBars', 'preRollBars'].every((key) =>
            isValidOptionalField(
                transport,
                key,
                (candidate) =>
                    finite(candidate) &&
                    Number.isInteger(candidate) &&
                    (candidate as number) >= 1 &&
                    (candidate as number) <= 8
            )
        )
    ) {
        return false;
    }
    const loopStart = typeof transport.loopStart === 'number' ? transport.loopStart : 0;
    const loopEnd = typeof transport.loopEnd === 'number' ? transport.loopEnd : 0;
    if (loopEnd < loopStart || (transport.isLooping === true && loopEnd <= loopStart)) {
        return false;
    }
    const punchInBeat = typeof transport.punchInBeat === 'number' ? transport.punchInBeat : 0;
    const punchOutBeat = typeof transport.punchOutBeat === 'number' ? transport.punchOutBeat : 16;
    return punchOutBeat > punchInBeat;
}

function getSlotRows(
    document: Readonly<Record<string, unknown>>,
    slotName: string,
    fieldName: string
): readonly unknown[] | null {
    const slotValue = document[slotName];
    if (slotValue === undefined) {
        return [];
    }
    const slot = asRecord(slotValue);
    return slot && Array.isArray(slot[fieldName]) ? slot[fieldName] : null;
}

function inspectStagedProjectDocument(document: Readonly<Record<string, unknown>>): {
    audioGraphValid: boolean;
    projectInvariantsValid: boolean;
} {
    const rawTracks = getSlotRows(document, 'tracks', 'tracks');
    const rawSidechainRoutes = getSlotRows(document, 'sidechainRoutes', 'routes');
    const rawAutomationLanes = getSlotRows(document, 'automation', 'lanes');
    const rawSections = getSlotRows(document, 'markers', 'sections');
    const rawVcaGroups = getSlotRows(document, 'vcaGroups', 'groups');
    if (!rawTracks || !rawSidechainRoutes || !rawAutomationLanes || !rawSections || !rawVcaGroups) {
        return { audioGraphValid: false, projectInvariantsValid: false };
    }

    const trackIds = new Set<string>();
    const clipIds = new Set<string>();
    const deviceOwners = new Map<string, string>();
    const tracks: Array<{
        devices: Array<{ id: string; type: string }>;
        id: string;
        kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder' | 'vca';
        outputId?: string;
        sends: Array<{ busId: string; level: number }>;
    }> = [];
    let projectInvariantsValid = true;
    if (document.transport !== undefined && !isValidRawTransportSlot(document.transport)) {
        projectInvariantsValid = false;
    }
    for (const rawTrack of rawTracks) {
        const track = asRecord(rawTrack);
        if (
            !track ||
            typeof track.id !== 'string' ||
            track.id.length === 0 ||
            trackIds.has(track.id) ||
            (track.kind !== 'audio' &&
                track.kind !== 'midi' &&
                track.kind !== 'bus' &&
                track.kind !== 'master' &&
                track.kind !== 'folder' &&
                track.kind !== 'vca')
        ) {
            projectInvariantsValid = false;
            continue;
        }
        trackIds.add(track.id);
        if (!Number.isFinite(track.gain) || !Number.isFinite(track.pan)) {
            projectInvariantsValid = false;
        }
        const rawClips = Array.isArray(track.clips) ? track.clips : null;
        const rawDevices = Array.isArray(track.devices) ? track.devices : null;
        let rawSends: readonly unknown[] | null = [];
        if (track.sends !== undefined) {
            rawSends = Array.isArray(track.sends) ? track.sends : null;
        }
        if (!rawClips || !rawDevices || !rawSends) {
            projectInvariantsValid = false;
            continue;
        }
        for (const rawClip of rawClips) {
            const clip = asRecord(rawClip);
            if (
                !clip ||
                typeof clip.id !== 'string' ||
                clip.id.length === 0 ||
                clipIds.has(clip.id) ||
                !Number.isFinite(clip.startBeat) ||
                !Number.isFinite(clip.endBeat) ||
                (clip.startBeat as number) < 0 ||
                (clip.endBeat as number) < (clip.startBeat as number)
            ) {
                projectInvariantsValid = false;
                continue;
            }
            clipIds.add(clip.id);
        }
        const devices: Array<{ id: string; type: string }> = [];
        for (const rawDevice of rawDevices) {
            const device = asRecord(rawDevice);
            if (
                !device ||
                typeof device.id !== 'string' ||
                device.id.length === 0 ||
                typeof device.type !== 'string' ||
                deviceOwners.has(device.id)
            ) {
                projectInvariantsValid = false;
                continue;
            }
            deviceOwners.set(device.id, track.id);
            devices.push({ id: device.id, type: device.type });
        }
        const sends: Array<{ busId: string; level: number }> = [];
        for (const rawSend of rawSends) {
            const send = asRecord(rawSend);
            if (!send || typeof send.busId !== 'string' || send.busId.length === 0 || !Number.isFinite(send.level)) {
                projectInvariantsValid = false;
                continue;
            }
            sends.push({ busId: send.busId, level: send.level as number });
        }
        tracks.push({
            devices,
            id: track.id,
            kind: track.kind,
            ...(typeof track.outputId === 'string' ? { outputId: track.outputId } : {}),
            sends,
        });
    }

    const sidechainRoutes: Array<{ sourceTrackId: string; targetDeviceId: string; targetTrackId: string }> = [];
    for (const rawRoute of rawSidechainRoutes) {
        const route = asRecord(rawRoute);
        if (
            !route ||
            typeof route.sourceTrackId !== 'string' ||
            typeof route.targetTrackId !== 'string' ||
            typeof route.targetDeviceId !== 'string' ||
            !trackIds.has(route.sourceTrackId) ||
            !trackIds.has(route.targetTrackId) ||
            deviceOwners.get(route.targetDeviceId) !== route.targetTrackId
        ) {
            projectInvariantsValid = false;
            continue;
        }
        sidechainRoutes.push({
            sourceTrackId: route.sourceTrackId,
            targetDeviceId: route.targetDeviceId,
            targetTrackId: route.targetTrackId,
        });
    }
    for (const track of tracks) {
        if (
            (track.outputId &&
                track.outputId !== 'master' &&
                track.outputId !== 'hw_out' &&
                !trackIds.has(track.outputId)) ||
            track.sends.some((send) => !trackIds.has(send.busId))
        ) {
            projectInvariantsValid = false;
        }
    }
    for (const rawLane of rawAutomationLanes) {
        const lane = asRecord(rawLane);
        if (
            !lane ||
            typeof lane.trackId !== 'string' ||
            !trackIds.has(lane.trackId) ||
            (lane.clipId !== undefined && (typeof lane.clipId !== 'string' || !clipIds.has(lane.clipId)))
        ) {
            projectInvariantsValid = false;
        }
    }
    for (const rawSection of rawSections) {
        const section = asRecord(rawSection);
        if (
            !section ||
            !Number.isFinite(section.startBeat) ||
            !Number.isFinite(section.endBeat) ||
            (section.startBeat as number) < 0 ||
            (section.endBeat as number) <= (section.startBeat as number)
        ) {
            projectInvariantsValid = false;
        }
    }
    for (const rawGroup of rawVcaGroups) {
        const group = asRecord(rawGroup);
        if (
            !group ||
            !Array.isArray(group.trackIds) ||
            group.trackIds.some((trackId) => typeof trackId !== 'string' || !trackIds.has(trackId))
        ) {
            projectInvariantsValid = false;
        }
    }

    const audioGraph = projectInvariantsValid ? compileAudioGraphTopology({ tracks, sidechainRoutes }) : null;
    return {
        audioGraphValid: audioGraph?.status === 'compiled',
        projectInvariantsValid,
    };
}

/**
 * Duplicate ids across the project, counting each arrangement as its own id
 * namespace.
 *
 * An arrangement snapshot holds a copy of the track state it arranges, so it
 * repeats the live `tracks` slot's track, clip, alternative and device ids by
 * design — that shared identity is what makes it an arrangement *of* those
 * tracks rather than an unrelated set. Scanning the whole document into one
 * namespace reports every one of those as a duplicate, so any project carrying
 * an arrangement fails `projectInvariantsValid` permanently, and
 * `inspectCurrentAgentProjectRepairState` then holds the project in
 * repair-required: every mutation is refused and every save fails.
 *
 * A collision within the live project, or within one snapshot, is still a real
 * defect and is still reported. So is a repeated arrangement `id`: it is the
 * one field `duplicateArrangement` remints, so two snapshots may share every
 * track, clip, alternative and device id but never their own. Two snapshots
 * under one id are indistinguishable to `syncCurrentArrangementToStore`, which
 * overwrites every match with the active snapshot and destroys the other
 * arrangement, so those ids are scanned in one namespace shared across
 * snapshots while each snapshot's contents keep their own.
 */
function findProjectDuplicateIds(document: Readonly<Record<string, unknown>>): Set<string> {
    const duplicateIds = new Set<string>();
    const { arrangements, ...liveDocument } = document;
    findDuplicateIds(liveDocument, new Set<string>(), duplicateIds, new WeakSet<object>());
    const snapshots = asRecord(arrangements)?.arrangements;
    const arrangementIds = new Set<string>();
    for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
        recordId(asRecord(snapshot)?.id, arrangementIds, duplicateIds);
        findDuplicateIds(snapshot, new Set<string>(), duplicateIds, new WeakSet<object>());
    }
    return duplicateIds;
}

function captureProjectDocumentInspectionState(input: CaptureAgentProjectInspectionStateInput) {
    const duplicateIds = findProjectDuplicateIds(input.projectDocument);
    const inspection = inspectStagedProjectDocument(input.projectDocument);
    return {
        audioGraphValid: inspection.audioGraphValid,
        projectInvariantsValid: duplicateIds.size === 0 && inspection.projectInvariantsValid,
        targetFingerprints: captureCommandTargetFingerprints({
            document: input.projectDocument,
            targetIds: input.targetIds,
        }),
    };
}

export function captureCommandBatchPreflightState(input: CaptureCommandBatchPreflightStateInput) {
    const context = agentProjectRepairStateStore.value ? null : getProjectContext();
    const projectDoc = input.projectDocument ?? getCrdtDoc(DOC_PREFIX_ROOT);
    if (!projectDoc) {
        // No document means no document-backed authority: fail closed so the batch
        // is rejected instead of approved against an absent project.
        return {
            advertisedTargetFingerprints: {},
            audioGraphValid: false,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: captureProjectIdentity(),
            projectInvariantsValid: false,
            targetFingerprints: addSystemTargetFingerprints({}, input.targetIds),
        };
    }
    const documentInspection = captureProjectDocumentInspectionState({
        projectDocument: projectDoc,
        targetIds: input.targetIds,
    });
    const advertisedTargetFingerprints = selectAdvertisedFingerprints({
        advertised: context
            ? captureCommandTargetFingerprints({ document: { projectContext: context }, targetIds: input.targetIds })
            : {},
        document: documentInspection.targetFingerprints,
        targetIds: input.targetIds,
    });
    const targetFingerprints = addSystemTargetFingerprints(documentInspection.targetFingerprints, input.targetIds);
    const tracks = (context?.tracks ?? []).map((track) => ({
        devices: track.devices.map((device) => ({ id: device.id, type: device.type })),
        id: track.id,
        kind: track.kind,
        outputId: track.outputId,
        sends: (track.sends ?? []).map((send) => ({ busId: send.busId, level: send.level })),
    }));
    const sidechainRoutes = (context?.sidechainRoutes ?? []).map((route) => ({
        sourceTrackId: route.sourceTrackId,
        targetDeviceId: route.targetDeviceId,
        targetTrackId: route.targetTrackId,
    }));
    const currentClipAssetHashes = new Set(
        (trackStore.value?.tracks ?? [])
            .flatMap((track) => track.clips)
            .filter((clip) => clip.audioBufferId && audioBufferCache.has(clip.audioBufferId))
            .flatMap((clip) => (clip.assetHash ? [clip.assetHash] : []))
    );
    const assetTransfer = getAssetTransfer();
    const assetHashes = [
        ...new Set(input.assetReferences.flatMap((reference) => (reference.assetHash ? [reference.assetHash] : []))),
    ];
    const audioBufferIds = [
        ...new Set(
            input.assetReferences.flatMap((reference) => (reference.audioBufferId ? [reference.audioBufferId] : []))
        ),
    ];
    let authoritativeProjectInvariantsValid = true;
    if (!input.projectDocument) {
        authoritativeProjectInvariantsValid = context ? projectInvariantsAreValid(context) : false;
    }

    return {
        advertisedTargetFingerprints,
        audioGraphValid:
            (input.projectDocument ? documentInspection.audioGraphValid : undefined) ??
            compileAudioGraphTopology({ tracks, sidechainRoutes }).status === 'compiled',
        availableAssetHashes: assetHashes.filter(
            (assetHash) => currentClipAssetHashes.has(assetHash) || assetTransfer?.hasAsset(assetHash) === true
        ),
        availableAudioBufferIds: audioBufferIds.filter((audioBufferId) => audioBufferCache.has(audioBufferId)),
        lockedRanges: (context?.productionBrief?.locks ?? []).flatMap((lock) =>
            lock.scope.kind === 'range' ? [{ startBeat: lock.scope.startBeat, endBeat: lock.scope.endBeat }] : []
        ),
        projectId: captureProjectIdentity(),
        projectInvariantsValid: documentInspection.projectInvariantsValid && authoritativeProjectInvariantsValid,
        targetFingerprints,
    };
}

export function captureAgentProjectInspectionState(input: CaptureAgentProjectInspectionStateInput) {
    const inspection = captureProjectDocumentInspectionState(input);
    return {
        audioGraphValid: inspection.audioGraphValid,
        projectInvariantsValid: inspection.projectInvariantsValid,
        targetFingerprints: addSystemTargetFingerprints(inspection.targetFingerprints, input.targetIds),
    };
}
