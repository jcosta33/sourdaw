import { type ReactElement, type RefObject, useRef, useEffect } from 'react';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import {
    setWorkspaceMode,
    splitClip,
    normalizeClip,
    reverseClip,
    lockClip,
    setClipColor,
    renameClip,
    muteClip,
    addClip,
    removeClip,
    duplicateClip,
    duplicateClipToNextBar,
    copySelectedClip,
    cutSelectedClip,
    pasteClip,
    detectTempo,
    detectKey,
    stripSilence,
    exportMidiClip,
    decodeAudioFile,
    importMidiFile,
    addTrack,
    pushUndoEntry,
    executeAppAction,
} from '../../useCases/timelineViewActions';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { notifyAiChange } from '#/modules/AiRuntime/presentations/views/AiChangeToast';
import { addMarker, setMarkerColor, removeMarker as removeMarkerUseCase } from '../../useCases/markerUseCases';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';

const menuBtnClass = 'flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent text-left';
const menuSep = 'my-1 border-t border-border/50';
const menuShortcut = 'ml-auto pl-4 text-muted-foreground';

const useContextMenuDismiss = (ref: RefObject<HTMLDivElement | null>, onClose: () => void) => {
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [ref, onClose]);
};

type ClipContextMenuProps = {
    x: number;
    y: number;
    clipId: string;
    splitBeat: number;
    onClose: () => void;
};

