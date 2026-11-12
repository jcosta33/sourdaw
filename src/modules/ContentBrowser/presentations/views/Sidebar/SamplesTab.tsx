import { type ReactElement } from 'react';

import { Folder, File, Star, Upload } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { SAMPLE_DRAG_MIME_TYPE } from '#/utils/dragMimeTypes';
import { cn } from '#/utils/Styles/cn';

import { addBrowserSample } from '../../../useCases/addBrowserSample';
import { PreviewButton } from '../../components/Sidebar/PreviewButton';
import { type SampleItem } from '../../components/Sidebar/sidebarConstants';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';

type SamplesTabProps = {
    samples: SampleItem[];
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    preview: PreviewHandle;
};

export const SamplesTab = ({ samples, favorites, onToggleFavorite, preview }: SamplesTabProps): ReactElement => {
    const categories = [...new Set(samples.map((state) => state.category))];

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
                                title="Drag to timeline or click to add"
                            >
                                <DawPickerRow
                                    className="cursor-grab active:cursor-grabbing px-2 py-1"
                                    startSlot={
                                        <Row gap={1}>
                                            <PreviewButton
                                                isPlaying={preview.playingId === sample.id}
                                                itemName={sample.name}
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
                                    heading={
                                        <Button
                                            variant="bare"
                                            size="sm"
                                            type="button"
                                            className="w-full justify-start text-left focus-visible:ring-inset"
                                            aria-label={`Add ${sample.name} to timeline`}
                                            onClick={() =>
                                                void addBrowserSample({
                                                    id: sample.id,
                                                    name: sample.name,
                                                    audioBufferId: sample.audioBufferId,
                                                    durationSeconds: sample.durationSeconds,
                                                })
                                            }
                                        >
                                            {sample.name}
                                        </Button>
                                    }
                                    description={sample.duration}
                                    endSlot={
                                        <Button
                                            variant="bare"
                                            size="bare"
                                            type="button"
                                            className={cn(
                                                'size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                                                favorites.has(sample.id) && 'opacity-100'
                                            )}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onToggleFavorite(sample.id);
                                            }}
                                            aria-label={
                                                favorites.has(sample.id)
                                                    ? `Remove ${sample.name} from favorites`
                                                    : `Add ${sample.name} to favorites`
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
