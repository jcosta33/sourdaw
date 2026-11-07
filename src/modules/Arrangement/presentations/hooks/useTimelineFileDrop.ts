import { type DragEvent, useState } from 'react';

import { decodeAudioFile, discardDecodedAudioFile, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { LIBRARY_SAMPLE_MALFORMED_MESSAGE, placeLibrarySample } from '#/modules/ContentBrowser/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { isAudioFile } from '#/utils/audioFileExtensions';
import { AI_RENDER_DRAG_MIME_TYPE, PLUGIN_DRAG_MIME_TYPE, SAMPLE_DRAG_MIME_TYPE } from '#/utils/dragMimeTypes';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createTrack } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { type ClipAudioAssetStaging } from '../../useCases/clip/clipAudioAssetStagingState';
import { stageClipAudioAsset } from '../../useCases/clip/stageClipAudioAsset';
import { compileNewAudioTrackAction } from '../../useCases/compileNewAudioTrackAction';
import { type CreationBatchAction, type CreationBatchResult, retainedCreation } from '../../useCases/creationBatch';
import { executeAddDeviceAction } from '../../useCases/device/executeAddDeviceAction';
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

type LibrarySamplePayload = Parameters<typeof placeLibrarySample>[0]['sample'];
type AiRenderPayload = { name: string; bufferId: string; durationSeconds: number };
type PluginPayload = { name: string; id: string };
type AudioTargetIntent = { kind: 'existing'; trackId: string } | { kind: 'create' };

/** A resolved drop target: the clip's track id, plus the track model to land
 *  in the same batch (as a compiled `addTrack` action) when the drop must
 *  create its own audio track. */
type AudioTargetPlan = { trackId: string; newTrack: ReturnType<typeof createTrack> | undefined };

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

function parseOptionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return requireString(value, field);
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

