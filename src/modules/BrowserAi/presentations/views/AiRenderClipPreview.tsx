/**
 * Inline preview row for an AI-rendered audio clip.
 *
 * Shows: play/stop button, label, duration.
 * Draggable: the entire row can be dragged onto an audio track in the
 * arrangement. On drag start the Float32Array is converted to an AudioBuffer,
 * cached in audioBufferCache, and the bufferId is set as drag data.
 */

import { type DragEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { GripVertical, Play, Square } from 'lucide-react';

import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioContext, createBufferSource } from '#/modules/AudioEngine/useCases';

type AiRenderClipPreviewProps = {
    audio: Float32Array;
    sampleRate: number;
    label: string;
    name: string;
};

/**
 * Convert a mono Float32Array to an AudioBuffer and cache it.
 * Returns the bufferId used in the cache.
 */
function cacheAudioBuffer(audio: Float32Array, sampleRate: number): string {
    const id = `ai-render-${crypto.randomUUID()}`;
    const ctx = getAudioContext();
    const buffer = ctx.createBuffer(1, audio.length, sampleRate);
    buffer.getChannelData(0).set(audio);
    audioBufferCache.set(id, buffer);
    return id;
}

export const AiRenderClipPreview = ({ audio, sampleRate, label, name }: AiRenderClipPreviewProps): ReactElement => {
    const [isPlaying, setIsPlaying] = useState(false);
    const sourceRef = useRef<AudioBufferSourceNode | null>(null);
    const bufferIdRef = useRef<string | null>(null);
    // Set once this row's buffer has been dragged onto a track: the dropped clip
    // now points at the same cache entry (see useTimelineFileDrop), so this row
    // must not evict it on unmount or it would silence the placed clip.
    const handedOffRef = useRef(false);

    const durationSec = audio.length / sampleRate;

    const ensureBufferId = (): string => {
        if (!bufferIdRef.current) {
            bufferIdRef.current = cacheAudioBuffer(audio, sampleRate);
        }
        return bufferIdRef.current;
    };

    // Evict this row's cached AudioBuffer from the cross-module audioBufferCache
    // when the component unmounts or when the audio it represents changes.
    // Without this, every previewed render leaks an entry into a cache shared
    // across the app, growing unbounded for the lifetime of the session.
    // The buffer is derived from (audio, sampleRate), so a change to either makes
    // the previously cached buffer stale and reachable only through the dropped ref.
    // A buffer that was dragged onto a track is owned by the resulting clip and is
    // deliberately left in place.
    useEffect(() => {
        const evictPriorBuffer = (): void => {
            if (bufferIdRef.current && !handedOffRef.current) {
                audioBufferCache.remove(bufferIdRef.current);
            }
            bufferIdRef.current = null;
            handedOffRef.current = false;
        };
        return evictPriorBuffer;
    }, [audio, sampleRate]);

    const handlePlay = (): void => {
        if (isPlaying) {
            sourceRef.current?.stop();
            sourceRef.current = null;
            setIsPlaying(false);
            return;
        }

        ensureBufferId();
        const buffer = audioBufferCache.get(bufferIdRef.current!);
        if (!buffer) {
            return;
        }

        const source = createBufferSource();
        source.buffer = buffer;
        source.connect(getAudioContext().destination);
        source.onended = () => {
            // Guard: only clear state if this source is still the active one.
            // Prevents a stopped source's onended from clobbering a new playback.
            if (sourceRef.current === source) {
                setIsPlaying(false);
                sourceRef.current = null;
            }
        };
        source.start();
        sourceRef.current = source;
        setIsPlaying(true);
    };

    const handleDragStart = (event: DragEvent<HTMLDivElement>): void => {
        const bufferId = ensureBufferId();
        // The dropped clip will reference this same cached buffer; mark it handed
        // off so the unmount cleanup does not evict it out from under the clip.
        handedOffRef.current = true;
        event.dataTransfer.setData(
            'application/x-sourdaw-ai-render',
            JSON.stringify({ name, bufferId, durationSeconds: durationSec })
        );
        event.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <div
            className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-surface-overlay/50 border border-border/20 cursor-grab active:cursor-grabbing"
            draggable
            onDragStart={handleDragStart}
        >
            <button
                type="button"
                onClick={handlePlay}
                className="shrink-0 size-5 flex items-center justify-center rounded hover:bg-border/30 transition-colors"
                aria-label={isPlaying ? `Stop ${label}` : `Play ${label}`}
            >
                {isPlaying ? (
                    <Square className="size-2.5 text-[var(--color-accent-peach)]" />
                ) : (
                    <Play className="size-2.5 text-muted-foreground" />
                )}
            </button>
            <span className="text-[9px] font-medium text-foreground/80 min-w-[14px]">{label}</span>
            <span className="text-[9px] text-muted-foreground/60 flex-1 truncate">{name}</span>
            <span className="text-[9px] text-muted-foreground/40 tabular-nums">{durationSec.toFixed(1)}s</span>
            <GripVertical className="size-3 text-muted-foreground/30 shrink-0" aria-hidden="true" />
        </div>
    );
};
