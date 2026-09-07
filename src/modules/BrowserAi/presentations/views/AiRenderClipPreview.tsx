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
import { trackStore } from '#/modules/Arrangement/stores';
import { isAudioBufferReferencedByUndoHistory } from '#/modules/Arrangement/useCases';
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

// A buffer a dropped clip references is owned by that clip, and the dragend
// dropEffect that settles the handoff count is not a reliable acceptance
// signal on every engine: WebKit can report 'none' after a target accepted
// the drop. The live track state is the authority — read at cleanup time, so
// a clip the user deleted since the drop stops protecting its buffer.
function clipReferencesBuffer(bufferId: string): boolean {
    const state = trackStore.value;
    if (!state) {
        return false;
    }
    return (
        state.tracks.some(
            (track) =>
                track.clips.some((clip) => clip.audioBufferId === bufferId) ||
                track.alternatives.some((alternative) =>
                    alternative.clips.some((clip) => clip.audioBufferId === bufferId)
                )
        ) ||
        (state.ghostClips?.some((clip) => clip.audioBufferId === bufferId) ?? false)
    );
}

// Release only what nothing else owns: a handoff still settling (the count), a
// placed clip still referencing the buffer — the clip gate is what makes the
// release engine-proof, because the dragend dropEffect is not a trustworthy
// cancellation signal everywhere (WebKit, #3766) — or an undo entry that could
// still restore such a clip: undoing a clip removal re-appends its snapshot
// with the same buffer id, so a release here would resurrect the clip
// permanently silent.
function releaseBufferIfUnowned(bufferId: string, handoffCount: number): void {
    if (handoffCount === 0 && !clipReferencesBuffer(bufferId) && !isAudioBufferReferencedByUndoHistory(bufferId)) {
        releasePreviewAudioBuffer(bufferId);
    }
}

export const AiRenderClipPreview = ({ audio, sampleRate, label, name }: AiRenderClipPreviewProps): ReactElement => {
    const [playState, setPlayState] = useState<PreviewPlayState>({
        isPlaying: false,
        audio,
        sampleRate,
    });
    const playbackRef = useRef<PreviewPlayback | null>(null);
    const bufferIdRef = useRef<string | null>(null);
    // Every successful timeline drop places a clip pointing at this row's cached
    // buffer (see useTimelineFileDrop — each drop reuses the same buffer id), so
    // the row must not evict it on unmount while any such clip exists.
    // Successful handoffs are counted, not flagged: a canceled later gesture must
    // never invalidate the ownership an earlier successful drop established,
    // which is how a placed clip used to lose its audio (#3766).
    const handedOffCountRef = useRef(0);

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
    // A buffer any successful drop placed on the timeline is owned by the resulting
    // clip(s) and is deliberately left in place; only never-dropped buffers are
    // reclaimed here.
    useEffect(() => {
        const evictPriorBuffer = (): void => {
            const activePlayback = playbackRef.current;
            playbackRef.current = null;
            activePlayback?.stop();

            const bufferId = bufferIdRef.current;
            if (bufferId) {
                releaseBufferIfUnowned(bufferId, handedOffCountRef.current);
            }
            bufferIdRef.current = null;
            handedOffCountRef.current = 0;
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
        // The dropped clip will reference this same cached buffer; count the
        // optimistic handoff so the unmount cleanup does not evict it out from
        // under the clip. handleDragEnd settles the count.
        handedOffCountRef.current += 1;
        event.dataTransfer.setData(
            'application/x-sourdaw-ai-render',
            JSON.stringify({ name, bufferId, durationSeconds: durationSec })
        );
        event.dataTransfer.effectAllowed = 'copy';
    };

    const handleDragEnd = (event: DragEvent<HTMLDivElement>): void => {
        // A drag released off any drop target reports dropEffect 'none' — nothing
        // took ownership of the buffer, so settle the optimistic handoff count set
        // in handleDragStart. Otherwise a started-but-cancelled drag would leak
        // the cached buffer. Only the count this gesture added is given back, so a
        // canceled repeat drag can never revoke an earlier successful drop.
        if (event.dataTransfer.dropEffect === 'none') {
            handedOffCountRef.current = Math.max(0, handedOffCountRef.current - 1);
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