export const ClipContextMenu = ({ x, y, clipId, splitBeat, onClose }: ClipContextMenuProps): ReactElement => {
    const menuRef = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(menuRef, onClose);

    const clip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    const isMidi = clip?.type === 'midi';
    const isAudio = clip?.type === 'audio';
    const isLocked = clip?.locked ?? false;
    const isMuted = clip?.muted ?? false;
    const selectedIds = workspaceStore.value?.selectedClipIds ?? [];
    const multiSelected = selectedIds.length > 1 && selectedIds.includes(clipId);

    const act = (fn: () => void) => () => {
        fn();
        onClose();
    };

    const deleteSelected = () => {
        if (multiSelected) {
            for (const id of selectedIds) {
                removeClip(id);
            }
        } else {
            removeClip(clipId);
        }
    };

    const duplicateSelected = () => {
        if (multiSelected) {
            for (const id of selectedIds) {
                duplicateClip(id);
            }
        } else {
            duplicateClip(clipId);
        }
    };

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[180px] max-h-[80vh] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
            style={{ left: x, top: y }}
            role="menu"
        >
            {multiSelected && (
                <div className="px-3 py-1 text-[10px] text-muted-foreground">{selectedIds.length} clips selected</div>
            )}
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => {
                    const ws = workspaceStore.value;
                    if (ws) {
                        workspaceStore.set({ ...ws, selectedClipId: clipId });
                    }
                    setWorkspaceMode('clip');
                })}
            >
                Edit Clip
            </button>
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={() => {
                    const currentClip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
                    const newName = window.prompt('Rename clip:', currentClip?.name ?? '');
                    if (newName !== null && newName.trim()) {
                        renameClip(clipId, newName.trim());
                    }
                    onClose();
                }}
            >
                Rename Clip
            </button>
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => {
                    const origClip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
                    if (origClip) {
                        const savedClip = { ...origClip };
                        splitClip(clipId, splitBeat);
                        const afterState = trackStore.value;
                        const newClipIds =
                            afterState?.tracks
                                .flatMap((t) => t.clips)
                                .filter(
                                    (c) =>
                                        c.id !== clipId &&
                                        c.startBeat >= savedClip.startBeat &&
                                        c.endBeat <= savedClip.endBeat
                                )
                                .map((c) => c.id) ?? [];
                        pushUndoEntry(
                            'Split clip',
                            () => {
                                for (const id of newClipIds) {
                                    removeClip(id);
                                }
                                addClip({
                                    trackId: savedClip.trackId,
                                    startBeat: savedClip.startBeat,
                                    endBeat: savedClip.endBeat,
                                    name: savedClip.name,
                                    type: savedClip.type,
                                    audioBufferId: savedClip.audioBufferId,
                                });
                            },
                            () => splitClip(clipId, splitBeat)
                        );
                    }
                })}
            >
                Split at Cursor
            </button>
            <button type="button" className={menuBtnClass} role="menuitem" onClick={act(duplicateSelected)}>
                Duplicate{multiSelected ? ` (${selectedIds.length})` : ''} <span className={menuShortcut}>⌘D</span>
            </button>
            {!multiSelected && (
                <button
                    type="button"
                    className={menuBtnClass}
                    role="menuitem"
                    onClick={act(() => duplicateClipToNextBar(clipId))}
                >
                    Duplicate to Next Bar <span className={menuShortcut}>⌥D</span>
                </button>
            )}
            <div className={menuSep} />
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => {
                    const ws = workspaceStore.value;
                    if (ws) {
                        workspaceStore.set({ ...ws, selectedClipId: clipId });
                    }
                    copySelectedClip();
                })}
            >
                Copy <span className={menuShortcut}>⌘C</span>
            </button>
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => {
                    const ws = workspaceStore.value;
                    if (ws) {
                        workspaceStore.set({ ...ws, selectedClipId: clipId });
                    }
                    cutSelectedClip();
                })}
            >
                Cut <span className={menuShortcut}>⌘X</span>
            </button>
            <button type="button" className={menuBtnClass} role="menuitem" onClick={act(() => pasteClip())}>
                Paste <span className={menuShortcut}>⌘V</span>
            </button>
            <div className={menuSep} />
            {isAudio && (
                <>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => normalizeClip(clipId))}
                    >
                        Normalize
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => reverseClip(clipId))}
                    >
                        Reverse
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => stripSilence(clipId))}
                    >
                        Strip Silence
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => {
                            if (clip?.audioBufferId) {
                                const bpm = detectTempo(clip.audioBufferId);
                                if (bpm) {
                                    notifyUser(`Detected tempo: ${bpm} BPM`);
                                } else {
                                    notifyUser('Could not detect tempo');
                                }
                            }
                        })}
                    >
                        Detect Tempo
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => {
                            if (clip?.audioBufferId) {
                                const result = detectKey(clip.audioBufferId);
                                if (result) {
                                    const conf = Math.round(result.confidence * 100);
                                    notifyUser(`Detected key: ${result.key} ${result.mode} (${conf}% confidence)`);
                                } else {
                                    notifyUser('Could not detect key');
                                }
                            }
                        })}
                    >
                        Detect Key
                    </button>
                    <div className={menuSep} />
                    <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/70 flex items-center gap-1">
                        <span className="inline-block size-2.5 rounded-full bg-[var(--color-accent-cyan)]/60" />
                        AI
                    </div>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(async () => {
                            notifyUser('Separating stems… this may take a moment');
                            try {
                                await executeAppAction({ type: 'stemSeparate', payload: { clipId } });
                                notifyAiChange('Stem separation complete', [
                                    'Created separate tracks for each stem',
                                ]);
                            } catch {
                                notifyUser('Stem separation failed', 'error');
                            }
                        })}
                    >
                        <span className="text-[var(--color-accent-cyan)] mr-1.5">✦</span>
                        Separate Stems
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(async () => {
                            notifyUser('Converting audio to MIDI…');
                            try {
                                await executeAppAction({ type: 'audioToMidi', payload: { clipId } });
                                notifyAiChange('Audio converted to MIDI', [
                                    'New MIDI clip created from detected onsets',
                                ]);
                            } catch {
                                notifyUser('Audio-to-MIDI conversion failed', 'error');
                            }
                        })}
                    >
                        <span className="text-[var(--color-accent-cyan)] mr-1.5">✦</span>
                        Convert to MIDI
                    </button>
                </>
            )}
            {isMidi && (
                <>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => executeAppAction({ type: 'arpeggiate', payload: { clipId } }))}
                    >
                        Arpeggiate
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => exportMidiClip(clipId))}
                    >
                        Export as MIDI…
                    </button>
                    <div className={menuSep} />
                    <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/70 flex items-center gap-1">
                        <span className="inline-block size-2.5 rounded-full bg-[var(--color-accent-cyan)]/60" />
                        AI
                    </div>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(async () => {
                            notifyUser('Generating MIDI continuation…');
                            try {
                                await executeAppAction({
                                    type: 'completeMidi',
                                    payload: { clipId, bars: 4 },
                                });
                                notifyAiChange('MIDI continuation generated', [
                                    'Added 4 bars of new MIDI content',
                                ]);
                            } catch {
                                notifyUser('MIDI continuation failed', 'error');
                            }
                        })}
                    >
                        <span className="text-[var(--color-accent-cyan)] mr-1.5">✦</span>
                        Continue MIDI…
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(async () => {
                            notifyUser('Creating MIDI variation…');
                            try {
                                await executeAppAction({
                                    type: 'variationMidi',
                                    payload: { clipId, amount: 0.3 },
                                });
                                notifyAiChange('MIDI variation created', [
                                    'Variation applied with 30% divergence',
                                ]);
                            } catch {
                                notifyUser('MIDI variation failed', 'error');
                            }
                        })}
                    >
                        <span className="text-[var(--color-accent-cyan)] mr-1.5">✦</span>
                        Create Variation
                    </button>
                </>
            )}
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => muteClip(clipId, !isMuted))}
            >
                {isMuted ? 'Unmute Clip' : 'Mute Clip'}
            </button>
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => lockClip(clipId, !isLocked))}
            >
                {isLocked ? 'Unlock Clip' : 'Lock Clip'}
            </button>
            <div className={menuSep} />
            <div className="px-3 py-1 text-[10px] text-muted-foreground">Color</div>
            <div className="flex gap-1 px-3 py-1">
                {[
                    '',
                    'oklch(0.40 0.08 250)',
                    'oklch(0.38 0.09 20)',
                    'oklch(0.40 0.08 150)',
                    'oklch(0.40 0.08 70)',
                    'oklch(0.38 0.08 300)',
                    'oklch(0.38 0.08 340)',
                    'oklch(0.40 0.07 200)',
                    'oklch(0.39 0.08 45)',
                ].map(
                    (c) => (
                        <button
                            type="button"
                            key={c || 'default'}
                            className="size-4 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                            style={{ backgroundColor: c || 'var(--color-muted)' }}
                            onClick={act(() => setClipColor(clipId, c))}
                            aria-label={c || 'Default color'}
                        />
                    )
                )}
            </div>
            <div className={menuSep} />
            <button
                type="button"
                className={`${menuBtnClass} text-destructive hover:bg-destructive/10`}
                role="menuitem"
                onClick={act(deleteSelected)}
            >
                Delete{multiSelected ? ` (${selectedIds.length})` : ''} <span className={menuShortcut}>⌫</span>
            </button>
        </div>
    );
};

