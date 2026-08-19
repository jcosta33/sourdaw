import { type DragEvent, useState } from 'react';

import { decodeAudioFile, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { resolveDroppedSampleFile } from '#/modules/SampleLibrary/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { trackStore } from '../../stores/trackStore';
import { addTrack } from '../../useCases/addTrack';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { addClip } from '../../useCases/clip/addClip';
import { compileAddDeviceAction } from '../../useCases/device/compileAddDeviceAction';
import { importMidiFile } from '../../useCases/importMidiFile';
import { hitTestTrack } from '../../useCases/timelineInteractions/hitTestClip/hitTestTrack';

type GetCanvasCoords = (e: DragEvent<HTMLDivElement>) => { x: number; y: number };
type GetBeatFromX = (x: number) => number;

type UseTimelineFileDropInput = {
    getCanvasCoords: GetCanvasCoords;
    getBeatFromX: GetBeatFromX;
};

type UseTimelineFileDropResult = {
    handleFileDrop: (e: DragEvent<HTMLDivElement>) => Promise<void>;
    isDragOver: boolean;
    setIsDragOver: (value: boolean) => void;
    isImporting: boolean;
};

type AiRenderPayload = { name: string; bufferId: string; durationSeconds: number };
type SamplePayload = { name: string; id: string; path: string; libraryRootId: string; durationSeconds?: number };
type PluginPayload = { name: string; id: string };

function asRecord(raw: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
        throw new TypeError('drag payload is not an object');
    }
    return parsed as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`drag payload field "${field}" is not a non-empty string`);
    }
    return value;
}

function requireFiniteNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`drag payload field "${field}" is not a finite number`);
    }
    return value;
}

// Validate the AI-render drag payload before it can produce a clip. A missing
// or non-finite durationSeconds previously yielded a NaN duration that addClip
// silently rejected (no-op drop with no feedback — #35-new); throwing here
// routes it to a user-facing error instead.
function parseAiRender(raw: string): AiRenderPayload {
    const obj = asRecord(raw);
    return {
        name: requireString(obj.name, 'name'),
        bufferId: requireString(obj.bufferId, 'bufferId'),
        durationSeconds: requireFiniteNumber(obj.durationSeconds, 'durationSeconds'),
    };
}

function parseSample(raw: string): SamplePayload {
    const obj = asRecord(raw);
    let durationSeconds: number | undefined;
    if (obj.durationSeconds !== undefined) {
        // Only a present-but-invalid duration is rejected; absence is allowed
        // (the drop handler falls back to a default beat length).
        durationSeconds = requireFiniteNumber(obj.durationSeconds, 'durationSeconds');
    }
    return {
        name: requireString(obj.name, 'name'),
        id: requireString(obj.id, 'id'),
        path: requireString(obj.path, 'path'),
        libraryRootId: requireString(obj.libraryRootId, 'libraryRootId'),
        durationSeconds,
    };
}

function parsePlugin(raw: string): PluginPayload {
    const obj = asRecord(raw);
    return {
        name: requireString(obj.name, 'name'),
        id: requireString(obj.id, 'id'),
    };
}

