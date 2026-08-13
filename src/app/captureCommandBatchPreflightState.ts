import { getProjectContext } from '#/modules/AiRuntime/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { DOC_PREFIX_ROOT, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { hasRoutingCycle } from '#/utils/routingCycle';

type CaptureCommandBatchPreflightStateInput = {
    assetReferences: readonly { assetHash?: string; audioBufferId?: string }[];
    targetIds: readonly string[];
};

function collectTargetFingerprints(
    value: unknown,
    targetIds: ReadonlySet<string>,
    fingerprints: Map<string, string[]>,
    visited: WeakSet<object>
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectTargetFingerprints(item, targetIds, fingerprints, visited);
        }
        return;
    }
    if (typeof value !== 'object' || value === null) {
        return;
    }
    if (visited.has(value)) {
        return;
    }
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string' && targetIds.has(record.id)) {
        const matches = fingerprints.get(record.id) ?? [];
        matches.push(JSON.stringify(record));
        fingerprints.set(record.id, matches);
    }
    for (const child of Object.values(record)) {
        collectTargetFingerprints(child, targetIds, fingerprints, visited);
    }
}

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

export function captureCommandBatchPreflightState(input: CaptureCommandBatchPreflightStateInput) {
    const context = getProjectContext();
    const targetIds = new Set(input.targetIds);
    const fingerprintMatches = new Map<string, string[]>();
    const visited = new WeakSet<object>();
    const projectDoc = getCrdtDoc(DOC_PREFIX_ROOT);
    collectTargetFingerprints(projectDoc, targetIds, fingerprintMatches, visited);
    const allIds = new Set<string>();
    const duplicateIds = new Set<string>();
    const duplicateScanVisited = new WeakSet<object>();
    findDuplicateIds(projectDoc, allIds, duplicateIds, duplicateScanVisited);
    const targetFingerprints = Object.fromEntries(
        [...fingerprintMatches].map(([targetId, matches]) => [targetId, JSON.stringify(matches.sort())])
    );
    if (targetIds.has('hw_out')) {
        targetFingerprints.hw_out = 'system-output:hw_out';
    }
    const tracks = context.tracks.map((track) => ({
        id: track.id,
        outputId: track.outputId,
        sends: track.sends,
    }));
    const sidechainRoutes = (context.sidechainRoutes ?? []).map((route) => ({
        sourceTrackId: route.sourceTrackId,
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

    return {
        audioGraphValid: !hasRoutingCycle({ tracks, sidechainRoutes }),
        availableAssetHashes: assetHashes.filter(
            (assetHash) => currentClipAssetHashes.has(assetHash) || assetTransfer?.hasAsset(assetHash) === true
        ),
        availableAudioBufferIds: audioBufferIds.filter((audioBufferId) => audioBufferCache.has(audioBufferId)),
        lockedRanges: (context.productionBrief?.locks ?? []).flatMap((lock) =>
            lock.scope.kind === 'range' ? [{ startBeat: lock.scope.startBeat, endBeat: lock.scope.endBeat }] : []
        ),
        projectInvariantsValid: duplicateIds.size === 0 && projectInvariantsAreValid(context),
        targetFingerprints,
    };
}
