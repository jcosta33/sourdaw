import { type ReactElement, useRef, useState } from 'react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawMenuInlineEditor } from '#/components/daw/DawMenuInlineEditor';
import { DawSwatchButton } from '#/components/daw/DawSwatchButton';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { selectClip } from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import {
    setWorkspaceMode,
    splitClipWithUndo,
    normalizeClip,
    reverseClip,
    lockClip,
    setClipColor,
    renameClip,
    muteClip,
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
    executeAppAction,
} from '../../useCases/timelineViewActions';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { runAiActionWithToast } from '#/modules/AiRuntime/useCases/runAiActionWithToast';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { useContextMenuDismiss } from '#/helpers/UI/useContextMenuDismiss';

type ClipContextMenuProps = {
    x: number;
    y: number;
    clipId: string;
    splitBeat: number;
    onClose: () => void;
};

const CLIP_COLOR_OPTIONS = [
    '',
    'oklch(0.40 0.08 250)',
    'oklch(0.38 0.09 20)',
    'oklch(0.40 0.08 150)',
    'oklch(0.40 0.08 70)',
    'oklch(0.38 0.08 300)',
    'oklch(0.38 0.08 340)',
    'oklch(0.40 0.07 200)',
    'oklch(0.39 0.08 45)',
] as const;

export const ClipContextMenu = ({ x, y, clipId, splitBeat, onClose }: ClipContextMenuProps): ReactElement => {
    const menuRef = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(menuRef, onClose);

    const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    const [isRenaming, setIsRenaming] = useState(false);
    const [newName, setNewName] = useState(clip?.name ?? '');
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
                        const result = detectKey(clip.audioBufferId);
                        if (result) {
                            const confidence = Math.round(result.confidence * 100);
                            notifyUser(`Detected key: ${result.key} ${result.mode} (${confidence}% confidence)`);
                        } else {
                            notifyUser('Could not detect key');
                        }
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
                onClick={act(() =>
                    runAiActionWithToast(() => executeAppAction({ type: 'stemSeparate', payload: { clipId } }), {
                        startMsg: 'Separating stems… this may take a moment',
                        successMsg: 'Stem separation complete',
                        successDetails: ['Created separate tracks for each stem'],
                        failMsg: 'Stem separation failed',
                    })
                )}
            >
                Separate Stems
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                leadingContent={<span className="text-[var(--color-accent-cyan)]">✦</span>}
                onClick={act(() =>
                    runAiActionWithToast(() => executeAppAction({ type: 'audioToMidi', payload: { clipId } }), {
                        startMsg: 'Converting audio to MIDI…',
                        successMsg: 'Audio converted to MIDI',
                        successDetails: ['New MIDI clip created from detected onsets'],
                        failMsg: 'Audio-to-MIDI conversion failed',
                    })
                )}
            >
                Convert to MIDI
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                leadingContent={<span className="text-[var(--color-accent-cyan)]">✦</span>}
                onClick={act(() =>
                    runAiActionWithToast(
                        async () => {
                            const { handleAiDenoiseClip } =
                                await import('#/modules/AiGeneration/useCases/actions/handleAiDenoiseClip');
                            await handleAiDenoiseClip(clipId, 0.7);
                        },
                        {
                            startMsg: 'Denoising audio…',
                            successMsg: 'Audio denoised',
                            successDetails: ['Noise reduction applied to clip'],
                            failMsg: 'Audio denoise failed',
                        }
                    )
                )}
            >
                Denoise
            </DawMenuButton>
        </>
    );

    const renderMidiActions = (): ReactElement => (
        <>
            <DawMenuButton
                role="menuitem"
                onClick={act(() => executeAppAction({ type: 'arpeggiate', payload: { clipId } }))}
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
                onClick={act(() =>
                    runAiActionWithToast(
                        () => executeAppAction({ type: 'completeMidi', payload: { clipId, bars: 4 } }),
                        {
                            startMsg: 'Generating MIDI continuation…',
                            successMsg: 'MIDI continuation generated',
                            successDetails: ['Added 4 bars of new MIDI content'],
                            failMsg: 'MIDI continuation failed',
                        }
                    )
                )}
            >
                Continue MIDI…
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                leadingContent={<span className="text-[var(--color-accent-cyan)]">✦</span>}
                onClick={act(() =>
                    runAiActionWithToast(
                        () => executeAppAction({ type: 'variationMidi', payload: { clipId, amount: 0.3 } }),
                        {
                            startMsg: 'Creating MIDI variation…',
                            successMsg: 'MIDI variation created',
                            successDetails: ['Variation applied with 30% divergence'],
                            failMsg: 'MIDI variation failed',
                        }
                    )
                )}
            >
                Create Variation
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
