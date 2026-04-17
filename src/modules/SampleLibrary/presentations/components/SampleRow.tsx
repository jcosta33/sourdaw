/**
 * SampleRow — single sample file entry with preview, favorite, drag-to-timeline.
 */
import { type ReactElement } from 'react';
import { File, Star, SearchCode } from 'lucide-react';
import { cn } from '#/utils/Styles/cn';
import { type SampleRecord } from '../../models/LibraryTypes';

type SampleRowProps = {
    sample: SampleRecord;
    isPlaying: boolean;
    onPlay: () => void;
    onStop: () => void;
    onToggleFavorite: () => void;
    onFindSimilar: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onClick: () => void;
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
    onPlay,
    onStop,
    onToggleFavorite,
    onFindSimilar,
    onDragStart,
    onClick,
}: SampleRowProps): ReactElement => (
    <div
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/[0.06] cursor-grab active:cursor-grabbing group"
        draggable
        onDragStart={onDragStart}
        onClick={onClick}
        title={sample.relativePath}
    >
        {/* Play button */}
        <button
            type="button"
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

        {/* Favorite */}
        <button
            type="button"
            className={cn(
                'size-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity',
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
            className="size-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-accent-cyan"
            onClick={(e) => {
                e.stopPropagation();
                onFindSimilar();
            }}
            title="Find similar samples"
        >
            <SearchCode className="size-3" />
        </button>
    </div>
);
