import { type ReactElement, type MouseEvent } from 'react';

import { Star, Piano, Waves } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

import { type SoundPresetView as SoundPreset } from '../../../models/SoundPresetViewTypes';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';

import { PreviewButton } from './PreviewButton';
import { CATEGORY_COLORS } from './sidebarConstants';

type PresetItemProps = {
    preset: SoundPreset;
    selectedTrackId: string | null;
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    onClick: () => void;
    onContextMenu?: (e: MouseEvent) => void;
    preview: PreviewHandle;
    /** Hide the category badge (when already inside that category's view) */
    hideCategory?: boolean;
};

export const PresetItem = ({
    preset,
    selectedTrackId,
    favorites,
    onToggleFavorite,
    onClick,
    onContextMenu,
    preview,
    hideCategory,
}: PresetItemProps): ReactElement => {
    const chain = preset.devices.map((data) => data.name).join(' → ');

    return (
        <Stack
            gap={1.5}
            className="group rounded-md px-3 py-2.5 bg-gradient-to-br from-surface-raised to-surface-base border border-border/20 transition-colors hover:from-surface-overlay hover:border-border/40 cursor-pointer mb-1.5 shadow-sm"
            onClick={onClick}
            onContextMenu={onContextMenu}
            title={selectedTrackId ? 'Click to load onto selected track' : 'Click to create a new track'}
        >
            <Row gap={2}>
                <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                    <PreviewButton
                        isPlaying={preview.playingId === preset.id}
                        onPlay={() => preview.playTone(preset.id, 261.63, 0.5)}
                        onStop={preview.stop}
                    />
                </div>
                <span className="flex-1 text-[12px] font-semibold text-foreground/90 truncate drop-shadow-sm">
                    {preset.name}
                </span>
                {!hideCategory ? (
                    <span
                        className={cn(
                            'shrink-0 rounded px-1.5 py-[2px] text-[9px] font-semibold tracking-wide uppercase opacity-80',
                            CATEGORY_COLORS[preset.category] || 'bg-accent text-muted-foreground'
                        )}
                    >
                        {preset.category}
                    </span>
                ) : null}
                <button
                    type="button"
                    className={cn(
                        'size-4 flex items-center justify-center shrink-0 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-all',
                        favorites.has(preset.id) ? 'opacity-100 scale-100' : 'scale-95'
                    )}
                    onClick={(event) => {
                        event.stopPropagation();
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
            </Row>
            <Row gap={1.5} className="pl-[26px] opacity-60 group-hover:opacity-100 transition-opacity">
                {preset.trackKind === 'midi' ? (
                    <Piano className="size-3 text-[var(--color-accent-lavender)] shrink-0" aria-label="MIDI track" />
                ) : (
                    <Waves className="size-3 text-[var(--color-accent-mint)] shrink-0" aria-label="Audio track" />
                )}
                <span className="text-[9px] text-muted-foreground group-hover:text-foreground/80 transition-colors truncate">
                    {chain}
                </span>
            </Row>
        </Stack>
    );
};
