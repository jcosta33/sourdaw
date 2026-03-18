import { type ReactElement } from 'react';
import { Star, Piano, Waves } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { type SoundPreset } from '../../../useCases/workspaceViewActions';
import { PreviewButton } from './PreviewButton';
import { CATEGORY_COLORS } from './sidebarConstants';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';

export type PresetItemProps = {
    preset: SoundPreset;
    selectedTrackId: string | null;
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    onClick: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    preview: PreviewHandle;
};

export const PresetItem = ({
    preset,
    selectedTrackId,
    favorites,
    onToggleFavorite,
    onClick,
    onContextMenu,
    preview,
}: PresetItemProps): ReactElement => {
    const chain = preset.devices.map((d) => d.name).join(' → ');

    return (
        <div
            className="group flex flex-col gap-0.5 rounded px-2 py-1.5 hover:bg-accent/50 cursor-pointer"
            onClick={onClick}
            onContextMenu={onContextMenu}
            title={selectedTrackId ? 'Click to load onto selected track' : 'Click to create a new track'}
        >
            <div className="flex items-center gap-1">
                <PreviewButton
                    isPlaying={preview.playingId === preset.id}
                    onPlay={() => {
                        preview.playTone(preset.id, 261.63, 0.5);
                    }}
                    onStop={preview.stop}
                />
                <span className="flex-1 text-xs font-medium text-foreground truncate">{preset.name}</span>
                <span
                    className={cn(
                        'shrink-0 rounded-full px-1.5 py-px text-[8px] font-medium capitalize',
                        CATEGORY_COLORS[preset.category]
                    )}
                >
                    {preset.category}
                </span>
                <button
                    type="button"
                    className={cn(
                        'size-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity',
                        favorites.has(preset.id) ? 'opacity-100' : ''
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(preset.id);
                    }}
                    aria-label={favorites.has(preset.id) ? 'Remove from favorites' : 'Add to favorites'}
                >
                    <Star
                        className={cn(
                            'size-3',
                            favorites.has(preset.id) ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'
                        )}
                    />
                </button>
            </div>
            <div className="flex items-center gap-1">
                {preset.trackKind === 'midi' ? (
                    <Piano className="size-2.5 text-purple-400 shrink-0" aria-label="MIDI track" />
                ) : (
                    <Waves className="size-2.5 text-green-400 shrink-0" aria-label="Audio track" />
                )}
                <span className="text-[9px] text-muted-foreground truncate">{chain}</span>
            </div>
        </div>
    );
};
