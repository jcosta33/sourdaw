import { type ReactElement, useRef } from 'react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawSwatchButton } from '#/components/daw/DawSwatchButton';
import { Row } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { MARKER_COLOR_PRESETS } from '../../models/ColorPalette';
import { defaultMarkerStoreState, markerStore } from '../../stores/markerStore';
import { trackStore } from '../../stores/trackStore';
import { addTrack } from '../../useCases/addTrack';
import { addClip } from '../../useCases/clip/addClip';
import { pasteClip } from '../../useCases/clipboard/pasteClip';
import { importMidiFile } from '../../useCases/importMidiFile';
import { addMarker } from '../../useCases/marker/markerOperations/addMarker';
import { removeMarker as removeMarkerUseCase } from '../../useCases/marker/markerOperations/removeMarker';
import { setMarkerColor } from '../../useCases/marker/markerOperations/setMarkerColor';

// ── Nearby marker color sub-menu ────────────────────────────────────

type NearbyMarkerColorMenuProps = {
    beat: number;
    onClose: () => void;
};

const NearbyMarkerColorMenu = ({ beat, onClose }: NearbyMarkerColorMenuProps): ReactElement | null => {
    // §211.1 — useStore subscription so the menu re-renders when markers
    // change (rename, add, remove) while the menu is open.
    const markerState = useStore(markerStore, defaultMarkerStoreState);
    const nearby = markerState.markers.filter((message) => Math.abs(message.beat - beat) <= 2);
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
                    <DawMenuSeparator className="border-border/50" />
                    <DawMenuMutedRow>Marker: {marker.name}</DawMenuMutedRow>
                    <Row align="stretch" gap={1} className="px-3 py-1">
                        {MARKER_COLOR_PRESETS.map((context) => (
                            <DawSwatchButton
                                key={context}
                                color={context}
                                active={context === marker.color}
                                className="size-4"
                                onClick={act(() => setMarkerColor(marker.id, context))}
                                aria-label="Set marker color"
                            />
                        ))}
                    </Row>
                    <DawMenuButton tone="danger" role="menuitem" onClick={act(() => removeMarkerUseCase(marker.id))}>
                        Remove Marker
                    </DawMenuButton>
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

    return (
        <DawContextMenuSurface
            ref={menuRef}
            x={x}
            y={y}
            xClampOffset={200}
            yClampOffset={400}
            className="min-w-[180px]"
            role="menu"
        >
            <DawMenuButton role="menuitem" onClick={act(() => addTrack({ name: 'Audio', kind: 'audio' }))}>
                Add Audio Track
            </DawMenuButton>
            <DawMenuButton role="menuitem" onClick={act(() => addTrack({ name: 'MIDI', kind: 'midi' }))}>
                Add MIDI Track
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                onClick={act(() => {
                    void executeAppAction({ type: 'createBus', payload: { name: 'Bus' } });
                })}
            >
                Add Bus Track
            </DawMenuButton>
            <DawMenuSeparator className="border-border/50" />
            {trackId ? (
                <DawMenuButton
                    role="menuitem"
                    onClick={act(() => {
                        const track = trackStore.value?.tracks.find((time) => time.id === trackId);
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
                </DawMenuButton>
            ) : null}
            <DawMenuButton role="menuitem" shortcut="⌘V" onClick={act(() => pasteClip())}>
                Paste
            </DawMenuButton>
            <DawMenuSeparator className="border-border/50" />
            <DawMenuButton role="menuitem" onClick={act(() => addMarker(beat, `Marker at ${beat}`))}>
                Add Marker Here
            </DawMenuButton>
            <NearbyMarkerColorMenu beat={beat} onClose={onClose} />
            <DawMenuSeparator className="border-border/50" />
            <DawMenuMutedRow className="flex items-center gap-1 font-medium text-muted-foreground/70">
                <span className="inline-block size-2.5 rounded-full bg-[var(--color-accent-lavender)]/60" />
                AI Generate
            </DawMenuMutedRow>
            <DawMenuButton
                role="menuitem"
                onClick={act(() => {
                    void executeAppAction({
                        type: 'generateDrumPattern',
                        payload: { style: 'rock', bars: 4, trackId: trackId ?? undefined, startBeat: beat },
                    });
                })}
            >
                <span className="text-[var(--color-accent-lavender)] mr-1.5">✦</span>
                Generate Drum Pattern
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                onClick={act(() => {
                    void executeAppAction({
                        type: 'generateChordProgression',
                        payload: {
                            style: 'pop',
                            key: 0,
                            scale: 'major',
                            bars: 4,
                            trackId: trackId ?? undefined,
                            startBeat: beat,
                        },
                    });
                })}
            >
                <span className="text-[var(--color-accent-lavender)] mr-1.5">✦</span>
                Generate Chord Progression
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                onClick={act(() => {
                    void executeAppAction({
                        type: 'generateMelody',
                        payload: {
                            style: 'simple',
                            key: 0,
                            scale: 'major',
                            bars: 4,
                            trackId: trackId ?? undefined,
                            startBeat: beat,
                        },
                    });
                })}
            >
                <span className="text-[var(--color-accent-lavender)] mr-1.5">✦</span>
                Generate Melody
            </DawMenuButton>
            <DawMenuSeparator className="border-border/50" />
            <DawMenuButton role="menuitem" onClick={handleImportAudio}>
                Import Audio…
            </DawMenuButton>
            <DawMenuButton role="menuitem" onClick={handleImportMidi}>
                Import MIDI…
            </DawMenuButton>
        </DawContextMenuSurface>
    );
};
