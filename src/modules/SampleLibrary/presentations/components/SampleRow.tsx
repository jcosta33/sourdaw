/**
 * SampleRow — single sample file entry with preview, favorite, drag-to-timeline.
 */
import { type ReactElement } from 'react';

import { File, Star, SearchCode, AlertTriangle, Plus } from 'lucide-react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

import { type SampleRecord, isBrowserDecodeRisky } from '../../models/LibraryTypes';

type SampleRowProps = {
    sample: SampleRecord;
    isPlaying: boolean;
    showBrowserDecodeWarnings: boolean;
    onPlay: () => void;
    onStop: () => void;
    onToggleFavorite: () => void;
    onFindSimilar: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onClick: () => void;
    /**
     * Keyboard/non-pointer alternative to drag-to-timeline. When provided, an
     * "Add to track" button is rendered so the sample can be placed without a
     * pointer drag.
     */
    onAddToTrack?: () => void;
    /** Roving tabindex within the listbox: 0 for the active option, -1 otherwise. */
    tabIndex?: number;
    /** Listbox keyboard handler (arrow navigation) forwarded from the parent. */
    onKeyDown?: (e: React.KeyboardEvent) => void;
};

function formatDuration(sec?: number): string {
    if (!sec) {
        return '';
    }
    if (sec < 1) {
        return `${(sec * 1000).toFixed(0)}ms`;
    }
    if (sec < 60) {
        return `${sec.toFixed(1)}s`;
    }
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes?: number): string {
    if (!bytes) {
        return '';
    }
    if (bytes < 1024) {
        return `${bytes}B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(0)}KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const SampleRow = ({
    sample,
    isPlaying,
    showBrowserDecodeWarnings,
    onPlay,
    onStop,
    onToggleFavorite,
    onFindSimilar,
    onDragStart,
    onClick,
    onAddToTrack,
    tabIndex = -1,
    onKeyDown,
}: SampleRowProps): ReactElement => (
    <Row
        gap={1}
        className="rounded px-1.5 py-0.5 hover:bg-white/[0.06] focus:bg-white/[0.08] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-cyan/60 cursor-grab active:cursor-grabbing group"
        role="option"
        aria-selected={tabIndex === 0}
        aria-label={`Sample ${sample.displayName}${sample.favorite ? ', favorite' : ''}`}
        tabIndex={tabIndex}
        draggable
        onDragStart={onDragStart}
        onClick={onClick}
        onKeyDown={(e) => {
            // Arrow navigation is delegated to the parent listbox handler and
            // applies wherever focus sits in the row.
            if (e.key !== 'Enter' && e.key !== ' ') {
                onKeyDown?.(e);
                return;
            }
            // Enter/Space activate the row's primary action (preview) — but only
            // when the option itself holds focus. When a nested button (play,
            // favorite, …) is focused, let it handle its own activation so we
            // don't double-fire.
            if (e.target === e.currentTarget) {
                e.preventDefault();
                onClick();
            }
        }}
        title={sample.relativePath}
    >
        {/* Play button */}
        <button
            type="button"
            aria-label={isPlaying ? `Stop ${sample.displayName}` : `Play ${sample.displayName}`}
            className={cn(
                'size-4 rounded flex items-center justify-center shrink-0 transition-colors',
                isPlaying ? 'bg-white/10 text-foreground' : 'text-muted-foreground/40 hover:text-foreground'
            )}
            onClick={(e) => {
                e.stopPropagation();
                if (isPlaying) {
                    onStop();
                } else {
                    onPlay();
                }
            }}
        >
            {isPlaying ? <span className="text-[8px] font-bold">■</span> : <span className="text-[8px]">▶</span>}
        </button>

        <File className="size-3 text-muted-foreground/40 shrink-0" />
        <span className="flex-1 text-[10px] text-foreground truncate">{sample.displayName}</span>

        {/* BPM & Key metadata (G1) */}
        {sample.analysis?.bpm ? (
            <span className="text-[8px] text-accent-cyan/60 font-mono shrink-0 px-1">
                {Math.round(sample.analysis.bpm)}
            </span>
        ) : null}
        {sample.analysis?.key ? (
            <span className="text-[8px] text-accent-gold/60 font-mono shrink-0 w-[24px] text-center">
                {sample.analysis.key}
            </span>
        ) : null}

        <span className="text-[8px] text-muted-foreground/30 uppercase shrink-0">{sample.ext}</span>

        {/* Format-unsupported badge: in the browser, flag extensions the platform
            commonly cannot decode (AIFF/FLAC/AAC/M4A) so a failed preview is
            explained up front. The native build decodes these, so it is hidden there. */}
        {showBrowserDecodeWarnings && isBrowserDecodeRisky(sample.ext) ? (
            <span title={`${sample.ext.toUpperCase()} may not preview in your browser`} className="shrink-0">
                <AlertTriangle className="size-2.5 text-amber-500/70" />
            </span>
        ) : null}

        {sample.format.durationSec ? (
            <span className="text-[8px] text-muted-foreground/40 font-mono shrink-0 w-[32px] text-right">
                {formatDuration(sample.format.durationSec)}
            </span>
        ) : null}

        {sample.sync.sizeBytes ? (
            <span className="text-[8px] text-muted-foreground/30 font-mono shrink-0 w-[32px] text-right">
                {formatSize(sample.sync.sizeBytes)}
            </span>
        ) : null}

        {/* Add to track — keyboard/non-pointer alternative to drag-to-timeline */}
        {onAddToTrack ? (
            <button
                type="button"
                aria-label={`Add ${sample.displayName} to track`}
                className="size-3 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-accent-cyan"
                onClick={(e) => {
                    e.stopPropagation();
                    onAddToTrack();
                }}
                title="Add to track"
            >
                <Plus className="size-3" />
            </button>
        ) : null}

        {/* Favorite */}
        <button
            type="button"
            aria-pressed={sample.favorite}
            aria-label={
                sample.favorite
                    ? `Remove ${sample.displayName} from favorites`
                    : `Add ${sample.displayName} to favorites`
            }
            className={cn(
                'size-3 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity',
                sample.favorite && 'opacity-100'
            )}
            onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
            }}
        >
            <Star
                className={cn('size-3', sample.favorite ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground')}
            />
        </button>

        {/* Find Similar (G2) */}
        <button
            type="button"
            aria-label={`Find samples similar to ${sample.displayName}`}
            className="size-3 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-accent-cyan"
            onClick={(e) => {
                e.stopPropagation();
                onFindSimilar();
            }}
            title="Find similar samples"
        >
            <SearchCode className="size-3" />
        </button>
    </Row>
);