function parseSample(raw: string): LibrarySamplePayload {
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
        path: parseOptionalString(obj.path, 'path'),
        libraryRootId: parseOptionalString(obj.libraryRootId, 'libraryRootId'),
        audioBufferId: parseOptionalString(obj.audioBufferId, 'audioBufferId'),
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

function captureAudioTargetIntent(trackHit: string | null): AudioTargetIntent {
    const trackId = trackHit ?? trackStore.value?.selectedTrackId;
    const track = trackId ? trackStore.value?.tracks.find((candidate) => candidate.id === trackId) : null;
    return trackId && track?.kind === 'audio' ? { kind: 'existing', trackId } : { kind: 'create' };
}

export const useTimelineFileDrop = ({
    getCanvasCoords,
    getBeatFromX,
}: UseTimelineFileDropInput): UseTimelineFileDropResult => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    const handleFileDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
        const authority = captureProjectTransitionAuthority();
        event.preventDefault();
        setIsDragOver(false);

        const { x, y } = getCanvasCoords(event);
        const trackHit = hitTestTrack(y);
        const beat = Math.max(0, Math.floor(getBeatFromX(x)));
        const audioTargetIntent = captureAudioTargetIntent(trackHit);
        let createdAudioTargetId: string | undefined;
        // Resolves the drop's write plan instead of writing directly: the
        // caller lands track (when one must be created) and clip in one batch
        // of registered actions, so the whole drop is one undo step (#4618).
        const resolveAudioTarget = (name: string): AudioTargetPlan | null => {
            const targetId = audioTargetIntent.kind === 'existing' ? audioTargetIntent.trackId : createdAudioTargetId;
            if (targetId) {
                const target = trackStore.value?.tracks.find((candidate) => candidate.id === targetId);
                return target?.kind === 'audio' ? { trackId: targetId, newTrack: undefined } : null;
            }
            const track = createTrack({ name, kind: 'audio' });
            createdAudioTargetId = track.id;
            return { trackId: track.id, newTrack: track };
        };
        const runCreationBatch = (
            actions: CreationBatchAction[],
            groupLabel: string
        ): Promise<CreationBatchResult | null> =>
            executeAppActionBatch(actions, {
                groupId: `timeline-drop-${crypto.randomUUID()}`,
                groupLabel,
                source: 'manual',
                requireCompensation: true,
                shouldExecute: () => authority.isCurrent(),
            }).catch(() => null);

        // AI-rendered audio clips already have their AudioBuffer cached — just create
        // a clip pointing at the bufferId. No file decoding needed.
        const aiRenderData = event.dataTransfer.getData(AI_RENDER_DRAG_MIME_TYPE);
        if (aiRenderData) {
            let stagedAsset: ClipAudioAssetStaging | null = null;
            try {
                const render = parseAiRender(aiRenderData);
                let targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                const targetTrack = targetTrackId
                    ? trackStore.value?.tracks.find((time) => time.id === targetTrackId)
                    : null;
                let newTrack: ReturnType<typeof createTrack> | undefined;
                if (!targetTrackId || !targetTrack || targetTrack.kind !== 'audio') {
                    newTrack = createTrack({ name: render.name, kind: 'audio' });
                    targetTrackId = newTrack.id;
                }
                const model = buildTimelineRenderModel();
                const durationBeats = Math.max(1, Math.ceil((render.durationSeconds / 60) * model.tempo));
                // The generated PCM exists only in this peer's audio cache, so the
                // drop registers shareable, hash-verified bytes before the clip can
                // carry them to a collaborator (#3759, round 7). A staging failure
                // must not publish a clip a peer would receive as silence.
                const renderBuffer = getCachedAudioBuffer({ bufferId: render.bufferId });
                if (renderBuffer) {
                    try {
                        stagedAsset = await stageClipAudioAsset(renderBuffer, render.name);
                    } catch {
                        notifyUser(
                            `Could not place "${render.name}" — its audio could not be registered for sharing.`,
                            'error'
                        );
                        return;
                    }
                }
                const actions: CreationBatchAction[] = [];
                if (newTrack) {
                    actions.push(compileNewAudioTrackAction(newTrack));
                }
                actions.push({
                    type: 'addClip',
                    payload: {
                        trackId: targetTrackId,
                        startBeat: beat,
                        endBeat: beat + durationBeats,
                        name: render.name,
                        type: 'audio',
                        audioBufferId: render.bufferId,
                        assetHash: stagedAsset?.hash,
                    },
                });
                const batchResult = await runCreationBatch(actions, `Drop render: ${render.name}`);
                if (retainedCreation(batchResult)) {
                    if (stagedAsset) {
                        getAssetTransfer()?.promoteStagedAsset(stagedAsset.leaseId);
                    }
                } else if (stagedAsset) {
                    getAssetTransfer()?.releaseStagedAsset(stagedAsset.leaseId);
                }
            } catch {
                if (stagedAsset) {
                    getAssetTransfer()?.releaseStagedAsset(stagedAsset.leaseId);
                }
                notifyUser('Could not place the generated clip — the dropped item was malformed.', 'error');
            }
            return;
        }

        const sampleData = event.dataTransfer.getData(SAMPLE_DRAG_MIME_TYPE);
        if (sampleData) {
            setIsImporting(true);
            try {
                let sample: LibrarySamplePayload;
                try {
                    sample = parseSample(sampleData);
                } catch {
                    if (authority.isCurrent()) {
                        notifyUser(LIBRARY_SAMPLE_MALFORMED_MESSAGE, 'error');
                    }
                    return;
                }
                await placeLibrarySample({
                    sample,
                    placement: {
                        trackId: audioTargetIntent.kind === 'existing' ? audioTargetIntent.trackId : undefined,
                        startBeat: beat,
                    },
                    authority,
                    origin: 'timeline-drop',
                    readTempo: () => buildTimelineRenderModel().tempo,
                });
            } finally {
                setIsImporting(false);
            }
            return;
        }

        const pluginData = event.dataTransfer.getData(PLUGIN_DRAG_MIME_TYPE);
        if (pluginData) {
            try {
                const plugin = parsePlugin(pluginData);
                const targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                if (!targetTrackId) {
                    notifyUser('Drop the plugin onto a track to add it.', 'warning');
                    return;
                }
                // The payload carries both, and the action compiler receives the stable
                // id. Catalog names are unique, so a name lookup would not be ambiguous,
                // but the id is the key a device is stored under.
                void executeAddDeviceAction(targetTrackId, plugin.id);
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
                if (!authority.isCurrent()) {
                    return;
                }
                const isMidiFile =
                    file.type === 'audio/midi' ||
                    file.type === 'audio/x-midi' ||
                    ['mid', 'midi'].includes(file.name.toLowerCase().split('.').pop() ?? '');
                const isAudio = file.type.startsWith('audio/') || isAudioFile(file.name);

                if (isMidiFile) {
                    const result = await importMidiFile(file, { shouldContinue: authority.isCurrent });
                    if (result === 'superseded') {
                        return;
                    }
                    continue;
                }

                if (!isAudio) {
                    continue;
                }

                let decodedBufferId: string | undefined;
                let stagedAssetLeaseId: string | undefined;
                let committed = false;
                const assetTransfer = getAssetTransfer();
                try {
                    const { id: bufferId, buffer } = await decodeAudioFile(file);
                    decodedBufferId = bufferId;
                    if (!authority.isCurrent()) {
                        discardDecodedAudioFile(bufferId);
                        return;
                    }
                    const model = buildTimelineRenderModel();
                    const durationBeats = Math.max(4, Math.ceil((buffer.duration / 60) * model.tempo));

                    const stagedAsset = await assetTransfer?.stageLocalAsset(file, file.name);
                    stagedAssetLeaseId = stagedAsset?.leaseId;
                    if (!authority.isCurrent()) {
                        if (stagedAsset) {
                            assetTransfer?.releaseStagedAsset(stagedAsset.leaseId);
                        }
                        discardDecodedAudioFile(bufferId);
                        return;
                    }

                    const targetPlan = resolveAudioTarget(file.name.replace(/\.[^.]+$/, ''));
                    if (!targetPlan) {
                        if (stagedAsset) {
                            assetTransfer?.releaseStagedAsset(stagedAsset.leaseId);
                        }
                        discardDecodedAudioFile(bufferId);
                        return;
                    }

                    const actions: CreationBatchAction[] = [];
                    if (targetPlan.newTrack) {
                        actions.push(compileNewAudioTrackAction(targetPlan.newTrack));
                    }
                    actions.push({
                        type: 'addClip',
                        payload: {
                            trackId: targetPlan.trackId,
                            startBeat: currentBeat,
                            endBeat: currentBeat + durationBeats,
                            name: file.name.replace(/\.[^.]+$/, ''),
                            type: 'audio',
                            audioBufferId: bufferId,
                            assetHash: stagedAsset?.hash,
                        },
                    });
                    const batchResult = await runCreationBatch(
                        actions,
                        `Import audio: ${file.name.replace(/\.[^.]+$/, '')}`
                    );

                    if (!retainedCreation(batchResult)) {
                        if (stagedAsset) {
                            assetTransfer?.releaseStagedAsset(stagedAsset.leaseId);
                        }
                        discardDecodedAudioFile(bufferId);
                        return;
                    }
                    committed = true;
                    if (stagedAsset) {
                        assetTransfer?.promoteStagedAsset(stagedAsset.leaseId);
                    }

                    currentBeat += durationBeats;
                } catch {
                    if (!committed) {
                        if (stagedAssetLeaseId) {
                            assetTransfer?.releaseStagedAsset(stagedAssetLeaseId);
                        }
                        if (decodedBufferId) {
                            discardDecodedAudioFile(decodedBufferId);
                        }
                    }
                    if (authority.isCurrent()) {
                        notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
                    }
                }
            }
        } finally {
            setIsImporting(false);
        }
    };

    return { handleFileDrop, isDragOver, setIsDragOver, isImporting };
};
