import { type DragEvent, useState } from 'react';
import { hitTestTrack } from '../../useCases/timelineInteractions';
import {
    addClip,
    addTrack,
    addDevice,
    importMidiFile,
    decodeAudioFile,
} from '../../useCases/timelineViewActions';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { notifyUser } from '#/helpers/Notification/notifyUser';

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

        const sampleData = e.dataTransfer.getData('application/x-webdaw-sample');
        if (sampleData) {
            try {
                const sample = JSON.parse(sampleData) as {
                    name: string;
                    id: string;
                    duration: string;
                    durationSeconds?: number;
                    audioBufferId?: string;
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
                const durationBeats = sample.durationSeconds
                    ? Math.max(1, Math.ceil(sample.durationSeconds * 2))
                    : sample.duration.includes('bar')
                      ? parseInt(sample.duration) * 4
                      : 4;
                addClip({
                    trackId: targetTrackId,
                    startBeat: beat,
                    endBeat: beat + durationBeats,
                    name: sample.name,
                    type: 'audio',
                    audioBufferId: sample.audioBufferId,
                });
            } catch {
                /* ignored */
            }
            return;
        }

        const pluginData = e.dataTransfer.getData('application/x-webdaw-plugin');
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

                    addClip({
                        trackId: targetTrackId,
                        startBeat: currentBeat,
                        endBeat: currentBeat + durationBeats,
                        name: file.name.replace(/\.[^.]+$/, ''),
                        type: 'audio',
                        audioBufferId: bufferId,
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