type TimelineEmptyMenuProps = {
    x: number;
    y: number;
    trackId: string | null;
    beat: number;
    onClose: () => void;
};

export const TimelineEmptyMenu = ({ x, y, trackId, beat, onClose }: TimelineEmptyMenuProps): ReactElement => {
    const menuRef = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(menuRef, onClose);

    const act = (fn: () => void) => () => {
        fn();
        onClose();
    };

    const handleImportAudio = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.aac,.m4a,.aiff';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                return;
            }
            try {
                const result = await decodeAudioFile(file);
                const targetTrackId =
                    trackId ??
                    (() => {
                        addTrack({ name: file.name.replace(/\.[^.]+$/, ''), kind: 'audio' });
                        return trackStore.value?.tracks[trackStore.value.tracks.length - 1]?.id ?? '';
                    })();
                const durationBeats = Math.ceil((result.buffer.duration / 60) * (transportStore.value?.tempo ?? 120));
                addClip({
                    trackId: targetTrackId,
                    startBeat: beat,
                    endBeat: beat + durationBeats,
                    name: file.name.replace(/\.[^.]+$/, ''),
                    audioBufferId: result.id,
                });
            } catch {
                notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
            }
        };
        input.click();
        onClose();
    };

    const handleImportMidi = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.mid,.midi';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (file) {
                await importMidiFile(file);
            }
        };
        input.click();
        onClose();
    };

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-lg"
            style={{ left: x, top: y }}
            role="menu"
        >
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => addTrack({ name: 'Audio', kind: 'audio' }))}
            >
                Add Audio Track
            </button>
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => addTrack({ name: 'MIDI', kind: 'midi' }))}
            >
                Add MIDI Track
            </button>
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => addTrack({ name: 'Bus', kind: 'bus' }))}
            >
                Add Bus Track
            </button>
            <div className={menuSep} />
            {trackId && (
                <button
                    type="button"
                    className={menuBtnClass}
                    role="menuitem"
                    onClick={act(() => {
                        const track = trackStore.value?.tracks.find((t) => t.id === trackId);
                        const clipType = track?.kind === 'midi' ? 'midi' : 'audio';
                        addClip({
                            trackId,
                            startBeat: beat,
                            endBeat: beat + 4,
                            name: `New ${clipType} clip`,
                            type: clipType,
                        });
                    })}
                >
                    Add Clip Here
                </button>
            )}
            <button type="button" className={menuBtnClass} role="menuitem" onClick={act(() => pasteClip())}>
                Paste <span className={menuShortcut}>⌘V</span>
            </button>
            <div className={menuSep} />
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => addMarker(beat, `Marker at ${beat}`))}
            >
                Add Marker Here
            </button>
            <NearbyMarkerColorMenu beat={beat} onClose={onClose} />
            <div className={menuSep} />
            <button type="button" className={menuBtnClass} role="menuitem" onClick={handleImportAudio}>
                Import Audio…
            </button>
            <button type="button" className={menuBtnClass} role="menuitem" onClick={handleImportMidi}>
                Import MIDI…
            </button>
        </div>
    );
};

