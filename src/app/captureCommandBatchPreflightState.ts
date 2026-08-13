import { getProjectContext } from '#/modules/AiRuntime/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { compileAudioGraphTopology } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { captureCommandTargetFingerprints } from '#/modules/Command/useCases';
import { captureProjectRevision, DOC_PREFIX_ROOT, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

type CaptureCommandBatchPreflightStateInput = {
    assetReferences: readonly { assetHash?: string; audioBufferId?: string }[];
    projectDocument?: Readonly<Record<string, unknown>>;
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
    if (typeof record.id === 'string' && record.id.length > 0) {
        if (ids.has(record.id)) {
            duplicates.add(record.id);
        }
        ids.add(record.id);
    }
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

export function captureCommandBatchPreflightState(input: CaptureCommandBatchPreflightStateInput) {
    const context = getProjectContext();
    const targetIds = new Set(input.targetIds);
    const projectDoc = input.projectDocument ?? getCrdtDoc(DOC_PREFIX_ROOT);
    const allIds = new Set<string>();
    const duplicateIds = new Set<string>();
    const duplicateScanVisited = new WeakSet<object>();
    findDuplicateIds(projectDoc, allIds, duplicateIds, duplicateScanVisited);
    const targetFingerprints = {
        ...captureCommandTargetFingerprints({ document: projectDoc, targetIds: input.targetIds }),
    };
    if (targetIds.has('hw_out')) {
        targetFingerprints.hw_out = 'system-output:hw_out';
    }
    const tracks = context.tracks.map((track) => ({
        devices: track.devices.map((device) => ({ id: device.id, type: device.type })),
        id: track.id,
        kind: track.kind,
        outputId: track.outputId,
        sends: (track.sends ?? []).map((send) => ({ busId: send.busId, level: send.level })),
    }));
    const sidechainRoutes = (context.sidechainRoutes ?? []).map((route) => ({
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
    const stagedInspection = input.projectDocument ? inspectStagedProjectDocument(input.projectDocument) : null;

    return {
        audioGraphValid:
            stagedInspection?.audioGraphValid ??
            compileAudioGraphTopology({ tracks, sidechainRoutes }).status === 'compiled',
        availableAssetHashes: assetHashes.filter(
            (assetHash) => currentClipAssetHashes.has(assetHash) || assetTransfer?.hasAsset(assetHash) === true
        ),
        availableAudioBufferIds: audioBufferIds.filter((audioBufferId) => audioBufferCache.has(audioBufferId)),
        lockedRanges: (context.productionBrief?.locks ?? []).flatMap((lock) =>
            lock.scope.kind === 'range' ? [{ startBeat: lock.scope.startBeat, endBeat: lock.scope.endBeat }] : []
        ),
        projectId: captureProjectRevision(),
        projectInvariantsValid:
            duplicateIds.size === 0 && (stagedInspection?.projectInvariantsValid ?? projectInvariantsAreValid(context)),
        targetFingerprints,
    };
}
