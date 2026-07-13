import { isSupportedProjectVersion, type ProjectData } from '../../../models/ProjectData';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArrayRecord(value: unknown): value is UnknownRecord {
    return isRecord(value) && Object.values(value).every(Array.isArray);
}

function isClip(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    return (
        typeof value.id === 'string' &&
        typeof value.trackId === 'string' &&
        typeof value.name === 'string' &&
        (value.type === 'audio' || value.type === 'midi')
    );
}

function isTrack(value: unknown): boolean {
    if (!isRecord(value) || !Array.isArray(value.clips) || !Array.isArray(value.alternatives)) {
        return false;
    }
    if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.kind !== 'string') {
        return false;
    }
    if (!isRecord(value.freezeState)) {
        return false;
    }
    if (!value.clips.every(isClip)) {
        return false;
    }
    if (
        !value.alternatives.every(
            (alternative) =>
                isRecord(alternative) &&
                typeof alternative.id === 'string' &&
                typeof alternative.name === 'string' &&
                Array.isArray(alternative.clips) &&
                alternative.clips.every(isClip)
        )
    ) {
        return false;
    }
    return (
        value.midiFx === undefined ||
        (Array.isArray(value.midiFx) &&
            value.midiFx.every((effect) => isRecord(effect) && typeof effect.type === 'string'))
    );
}

function isTracks(value: unknown): boolean {
    return Array.isArray(value) && value.every(isTrack);
}

function isMidi(value: unknown): boolean {
    return (
        isRecord(value) &&
        isArrayRecord(value.notesByClipId) &&
        isArrayRecord(value.ccByClipId) &&
        isArrayRecord(value.pitchBendByClipId)
    );
}

function isAutomation(value: unknown): boolean {
    return (
        isRecord(value) &&
        Array.isArray(value.lanes) &&
        value.lanes.every(
            (lane) =>
                isRecord(lane) &&
                Array.isArray(lane.points) &&
                (lane.objects === undefined || Array.isArray(lane.objects))
        )
    );
}

function isArrangementSnapshot(value: unknown): boolean {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
        return false;
    }
    if (value.tracks !== undefined && (!isRecord(value.tracks) || !isTracks(value.tracks.tracks))) {
        return false;
    }
    return (
        (value.midi === undefined || isMidi(value.midi)) &&
        (value.automation === undefined || isAutomation(value.automation))
    );
}

function isAdjustmentLayers(value: unknown): boolean {
    return (
        isRecord(value) &&
        Array.isArray(value.layers) &&
        value.layers.every(
            (layer) =>
                isRecord(layer) &&
                Array.isArray(layer.parameters) &&
                Array.isArray(layer.affectedTrackIds) &&
                Array.isArray(layer.regions)
        )
    );
}

function isAudioBuffers(value: unknown): boolean {
    return (
        isRecord(value) &&
        Object.values(value).every(
            (buffer) =>
                isRecord(buffer) &&
                typeof buffer.sampleRate === 'number' &&
                typeof buffer.numberOfChannels === 'number' &&
                Number.isInteger(buffer.numberOfChannels) &&
                Array.isArray(buffer.channelData) &&
                buffer.channelData.length === buffer.numberOfChannels &&
                buffer.channelData.every((channel) => typeof channel === 'string')
        )
    );
}

export function isHydratableProjectData(value: unknown): value is ProjectData {
    if (!isRecord(value) || typeof value.version !== 'number' || !isSupportedProjectVersion(value.version)) {
        return false;
    }
    if (!isRecord(value.meta) || !isRecord(value.arrangement) || !isTracks(value.arrangement.tracks)) {
        return false;
    }
    if (value.midi !== undefined && !isMidi(value.midi)) {
        return false;
    }
    if (value.automation !== undefined && !isAutomation(value.automation)) {
        return false;
    }
    if (value.markers !== undefined && !Array.isArray(value.markers)) {
        return false;
    }
    if (value.adjustmentLayers !== undefined && !isAdjustmentLayers(value.adjustmentLayers)) {
        return false;
    }
    if (
        value.arrangements !== undefined &&
        (!Array.isArray(value.arrangements) || !value.arrangements.every(isArrangementSnapshot))
    ) {
        return false;
    }
    return value.audioBuffers === undefined || isAudioBuffers(value.audioBuffers);
}
