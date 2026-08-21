/**
 * Inline preview row for an AI-rendered audio clip.
 *
 * Shows: play/stop button, label, duration.
 * Draggable: the entire row can be dragged onto an audio track in the
 * arrangement. On drag start the Float32Array is cached by AudioEngine and
 * the bufferId is set as drag data.
 */

import { type DragEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { GripVertical, Play, Square } from 'lucide-react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import {
    cachePreviewAudioBuffer,
    playCachedAudioBufferPreview,
    releasePreviewAudioBuffer,
} from '#/modules/AudioEngine/useCases';

type AiRenderClipPreviewProps = {
    audio: Float32Array;
    sampleRate: number;
    label: string;
    name: string;
};

type PreviewPlayback = NonNullable<ReturnType<typeof playCachedAudioBufferPreview>>;

type PreviewPlayState = {
    isPlaying: boolean;
    audio: Float32Array;
    sampleRate: number;
};

export const AiRenderClipPreview = ({ audio, sampleRate, label, name }: AiRenderClipPreviewProps): ReactElement => {
    const [playState, setPlayState] = useState<PreviewPlayState>({
        isPlaying: false,
        audio,
        sampleRate,
    });
    const playbackRef = useRef<PreviewPlayback | null>(null);
    const bufferIdRef = useRef<string | null>(null);
    // Set once this row's buffer has been dragged onto a track: the dropped clip
    // now points at the same cache entry (see useTimelineFileDrop), so this row
    // must not evict it on unmount or it would silence the placed clip.
    const handedOffRef = useRef(false);

    const durationSec = audio.length / sampleRate;
    const isPlaying = playState.isPlaying && playState.audio === audio && playState.sampleRate === sampleRate;

    const ensureBufferId = (): string => {
        if (!bufferIdRef.current) {
            bufferIdRef.current = cachePreviewAudioBuffer({ audio, sampleRate });
        }
        return bufferIdRef.current;
    };

    // Release this row's cached preview buffer when the component unmounts or
    // when the audio it represents changes.
    // Without this, every previewed render leaks an entry into a cache shared
    // across the app, growing unbounded for the lifetime of the session.
    // The buffer is derived from (audio, sampleRate), so a change to either makes
    // the previously cached buffer stale and reachable only through the dropped ref.
    // A buffer that was dragged onto a track is owned by the resulting clip and is
    // deliberately left in place.
    useEffect(() => {
        const evictPriorBuffer = (): void => {
            const activePlayback = playbackRef.current;
            playbackRef.current = null;
            activePlayback?.stop();

            if (bufferIdRef.current && !handedOffRef.current) {
                releasePreviewAudioBuffer(bufferIdRef.current);
            }
            bufferIdRef.current = null;
            handedOffRef.current = false;
        };
        return evictPriorBuffer;
    }, [audio, sampleRate]);

    const handlePlay = (): void => {
        if (isPlaying) {
            playbackRef.current?.stop();
            playbackRef.current = null;
            setPlayState({ isPlaying: false, audio, sampleRate });
            return;
        }

        const bufferId = ensureBufferId();
        let startedPlayback: PreviewPlayback | null = null;
        startedPlayback = playCachedAudioBufferPreview({
            bufferId,
            onEnded: () => {
                // Guard: only clear state if this playback is still the active one.
                // Prevents a stopped playback's onended from clobbering a new playback.
                if (playbackRef.current === startedPlayback) {
                    playbackRef.current = null;
                    setPlayState({ isPlaying: false, audio, sampleRate });
                }
            },
        });

        if (!startedPlayback) {
            return;
        }

        playbackRef.current = startedPlayback;
        setPlayState({ isPlaying: true, audio, sampleRate });
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

    const handleDragEnd = (event: DragEvent<HTMLDivElement>): void => {
        // A drag released off any drop target reports dropEffect 'none' — nothing
        // took ownership of the buffer, so undo the optimistic handoff mark set in
        // handleDragStart. Otherwise a started-but-cancelled drag would suppress
        // unmount eviction and leak the cached buffer. On a real drop the dropEffect
        // is the accepted effect (e.g. 'copy'), so the handoff mark stands.
        if (event.dataTransfer.dropEffect === 'none') {
            handedOffRef.current = false;
        }
    };

    return (
        <Row
            gap={1.5}
            className="px-1.5 py-1 rounded bg-surface-overlay/50 border border-border/20 cursor-grab active:cursor-grabbing"
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <Button
                variant="bare"
                size="bare"
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
            </Button>
            <span className="text-[9px] font-medium text-foreground/80 min-w-[14px]">{label}</span>
            <span className="text-[9px] text-muted-foreground/60 flex-1 truncate">{name}</span>
            <span className="text-[9px] text-muted-foreground/40 tabular-nums">{durationSec.toFixed(1)}s</span>
            <GripVertical className="size-3 text-muted-foreground/30 shrink-0" aria-hidden="true" />
        </Row>
    );
};
