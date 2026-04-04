import { type DragEvent, useState } from 'react';
import { hitTestTrack } from '../../useCases/timelineInteractions/hitTestClip';
import {
    addClip,
    addTrack,
    addDevice,
    importMidiFile,
    decodeAudioFile,
} from '../../useCases/timelineViewActions';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { libraryStore } from '#/modules/SampleLibrary/stores/libraryStore';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { isTauri } from '#/helpers/tauriBridge';
import { getAssetTransfer } from '#/modules/Collaboration/useCases/collaboration';

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

export const useTimelineFileDrop = ({
    getCanvasCoords,
    getBeatFromX,
}: UseTimelineFileDropInput): UseTimelineFileDropResult => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    const handleFileDrop = async (e: DragEvent<HTMLDivElement>): Promise<void> => {
        e.preventDefault();
        setIsDragOver(false);

        const { x, y } = getCanvasCoords(e);
        const trackHit = hitTestTrack(y);
        const beat = Math.max(0, Math.floor(getBeatFromX(x)));

        const sampleData = e.dataTransfer.getData('application/x-sourdaw-sample');
        if (sampleData) {
            setIsImporting(true);
            try {
                const sample = JSON.parse(sampleData) as {
                    name: string;
                    id: string;
                    path: string;
                    libraryRootId: string;
                    durationSeconds?: number;
                };

                let targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                const sampleTargetTrack = targetTrackId
                    ? trackStore.value?.tracks.find((t) => t.id === targetTrackId)
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
                let durationBeats = sample.durationSeconds
                    ? Math.max(1, Math.ceil(sample.durationSeconds * 2))
                    : 4;

                try {
                    const root = libraryStore.value?.roots.find((r) => r.id === sample.libraryRootId);

                    if (isTauri() && root?.provider === 'tauri' && root.rootRef) {
                        // Tauri: resolve the absolute path and pass as a File-like object
                        const { invoke } = await import('@tauri-apps/api/core');
                        const absPath = `${root.rootRef}/${sample.path}`;
                        const bytes = (await invoke('read_audio_file', { path: absPath })) as number[];
                        const file = new File([new Uint8Array(bytes as ArrayLike<number>)], sample.path.split('/').pop() ?? sample.name);
                        const result = await decodeAudioFile(file);
                        audioBufferId = result.id;
                        durationBeats = Math.max(1, Math.ceil((result.buffer.duration / 60) * buildTimelineRenderModel().tempo));
                        assetHash = await getAssetTransfer()?.addLocalAsset(file, file.name);
                    } else if (!isTauri() && root?.provider === 'browser' && root.handle) {
                        // Browser FileSystem Access API: walk the directory handle to the file
                        const pathParts = sample.path.split('/');
                        const fileName = pathParts.pop()!;
                        let dirHandle: FileSystemDirectoryHandle = root.handle;
                        for (const part of pathParts) {
                            dirHandle = await dirHandle.getDirectoryHandle(part);
                        }
                        const fileHandle = await dirHandle.getFileHandle(fileName);
                        const file = await fileHandle.getFile();
                        try {
                            const result = await decodeAudioFile(file);
                            audioBufferId = result.id;
                            durationBeats = Math.max(1, Math.ceil((result.buffer.duration / 60) * buildTimelineRenderModel().tempo));
                            assetHash = await getAssetTransfer()?.addLocalAsset(file, file.name);
                        } catch {
                            notifyUser(`"${sample.name}" could not be decoded — this format may not be supported in the browser (e.g. ALAC or DRM-protected files).`, 'warning');
                        }
                    }
                } catch {
                    notifyUser(`Could not access "${sample.name}" — the file may have moved or folder permissions were revoked.`, 'warning');
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
                /* ignored */
            } finally {
                setIsImporting(false);
            }
            return;
        }

        const pluginData = e.dataTransfer.getData('application/x-sourdaw-plugin');
        if (pluginData) {
            try {
                const plugin = JSON.parse(pluginData) as { name: string; id: string };
                const targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                if (targetTrackId) {
                    addDevice(targetTrackId, plugin.name);
                }
            } catch {
                /* ignored */
            }
            return;
        }

        const files = Array.from(e.dataTransfer.files);
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
                        ? trackStore.value?.tracks.find((t) => t.id === targetTrackId)
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
