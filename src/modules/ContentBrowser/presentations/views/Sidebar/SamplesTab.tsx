import { type ReactElement } from 'react';

import { Folder, File, Star, Upload } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { addTrack, addClip } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { stageAudioBufferAsset } from '#/modules/AudioRendering/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { SAMPLE_DRAG_MIME_TYPE } from '#/utils/dragMimeTypes';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { cn } from '#/utils/Styles/cn';

import { PreviewButton } from '../../components/Sidebar/PreviewButton';
import { type SampleItem } from '../../components/Sidebar/sidebarConstants';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';

type SamplesTabProps = {
    samples: SampleItem[];
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    selectedTrackId: string | null;
    preview: PreviewHandle;
};

export const SamplesTab = ({
    samples,
    favorites,
    onToggleFavorite,
    selectedTrackId,
    preview,
}: SamplesTabProps): ReactElement => {
    const categories = [...new Set(samples.map((state) => state.category))];

    const handleAdd = async (sample: SampleItem): Promise<void> => {
        let trackId = selectedTrackId;
        if (!trackId) {
            const newTrack = addTrack({ name: sample.name, kind: 'audio' });
            if (!newTrack) {
                return;
            }
            trackId = newTrack.id;
        }
        const tempo = transportStore.value?.tempo ?? defaultTransportState.tempo;
        let cachedBuffer: AudioBuffer | null | undefined;
        if (sample.audioBufferId) {
            cachedBuffer = getCachedAudioBuffer({ bufferId: sample.audioBufferId });
        }
        const durationSeconds = sample.durationSeconds ?? cachedBuffer?.duration;
        let durationBeats = 8;
        if (durationSeconds !== undefined) {
            durationBeats = Math.max(1, Math.ceil((durationSeconds / 60) * tempo));
        }
        // A clicked sample becomes a shareable clip, so its cached PCM is
        // staged before publication: the clip's assetHash is the identity a
        // receiving peer requests and verifies the bytes against (#3759).
        let stagedAsset: Awaited<ReturnType<typeof stageAudioBufferAsset>> = null;
        if (cachedBuffer) {
            try {
                stagedAsset = await stageAudioBufferAsset(cachedBuffer, sample.name);
            } catch {
                notifyUser(`Failed to add "${sample.name}" — asset registration failed`, 'error');
                return;
            }
        }
        const clip = addClip({
            trackId,
            startBeat: 0,
            endBeat: durationBeats,
            name: sample.name,
            type: 'audio',
            audioBufferId: sample.audioBufferId,
            assetHash: stagedAsset?.hash,
        });
        if (!clip) {
            if (stagedAsset) {
                getAssetTransfer()?.releaseStagedAsset(stagedAsset.leaseId);
            }
            return;
        }
        if (stagedAsset) {
            getAssetTransfer()?.promoteStagedAsset(stagedAsset.leaseId);
        }
    };

    return (
        <Stack gap={2}>
            {samples.length === 0 ? (
                <div className="px-3 py-4">
                    <DawEmptyState
                        compact
                        icon={<Upload className="size-4" />}
                        title="No samples yet"
                        description="Click Import above or drag audio files here."
                    />
                </div>
            ) : null}
            {categories.map((cat) => (
                <div key={cat}>
                    <Row gap={1} className="px-1 py-0.5">
                        <Folder className="size-3 text-muted-foreground" />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase">{cat}</span>
                    </Row>
                    {samples
                        .filter((state) => state.category === cat)
                        .map((sample) => (
                            <div
                                key={sample.id}
                                draggable
                                className="group"
                                onDragStart={(event) => {
                                    const data = {
                                        name: sample.name,
                                        id: sample.id,
                                        duration: sample.duration,
                                        audioBufferId: sample.audioBufferId,
                                        durationSeconds: sample.durationSeconds,
                                    };
                                    event.dataTransfer.setData(SAMPLE_DRAG_MIME_TYPE, JSON.stringify(data));
                                    event.dataTransfer.effectAllowed = 'copy';
                                }}
                                onClick={() => void handleAdd(sample)}
                                title="Drag to timeline or click to add"
                            >
                                <DawPickerRow
                                    className="cursor-grab active:cursor-grabbing px-2 py-1"
                                    startSlot={
                                        <Row gap={1}>
                                            <PreviewButton
                                                isPlaying={preview.playingId === sample.id}
                                                onPlay={() => {
                                                    const buffer = sample.audioBufferId
                                                        ? getCachedAudioBuffer({ bufferId: sample.audioBufferId })
                                                        : undefined;
                                                    if (buffer) {
                                                        preview.play(sample.id, buffer);
                                                    } else {
                                                        preview.playTone(sample.id, 261.63, 0.5);
                                                    }
                                                }}
                                                onStop={preview.stop}
                                            />
                                            <File className="size-3 text-muted-foreground" />
                                        </Row>
                                    }
                                    heading={sample.name}
                                    description={sample.duration}
                                    endSlot={
                                        <Button
                                            variant="bare"
                                            size="bare"
                                            type="button"
                                            className={cn(
                                                'size-3 opacity-0 transition-opacity group-hover:opacity-100',
                                                favorites.has(sample.id) && 'opacity-100'
                                            )}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onToggleFavorite(sample.id);
                                            }}
                                            aria-label={
                                                favorites.has(sample.id) ? 'Remove from favorites' : 'Add to favorites'
                                            }
                                        >
                                            <Star
                                                className={cn(
                                                    'size-3',
                                                    favorites.has(sample.id)
                                                        ? 'text-[var(--color-accent-peach)] fill-[var(--color-accent-peach)]'
                                                        : 'text-muted-foreground'
                                                )}
                                            />
                                        </Button>
                                    }
                                />
                            </div>
                        ))}
                </div>
            ))}
        </Stack>
    );
};
