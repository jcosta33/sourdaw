import { type ReactElement, type MouseEvent, useId } from 'react';

import { Star, Piano, Waves } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
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

const TrackKindIcon = ({ id, kind }: { id: string; kind: SoundPreset['trackKind'] }): ReactElement =>
    kind === 'midi' ? (
        <Piano id={id} className="size-3 text-[var(--color-accent-lavender)] shrink-0" aria-label="MIDI track" />
    ) : (
        <Waves id={id} className="size-3 text-[var(--color-accent-mint)] shrink-0" aria-label="Audio track" />
    );

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
    const baseId = useId();
    const categoryId = `${baseId}-category`;
    const kindId = `${baseId}-kind`;
    const chainId = `${baseId}-chain`;
    const chain = preset.devices.map((data) => data.name).join(' → ');

    // The card's main action is a full-size button (its ::after covers the whole
    // card); preview and favorite are sibling buttons raised above that cover, so
    // none nests inside another interactive element.
    return (
        <Row
            gap={2}
            align="start"
            className="group relative rounded-md px-3 py-2.5 bg-gradient-to-br from-surface-raised to-surface-base border border-border/20 transition-colors hover:from-surface-overlay hover:border-border/40 shadow-sm"
            onContextMenu={onContextMenu}
        >
            <div className="relative z-10 opacity-70 group-hover:opacity-100 transition-opacity">
                <PreviewButton
                    isPlaying={preview.playingId === preset.id}
                    itemName={preset.name}
                    onPlay={() => preview.play(preset.id, { kind: 'preset', presetId: preset.id })}
                    onStop={preview.stop}
                />
            </div>
            <Button
                variant="bare"
                size="bare"
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer justify-start text-left focus-visible:outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent-cyan/60"
                onClick={onClick}
                aria-label={preset.name}
                aria-describedby={hideCategory ? `${kindId} ${chainId}` : `${categoryId} ${kindId} ${chainId}`}
                title={selectedTrackId ? 'Click to load onto selected track' : 'Click to create a new track'}
            >
                <Stack gap={1.5} className="w-full min-w-0">
                    <Row gap={2} className="min-w-0">
                        <span className="flex-1 text-[12px] font-semibold text-foreground/90 truncate drop-shadow-sm">
                            {preset.name}
                        </span>
                        {!hideCategory ? (
                            <span
                                id={categoryId}
                                className={cn(
                                    'shrink-0 rounded px-1.5 py-[2px] text-[9px] font-semibold tracking-wide uppercase opacity-80',
                                    CATEGORY_COLORS[preset.category] || 'bg-accent text-muted-foreground'
                                )}
                            >
                                {preset.category}
                            </span>
                        ) : null}
                    </Row>
                    <Row gap={1.5} className="min-w-0 opacity-60 group-hover:opacity-100 transition-opacity">
                        <TrackKindIcon id={kindId} kind={preset.trackKind} />
                        <span
                            id={chainId}
                            className="text-[9px] text-muted-foreground group-hover:text-foreground/80 transition-colors truncate"
                        >
                            {chain}
                        </span>
                    </Row>
                </Stack>
            </Button>
            <Button
                variant="bare"
                size="bare"
                type="button"
                className={cn(
                    'relative z-10 size-4 flex items-center justify-center shrink-0 rounded hover:bg-accent opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all',
                    favorites.has(preset.id) ? 'opacity-100 scale-100' : 'scale-95'
                )}
                onClick={() => onToggleFavorite(preset.id)}
                aria-label={
                    favorites.has(preset.id)
                        ? `Remove ${preset.name} from favorites`
                        : `Add ${preset.name} to favorites`
                }
            >
                <Star
                    className={cn(
                        'size-3 transition-colors',
                        favorites.has(preset.id)
                            ? 'text-[var(--color-accent-peach)] fill-[var(--color-accent-peach)] drop-shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                />
            </Button>
        </Row>
    );
};
