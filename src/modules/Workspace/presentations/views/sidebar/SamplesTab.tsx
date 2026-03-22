import { type ReactElement } from 'react';
import { Folder, File, Star, Upload } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { addTrack } from '../../../useCases/workspaceViewActions';
import { addClip } from '../../../useCases/workspaceViewActions';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { PreviewButton } from '../../components/sidebar/PreviewButton';
import { type SampleItem } from '../../components/sidebar/sidebarConstants';
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
    const categories = [...new Set(samples.map((s) => s.category))];

    const handleAdd = (sample: SampleItem) => {
        let trackId = selectedTrackId;
        if (!trackId) {
            const newTrack = addTrack({ name: sample.name, kind: 'audio' });
            if (!newTrack) {
                return;
            }
            trackId = newTrack.id;
        }
        const durationBeats = sample.durationSeconds ? Math.max(1, Math.ceil(sample.durationSeconds * 2)) : 8;
        addClip({
            trackId,
            startBeat: 0,
            endBeat: durationBeats,
            name: sample.name,
            type: 'audio',
            audioBufferId: sample.audioBufferId,
        });
    };

    return (
        <div className="space-y-2">
            {samples.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <Upload className="size-6 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground">No samples yet</p>
                    <p className="text-[10px] text-muted-foreground/60">Click Import above or drag audio files here</p>
                </div>
            )}
            {categories.map((cat) => (
                <div key={cat}>
                    <div className="flex items-center gap-1 px-1 py-0.5">
                        <Folder className="size-3 text-muted-foreground" />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase">{cat}</span>
                    </div>
                    {samples
                        .filter((s) => s.category === cat)
                        .map((sample) => (
                            <div
                                key={sample.id}
                                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-white/[0.06] cursor-grab active:cursor-grabbing group"
                                draggable
                                onDragStart={(e) => {
                                    const data = {
                                        name: sample.name,
                                        id: sample.id,
                                        duration: sample.duration,
                                        audioBufferId: sample.audioBufferId,
                                    };
                                    e.dataTransfer.setData('application/x-webdaw-sample', JSON.stringify(data));
                                    e.dataTransfer.effectAllowed = 'copy';
                                }}
                                onClick={() => {
                                    handleAdd(sample);
                                }}
                                title="Drag to timeline or click to add"
                            >
                                <PreviewButton
                                    isPlaying={preview.playingId === sample.id}
                                    onPlay={() => {
                                        const buffer = sample.audioBufferId
                                            ? audioBufferCache.get(sample.audioBufferId)
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
                                <span className="flex-1 text-xs text-foreground truncate">{sample.name}</span>
                                <span className="text-[9px] text-muted-foreground">{sample.duration}</span>
                                <button
                                    type="button"
                                    className={cn(
                                        'size-3 opacity-0 group-hover:opacity-100 transition-opacity',
                                        favorites.has(sample.id) && 'opacity-100'
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleFavorite(sample.id);
                                    }}
                                    aria-label={favorites.has(sample.id) ? 'Remove from favorites' : 'Add to favorites'}
                                >
                                    <Star
                                        className={cn(
                                            'size-3',
                                            favorites.has(sample.id)
                                                ? 'text-yellow-400 fill-yellow-400'
                                                : 'text-muted-foreground'
                                        )}
                                    />
                                </button>
                            </div>
                        ))}
                </div>
            ))}
        </div>
    );
};