const MARKER_COLOR_PRESETS = [
    'oklch(0.40 0.07 200)',
    'oklch(0.40 0.08 150)',
    'oklch(0.40 0.08 70)',
    'oklch(0.38 0.08 340)',
    'oklch(0.38 0.08 270)',
    'oklch(0.38 0.09 20)',
    'oklch(0.40 0.08 250)',
    'oklch(0.39 0.08 45)',
    'oklch(0.38 0.08 300)',
];

type NearbyMarkerColorMenuProps = {
    beat: number;
    onClose: () => void;
};

const NearbyMarkerColorMenu = ({ beat, onClose }: NearbyMarkerColorMenuProps): ReactElement | null => {
    const markers = markerStore.value?.markers ?? [];
    const nearby = markers.filter((m) => Math.abs(m.beat - beat) <= 2);
    if (nearby.length === 0) {
        return null;
    }

    const act = (fn: () => void) => () => {
        fn();
        onClose();
    };

    return (
        <>
            {nearby.map((marker) => (
                <div key={marker.id}>
                    <div className={menuSep} />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Marker: {marker.name}</div>
                    <div className="flex gap-1 px-3 py-1">
                        {MARKER_COLOR_PRESETS.map((c) => (
                            <button
                                type="button"
                                key={c}
                                className="size-4 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                                style={{
                                    backgroundColor: c,
                                    outline: c === marker.color ? '2px solid white' : 'none',
                                    outlineOffset: '1px',
                                }}
                                onClick={act(() => setMarkerColor(marker.id, c))}
                                aria-label={`Set marker color`}
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        className={`${menuBtnClass} text-destructive hover:bg-destructive/10`}
                        role="menuitem"
                        onClick={act(() => removeMarkerUseCase(marker.id))}
                    >
                        Remove Marker
                    </button>
                </div>
            ))}
        </>
    );
};