export const useTimelineFileDrop = ({
    getCanvasCoords,
    getBeatFromX,
}: UseTimelineFileDropInput): UseTimelineFileDropResult => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    const handleFileDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
        event.preventDefault();
        setIsDragOver(false);

        const { x, y } = getCanvasCoords(event);
        const trackHit = hitTestTrack(y);
        const beat = Math.max(0, Math.floor(getBeatFromX(x)));

        // AI-rendered audio clips already have their AudioBuffer cached — just create
        // a clip pointing at the bufferId. No file decoding needed.
        const aiRenderData = event.dataTransfer.getData('application/x-sourdaw-ai-render');
        if (aiRenderData) {
            try {
                const render = parseAiRender(aiRenderData);
                let targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                const targetTrack = targetTrackId
                    ? trackStore.value?.tracks.find((time) => time.id === targetTrackId)
                    : null;
                if (!targetTrackId || !targetTrack || targetTrack.kind !== 'audio') {
                    const newTrack = addTrack({ name: render.name, kind: 'audio' });
                    if (!newTrack) {
                        return;
                    }
                    targetTrackId = newTrack.id;
                }
                const model = buildTimelineRenderModel();
                const durationBeats = Math.max(1, Math.ceil((render.durationSeconds / 60) * model.tempo));
                addClip({
                    trackId: targetTrackId,
                    startBeat: beat,
                    endBeat: beat + durationBeats,
                    name: render.name,
                    type: 'audio',
                    audioBufferId: render.bufferId,
                });
            } catch {
                notifyUser('Could not place the generated clip — the dropped item was malformed.', 'error');
            }
            return;
        }

        const sampleData = event.dataTransfer.getData('application/x-sourdaw-sample');
        if (sampleData) {
            setIsImporting(true);
            try {
                const sample = parseSample(sampleData);

                let targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                const sampleTargetTrack = targetTrackId
                    ? trackStore.value?.tracks.find((time) => time.id === targetTrackId)
                    : null;
                if (!targetTrackId || !sampleTargetTrack || sampleTargetTrack.kind !== 'audio') {
                    const newTrack = addTrack({ name: sample.name, kind: 'audio' });
                    if (!newTrack) {
                        return;
                    }
                    targetTrackId = newTrack.id;
                }

                // Decode the actual audio file so it goes into audioBufferCache.
                // Without this, the clip has no bufferId and will be silent in exports.
                let audioBufferId: string | undefined;
                let assetHash: string | undefined;
                let durationBeats = sample.durationSeconds ? Math.max(1, Math.ceil(sample.durationSeconds * 2)) : 4;

                // Factory (and any already-decoded) samples keep their AudioBuffer
                // in the cache under the sample id — there is no file to re-read and
                // the factory root is handle-less ('browser' shim, empty rootRef),
                // so the SampleLibrary file resolver would have nothing to resolve.
                // Resolve the buffer id straight from the cache before attempting
                // any file access or decode.
                const cachedBuffer = getCachedAudioBuffer({ bufferId: sample.id });
                if (cachedBuffer) {
                    audioBufferId = sample.id;
                    durationBeats = Math.max(
                        1,
                        Math.ceil((cachedBuffer.duration / 60) * buildTimelineRenderModel().tempo)
                    );
                }

                try {
                    if (!audioBufferId) {
                        const resolvedSampleFile = await resolveDroppedSampleFile({
                            libraryRootId: sample.libraryRootId,
                            relativePath: sample.path,
                            fallbackName: sample.name,
                        });
                        if (resolvedSampleFile.status === 'resolved') {
                            const { file } = resolvedSampleFile;
                            try {
                                const result = await decodeAudioFile(file);
                                audioBufferId = result.id;
                                durationBeats = Math.max(
                                    1,
                                    Math.ceil((result.buffer.duration / 60) * buildTimelineRenderModel().tempo)
                                );
                                assetHash = await getAssetTransfer()?.addLocalAsset(file, file.name);
                            } catch {
                                notifyUser(
                                    `"${sample.name}" could not be decoded — the file may be DRM-protected or corrupt.`,
                                    'warning'
                                );
                            }
                        }
                    }
                } catch {
                    notifyUser(
                        `Could not access "${sample.name}" — the file may have moved or folder permissions were revoked.`,
                        'warning'
                    );
                }

                addClip({
                    trackId: targetTrackId,
                    startBeat: beat,
                    endBeat: beat + durationBeats,
                    name: sample.name,
                    type: 'audio',
                    audioBufferId,
                    assetHash,
                });
            } catch {
                notifyUser('Could not place the dropped sample — its metadata was malformed.', 'error');
            } finally {
                setIsImporting(false);
            }
            return;
        }

        const pluginData = event.dataTransfer.getData('application/x-sourdaw-plugin');
        if (pluginData) {
            try {
                const plugin = parsePlugin(pluginData);
                const targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                if (!targetTrackId) {
                    notifyUser('Drop the plugin onto a track to add it.', 'warning');
                    return;
                }
                // The payload carries both, and the action compiler receives the stable id,
                // id. `De-esser`, `LUFS Meter` and `Stereo Widener` each name two
                // catalog plugins, so a name lookup returns whichever the registry
                // lists first rather than the card that was dragged.
                const action = compileAddDeviceAction(targetTrackId, plugin.id);
                if (action) {
                    void executeAppAction(action);
                }
            } catch {
                notifyUser('Could not add the dropped plugin — its data was malformed.', 'error');
            }
            return;
        }

        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) {
            return;
        }

        setIsImporting(true);
        let currentBeat = beat;
        try {
            for (const file of files) {
                const isMidiFile =
                    file.type === 'audio/midi' ||
                    file.type === 'audio/x-midi' ||
                    ['mid', 'midi'].includes(file.name.toLowerCase().split('.').pop() ?? '');
                const isAudioFile =
                    file.type.startsWith('audio/') ||
                    ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'aiff', 'aif'].includes(
                        file.name.toLowerCase().split('.').pop() ?? ''
                    );

                if (isMidiFile) {
                    await importMidiFile(file);
                    continue;
                }

                if (!isAudioFile) {
                    continue;
                }

                try {
                    const { id: bufferId, buffer } = await decodeAudioFile(file);
                    const model = buildTimelineRenderModel();
                    const durationBeats = Math.max(4, Math.ceil((buffer.duration / 60) * model.tempo));

                    let targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                    const targetTrack = targetTrackId
                        ? trackStore.value?.tracks.find((time) => time.id === targetTrackId)
                        : null;
                    if (!targetTrackId || !targetTrack || targetTrack.kind !== 'audio') {
                        const newTrack = addTrack({ name: file.name.replace(/\.[^.]+$/, ''), kind: 'audio' });
                        if (!newTrack) {
                            return;
                        }
                        targetTrackId = newTrack.id;
                    }

                    const assetHash = await getAssetTransfer()?.addLocalAsset(file, file.name);

                    addClip({
                        trackId: targetTrackId,
                        startBeat: currentBeat,
                        endBeat: currentBeat + durationBeats,
                        name: file.name.replace(/\.[^.]+$/, ''),
                        type: 'audio',
                        audioBufferId: bufferId,
                        assetHash,
                    });

                    currentBeat += durationBeats;
                } catch {
                    notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
                }
            }
        } finally {
            setIsImporting(false);
        }
    };

    return { handleFileDrop, isDragOver, setIsDragOver, isImporting };
};
