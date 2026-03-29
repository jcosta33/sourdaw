import { type ReactElement, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    addClip,
    addTrack,
    decodeAudioFile,
    importMidiFile,
    pasteClip,
} from '../../useCases/timelineViewActions';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { addMarker, setMarkerColor, removeMarker as removeMarkerUseCase } from '../../useCases/marker/markerOperations';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';
import { isTauri } from '#/helpers/tauriBridge';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { menuBtnClass, menuSepClass, menuShortcutClass } from '#/helpers/UI/contextMenuStyles';
import { useContextMenuDismiss } from '#/helpers/UI/useContextMenuDismiss';

// ── Marker color presets ──────────────────────────────────────────────

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

// ── Nearby marker color sub-menu ────────────────────────────────────

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
                    <div className={menuSepClass} />
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
                                aria-label="Set marker color"
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

// ── TimelineEmptyMenu ─────────────────────────────────────────────────

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

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-lg"
            style={{
                left: Math.min(x, window.innerWidth - 200),
                top: Math.min(y, window.innerHeight - 400),
            }}
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
            <div className={menuSepClass} />
            {trackId ? (
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
            ) : null}
            <button type="button" className={menuBtnClass} role="menuitem" onClick={act(() => pasteClip())}>
                Paste <span className={menuShortcutClass}>⌘V</span>
            </button>
            <div className={menuSepClass} />
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => addMarker(beat, `Marker at ${beat}`))}
            >
                Add Marker Here
            </button>
            <NearbyMarkerColorMenu beat={beat} onClose={onClose} />
            <div className={menuSepClass} />
            <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/70 flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-full bg-[var(--color-accent-lavender)]/60" />
                AI Generate
            </div>
            {isTauri() ? (
                <button
                    type="button"
                    className={menuBtnClass}
                    role="menuitem"
                    onClick={act(() => {
                        const prompt = window.prompt('Describe the audio to generate:');
                        if (prompt?.trim()) {
                            void executeAppAction({
                                type: 'generateAudio',
                                payload: { prompt: prompt.trim(), durationSeconds: 8, trackId: trackId ?? undefined },
                            });
                            notifyUser('Generating audio… this may take a moment');
                        }
                    })}
                >
                    <span className="text-[var(--color-accent-lavender)] mr-1.5">✦</span>
                    Generate Audio Here…
                </button>
            ) : (
                <div className="px-3 py-1 text-[10px] text-muted-foreground/50 italic">
                    Audio generation requires desktop app
                </div>
            )}
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => {
                    void executeAppAction({
                        type: 'generateDrumPattern',
                        payload: { style: 'rock', bars: 4, trackId: trackId ?? undefined },
                    });
                })}
            >
                <span className="text-[var(--color-accent-lavender)] mr-1.5">✦</span>
                Generate Drum Pattern
            </button>
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => {
                    void executeAppAction({
                        type: 'generateChordProgression',
                        payload: { style: 'pop', key: 0, scale: 'major', bars: 4, trackId: trackId ?? undefined },
                    });
                })}
            >
                <span className="text-[var(--color-accent-lavender)] mr-1.5">✦</span>
                Generate Chord Progression
            </button>
            <div className={menuSepClass} />
            <button type="button" className={menuBtnClass} role="menuitem" onClick={handleImportAudio}>
                Import Audio…
            </button>
            <button type="button" className={menuBtnClass} role="menuitem" onClick={handleImportMidi}>
                Import MIDI…
            </button>
        </div>,
        document.body
    );
};
