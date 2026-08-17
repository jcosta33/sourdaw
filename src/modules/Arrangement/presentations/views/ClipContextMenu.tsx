import { type ReactElement, useRef, useState } from 'react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuInlineEditor } from '#/components/daw/DawMenuInlineEditor';
import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawSwatchButton } from '#/components/daw/DawSwatchButton';
import { useStore } from '#/infra/store/useStore';
import { handleAiDenoiseClip } from '#/modules/AiGeneration/useCases';
import { runAiActionWithToast } from '#/modules/AiRuntime/useCases';
import { detectTempo, detectKey, describeDetectedKey } from '#/modules/AudioAnalysis/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { setWorkspaceMode } from '#/modules/WorkspaceShell/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { CLIP_COLOR_OPTIONS } from '../../models/ColorPalette';
import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { trackStore, defaultTrackState } from '../../stores/trackStore';
import { duplicateClip } from '../../useCases/clip/duplicateClip';
import { duplicateClipToNextBar } from '../../useCases/clip/duplicateClipToNextBar';
import { removeClip } from '../../useCases/clip/removeClip';
import { copySelectedClip } from '../../useCases/clipboard/copySelectedClip';
import { cutSelectedClip } from '../../useCases/clipboard/cutSelectedClip';
import { pasteClip } from '../../useCases/clipboard/pasteClip';
import { lockClip } from '../../useCases/clipEditing/lockClip';
import { muteClip } from '../../useCases/clipEditing/muteClip';
import { normalizeClip } from '../../useCases/clipEditing/normalizeClip';
import { renameClip } from '../../useCases/clipEditing/renameClip';
import { reverseClip } from '../../useCases/clipEditing/reverseClip';
import { setClipColor } from '../../useCases/clipEditing/setClipColor';
import { splitClipWithUndo } from '../../useCases/clipEditing/splitClipWithUndo';
import { toggleInlineEditing } from '../../useCases/clipEditing/toggleInlineEditing';
import { selectClip } from '../../useCases/clipSelection/selectClip';
import { exportMidiClip } from '../../useCases/exportMidiClip';
import { stripSilence } from '../../useCases/stripSilence';

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

    const trackState = useStore(trackStore, defaultTrackState);
    const clipSelection = useStore(clipSelectionStore, defaultClipSelectionState);

    const clip = trackState.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    const [isRenaming, setIsRenaming] = useState(false);
    const [newName, setNewName] = useState(clip?.name ?? '');
    const isMidi = clip?.type === 'midi';
    const isAudio = clip?.type === 'audio';
    const isLocked = clip?.locked ?? false;
    const isMuted = clip?.muted ?? false;
    const selectedIds = clipSelection.selectedClipIds ?? [];
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

    const renderAudioActions = (): ReactElement => (
        <>
            <DawMenuButton role="menuitem" onClick={act(() => normalizeClip(clipId))}>
                Normalize
            </DawMenuButton>
            <DawMenuButton role="menuitem" onClick={act(() => reverseClip(clipId))}>
                Reverse
            </DawMenuButton>
            <DawMenuButton role="menuitem" onClick={act(() => stripSilence(clipId))}>
                Strip Silence
            </DawMenuButton>
            <DawMenuButton
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
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                onClick={act(() => {
                    if (clip?.audioBufferId) {
                        notifyUser(describeDetectedKey(detectKey(clip.audioBufferId)));
                    }
                })}
            >
                Detect Key
            </DawMenuButton>
            <DawMenuSeparator className="border-border/50" />
            <DawMenuMutedRow className="flex items-center gap-1 font-medium text-muted-foreground/70">
                <span className="inline-block size-2.5 rounded-full bg-[var(--color-accent-cyan)]/60" />
                AI
            </DawMenuMutedRow>
            <DawMenuButton
                role="menuitem"
                leadingContent={<span className="text-[var(--color-accent-cyan)]">✦</span>}
                onClick={act(() => {
                    void runAiActionWithToast(() => executeAppAction({ type: 'audioToMidi', payload: { clipId } }), {
                        startMsg: 'Converting audio to MIDI…',
                        successMsg: 'Audio converted to MIDI',
                        successDetails: ['New MIDI clip created from detected onsets'],
                        failMsg: 'Audio-to-MIDI conversion failed',
                    });
                })}
            >
                Convert to MIDI
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                leadingContent={<span className="text-[var(--color-accent-cyan)]">✦</span>}
                onClick={act(() => {
                    // handleAiDenoiseClip keys the cache on a bufferId (source
                    // lookup + `${id}-denoised` write); the Inspector A/B reads
                    // `${clip.audioBufferId}-denoised` — pass the audioBufferId,
                    // not the clip id, and gate like Detect Tempo/Key above.
                    if (!clip?.audioBufferId) {
                        return;
                    }
                    const audioBufferId = clip.audioBufferId;
                    void runAiActionWithToast(() => handleAiDenoiseClip(audioBufferId, 0.7), {
                        startMsg: 'Denoising audio…',
                        successMsg: 'Audio denoised',
                        successDetails: ['Noise reduction applied to clip'],
                        failMsg: 'Audio denoise failed',
                    });
                })}
            >
                Denoise
            </DawMenuButton>
        </>
    );

    const renderMidiActions = (): ReactElement => (
        <>
            <DawMenuButton role="menuitem" onClick={act(() => toggleInlineEditing(clipId))}>
                {clip?.isInlineEditing ? 'Close Inline Editor' : 'Open Inline Editor'}
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                onClick={act(() => {
                    void executeAppAction({ type: 'arpeggiate', payload: { clipId } });
                })}
            >
                Arpeggiate
            </DawMenuButton>
            <DawMenuButton role="menuitem" onClick={act(() => exportMidiClip(clipId))}>
                Export as MIDI…
            </DawMenuButton>
            <DawMenuSeparator className="border-border/50" />
            <DawMenuMutedRow className="flex items-center gap-1 font-medium text-muted-foreground/70">
                <span className="inline-block size-2.5 rounded-full bg-[var(--color-accent-cyan)]/60" />
                AI
            </DawMenuMutedRow>
            <DawMenuButton
                role="menuitem"
                leadingContent={<span className="text-[var(--color-accent-cyan)]">✦</span>}
                onClick={act(() => {
                    void runAiActionWithToast(
                        () => executeAppAction({ type: 'completeMidi', payload: { clipId, bars: 4 } }),
                        {
                            startMsg: 'Generating MIDI continuation…',
                            successMsg: 'MIDI continuation generated',
                            successDetails: ['Added 4 bars of new MIDI content'],
                            failMsg: 'MIDI continuation failed',
                        }
                    );
                })}
            >
                Continue MIDI…
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                leadingContent={<span className="text-[var(--color-accent-cyan)]">✦</span>}
                onClick={act(() => {
                    void runAiActionWithToast(
                        () => executeAppAction({ type: 'variationMidi', payload: { clipId, amount: 0.3 } }),
                        {
                            startMsg: 'Creating MIDI variation…',
                            successMsg: 'MIDI variation created',
                            successDetails: ['Variation applied with 30% divergence'],
                            failMsg: 'MIDI variation failed',
                        }
                    );
                })}
            >
                Generate Variation
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                leadingContent={<span className="text-[var(--color-accent-cyan)]">✦</span>}
                onClick={act(() => {
                    void runAiActionWithToast(
                        () => executeAppAction({ type: 'variationMidi', payload: { clipId, amount: 0.6 } }),
                        {
                            startMsg: 'Regenerating with wilder divergence…',
                            successMsg: 'MIDI re-imagined',
                            successDetails: ['Variation applied with 60% divergence'],
                            failMsg: 'MIDI regeneration failed',
                        }
                    );
                })}
            >
                Regenerate (different style)
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                leadingContent={<span className="text-[var(--color-accent-cyan)]">✦</span>}
                onClick={act(() => {
                    void runAiActionWithToast(
                        () => executeAppAction({ type: 'generateBassline', payload: { clipId, style: 'root-fifth' } }),
                        {
                            startMsg: 'Generating bassline that follows this clip…',
                            successMsg: 'Bassline generated',
                            successDetails: ['New MIDI track with a bassline following this clip'],
                            failMsg: 'Bassline generation failed',
                        }
                    );
                })}
            >
                Generate Bassline from Clip
            </DawMenuButton>
        </>
    );

    return (
        <DawContextMenuSurface
            ref={menuRef}
            x={x}
            y={y}
            xClampOffset={200}
            yClampOffset={400}
            className="max-h-[80vh] min-w-[180px] overflow-y-auto"
            role="menu"
        >
            {multiSelected ? <DawMenuMutedRow>{selectedIds.length} clips selected</DawMenuMutedRow> : null}

            {isRenaming ? (
                <DawMenuInlineEditor
                    label="Rename Clip"
                    value={newName}
                    onChange={setNewName}
                    onSubmit={() => {
                        const trimmed = newName.trim();
                        if (trimmed) {
                            renameClip(clipId, trimmed);
                        }
                        onClose();
                    }}
                    onCancel={() => setIsRenaming(false)}
                />
            ) : (
                <>
                    <DawMenuButton
                        role="menuitem"
                        onClick={act(() => {
                            selectClip(clipId);
                            setWorkspaceMode('clip');
                        })}
                    >
                        Edit Clip
                    </DawMenuButton>

                    <DawMenuButton
                        role="menuitem"
                        onClick={(event) => {
                            event.stopPropagation();
                            setIsRenaming(true);
                            setNewName(clip?.name ?? '');
                        }}
                    >
                        Rename Clip
                    </DawMenuButton>

                    <DawMenuButton role="menuitem" onClick={act(() => splitClipWithUndo(clipId, splitBeat))}>
                        Split at Cursor
                    </DawMenuButton>
                    <DawMenuButton role="menuitem" shortcut="⌘D" onClick={act(duplicateSelected)}>
                        Duplicate{multiSelected ? ` (${selectedIds.length})` : ''}
                    </DawMenuButton>
                    {!multiSelected ? (
                        <DawMenuButton
                            role="menuitem"
                            shortcut="⌥D"
                            onClick={act(() => duplicateClipToNextBar(clipId))}
                        >
                            Duplicate to Next Bar
                        </DawMenuButton>
                    ) : null}

                    <DawMenuSeparator className="border-border/50" />

                    <DawMenuButton
                        role="menuitem"
                        shortcut="⌘C"
                        onClick={act(() => {
                            selectClip(clipId);
                            copySelectedClip();
                        })}
                    >
                        Copy
                    </DawMenuButton>
                    <DawMenuButton
                        role="menuitem"
                        shortcut="⌘X"
                        onClick={act(() => {
                            selectClip(clipId);
                            cutSelectedClip();
                        })}
                    >
                        Cut
                    </DawMenuButton>
                    <DawMenuButton role="menuitem" shortcut="⌘V" onClick={act(() => pasteClip())}>
                        Paste
                    </DawMenuButton>

                    <DawMenuSeparator className="border-border/50" />

                    {isAudio ? renderAudioActions() : null}
                    {isMidi ? renderMidiActions() : null}

                    <DawMenuButton role="menuitem" onClick={act(() => muteClip(clipId, !isMuted))}>
                        {isMuted ? 'Unmute Clip' : 'Mute Clip'}
                    </DawMenuButton>
                    <DawMenuButton role="menuitem" onClick={act(() => lockClip(clipId, !isLocked))}>
                        {isLocked ? 'Unlock Clip' : 'Lock Clip'}
                    </DawMenuButton>

                    <DawMenuSeparator className="border-border/50" />

                    <DawMenuMutedRow>Color</DawMenuMutedRow>
                    <div className="flex gap-1 px-3 py-1">
                        {CLIP_COLOR_OPTIONS.map((color) => (
                            <DawSwatchButton
                                key={color || 'default'}
                                color={color || 'var(--color-muted)'}
                                active={clip?.color === color}
                                onClick={act(() => setClipColor(clipId, color))}
                                aria-label={color || 'Default color'}
                            />
                        ))}
                    </div>

                    <DawMenuSeparator className="border-border/50" />

                    <DawMenuButton role="menuitem" tone="danger" shortcut="⌫" onClick={act(deleteSelected)}>
                        Delete{multiSelected ? ` (${selectedIds.length})` : ''}
                    </DawMenuButton>
                </>
            )}
        </DawContextMenuSurface>
    );
};
