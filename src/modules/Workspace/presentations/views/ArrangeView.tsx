import { type ReactElement, type DragEvent, useSyncExternalStore, useState } from "react";
import { TimelineSurface } from "#/modules/Timeline/presentations/components/TimelineSurface";
import { TimelineMinimap } from "#/modules/Timeline/presentations/components/TimelineMinimap";
import { ArrangementBar } from "#/modules/Timeline/presentations/components/ArrangementBar";
import { timelineViewStore } from "#/modules/Timeline/stores/timelineViewStore";
import { TrackListView } from "#/modules/Track/presentations/views/TrackListView";
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { addTrack } from "#/modules/Track/useCases/addTrack";
import { addClip } from "#/modules/Track/useCases/clipUseCases";
import { decodeAudioFile } from "#/modules/AudioEngine/useCases/decodeAudioFile";
import { importMidiFile } from "#/modules/Track/useCases/importMidiFile";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { Button } from "#/components/ui/button";
import { Music, Piano, Plus, Upload } from "lucide-react";

export const ArrangeView = (): ReactElement => {
    const { tracks } = useTracks();

    const viewState = useSyncExternalStore(
        (cb) => timelineViewStore.subscribe(() => cb()),
        () => timelineViewStore.value,
        () => timelineViewStore.value,
    );

    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
    const scrollX = viewState?.scrollX ?? 0;

    return (
        <div className="flex h-full">
            <TrackListView />
            <div className="flex flex-1 flex-col overflow-hidden relative">
                <ArrangementBar pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} />
                <TimelineMinimap />
                <TimelineSurface />
                {tracks.length === 0 && <EmptyArrangeOverlay />}
            </div>
        </div>
    );
};

const EmptyArrangeOverlay = (): ReactElement => {
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        let currentBeat = 0;

        for (const file of files) {
            const ext = file.name.toLowerCase().split(".").pop() ?? "";
            if (["mid", "midi"].includes(ext) || file.type === "audio/midi") {
                await importMidiFile(file);
                continue;
            }

            const isAudio = file.type.startsWith("audio/") ||
                ["wav", "mp3", "ogg", "flac", "aac", "m4a", "webm", "aiff", "aif"].includes(ext);
            if (!isAudio) {
                continue;
            }

            const newTrack = addTrack({ name: file.name.replace(/\.[^.]+$/, ""), kind: "audio" });
            if (!newTrack) {
                continue;
            }

            try {
                const { id: bufferId, buffer } = await decodeAudioFile(file);
                const tempo = transportStore.value?.tempo ?? 120;
                const durationBeats = Math.max(4, Math.ceil((buffer.duration / 60) * tempo));

                addClip({
                    trackId: newTrack.id,
                    startBeat: currentBeat,
                    endBeat: currentBeat + durationBeats,
                    name: file.name.replace(/\.[^.]+$/, ""),
                    type: "audio",
                    audioBufferId: bufferId,
                });
            } catch {
                document.dispatchEvent(new CustomEvent("webdaw:notify", {
                    detail: { message: `Failed to import "${file.name}" — unsupported format or corrupt file`, level: "error" },
                }));
            }
        }
    };

    return (
        <div
            className="absolute inset-0 flex items-center justify-center bg-surface-base/80 backdrop-blur-sm z-10 pointer-events-auto"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setIsDragOver(true); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
            onDrop={handleDrop}
        >
            <div className={`flex flex-col items-center gap-4 p-8 rounded-xl bg-surface-overlay/90 border shadow-xl max-w-sm transition-colors ${isDragOver ? "border-primary border-2 bg-primary/5" : "border-border/50"}`}>
                <div className="flex items-center gap-2">
                    <Music className="size-6 text-muted-foreground" />
                    <h2 className="text-lg font-semibold text-foreground">Welcome to WebDAW</h2>
                </div>

                <p className="text-sm text-muted-foreground text-center">
                    Start by adding a track, dropping audio/MIDI files, or type a command.
                </p>

                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => addTrack({ name: "Audio 1", kind: "audio" })}
                    >
                        <Plus className="size-3.5 mr-1" />
                        Audio Track
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => addTrack({ name: "MIDI 1", kind: "midi" })}
                    >
                        <Piano className="size-3.5 mr-1" />
                        MIDI Track
                    </Button>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground/80 mt-1">
                    <Upload className="size-3.5" />
                    <span>Drop audio or MIDI files here to get started</span>
                </div>

                <div className="text-[10px] text-muted-foreground/60 space-y-0.5 text-center">
                    <p>Space to play/pause · R to record · L to loop</p>
                    <p>⌘K for command palette · Hold V for voice</p>
                </div>
            </div>
        </div>
    );
};
