import { type ReactElement } from 'react';
import { Star, Piano, Waves } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { type SoundPreset } from '../../../useCases/workspaceViewActions';
import { PreviewButton } from './PreviewButton';
import { CATEGORY_COLORS } from './sidebarConstants';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';

type PresetItemProps = {
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
            className="group flex flex-col gap-1 rounded-md px-2 py-2 border border-transparent transition-colors hover:bg-surface-raised hover:border-border/40 cursor-pointer"
            onClick={onClick}
            onContextMenu={onContextMenu}
            title={selectedTrackId ? 'Click to load onto selected track' : 'Click to create a new track'}
        >
            <div className="flex items-center gap-2">
                <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                    <PreviewButton
                        isPlaying={preview.playingId === preset.id}
                        onPlay={() => preview.playTone(preset.id, 261.63, 0.5)}
                        onStop={preview.stop}
                    />
                </div>
                <span className="flex-1 text-[11px] font-medium text-foreground/90 truncate drop-shadow-sm">
                    {preset.name}
                </span>
                <span
                    className={cn(
                        'shrink-0 rounded px-1.5 py-[2px] text-[9px] font-semibold tracking-wide uppercase opacity-80',
                        CATEGORY_COLORS[preset.category] || 'bg-accent text-muted-foreground'
                    )}
                >
                    {preset.category}
                </span>
                <button
                    type="button"
                    className={cn(
                        'size-4 flex items-center justify-center shrink-0 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-all',
                        favorites.has(preset.id) ? 'opacity-100 scale-100' : 'scale-95'
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(preset.id);
                    }}
                    aria-label={favorites.has(preset.id) ? 'Remove from favorites' : 'Add to favorites'}
                >
                    <Star
                        className={cn(
                            'size-3 transition-colors',
                            favorites.has(preset.id)
                                ? 'text-[var(--color-accent-peach)] fill-[var(--color-accent-peach)] drop-shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    />
                </button>
            </div>
            <div className="flex items-center gap-1.5 pl-[26px] opacity-60 group-hover:opacity-100 transition-opacity">
                {preset.trackKind === 'midi' ? (
                    <Piano className="size-3 text-[var(--color-accent-lavender)] shrink-0" aria-label="MIDI track" />
                ) : (
                    <Waves className="size-3 text-[var(--color-accent-mint)] shrink-0" aria-label="Audio track" />
                )}
                <span className="text-[9px] text-muted-foreground group-hover:text-foreground/80 transition-colors truncate">
                    {chain}
                </span>
            </div>
        </div>
    );
};
