import { type ReactElement, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawMenuMutedRow } from '#/components/daw/DawMenuParts';
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
import { notifyAiChange } from '#/modules/AiRuntime/useCases/notifyAiChange';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { menuBtnClass, menuSepClass, menuShortcutClass } from '#/helpers/UI/contextMenuStyles';
import { useContextMenuDismiss } from '#/helpers/UI/useContextMenuDismiss';

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

    return createPortal(
        <div
            ref={menuRef}
            className="daw-floating-surface fixed z-50 max-h-[80vh] min-w-[180px] overflow-y-auto rounded-md py-1"
            style={{
                left: Math.min(x, window.innerWidth - 200),
                top: Math.min(y, window.innerHeight - 400),
            }}
            role="menu"
        >
            {multiSelected ? <DawMenuMutedRow>{selectedIds.length} clips selected</DawMenuMutedRow> : null}
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => {
                    selectClip(clipId);
                    setWorkspaceMode('clip');
                })}
            >
                Edit Clip
            </button>
            {isRenaming ? (
                <div className="px-2 py-1.5 flex flex-col gap-1 border-y border-border/40 my-0.5 bg-surface-raised">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Rename Clip</div>
                    <DawCompactInput
                        type="text"
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const trimmed = newName.trim();
                                if (trimmed) renameClip(clipId, trimmed);
                                onClose();
                            } else if (e.key === 'Escape') {
                                setIsRenaming(false);
                            }
                        }}
                        size="micro"
                        className="w-full text-[10px]"
                    />
                </div>
            ) : (
                <button
                    type="button"
                    className={menuBtnClass}
                    role="menuitem"
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsRenaming(true);
                        setNewName(clip?.name ?? '');
                    }}
                >
                    Rename Clip
                </button>
            )}
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => splitClipWithUndo(clipId, splitBeat))}
            >
                Split at Cursor
            </button>
            <button type="button" className={menuBtnClass} role="menuitem" onClick={act(duplicateSelected)}>
                Duplicate{multiSelected ? ` (${selectedIds.length})` : ''} <span className={menuShortcutClass}>⌘D</span>
            </button>
            {!multiSelected ? (
                <button
                    type="button"
                    className={menuBtnClass}
                    role="menuitem"
                    onClick={act(() => duplicateClipToNextBar(clipId))}
                >
                    Duplicate to Next Bar <span className={menuShortcutClass}>⌥D</span>
                </button>
            ) : null}
            <div className={menuSepClass} />
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => {
                    selectClip(clipId);
                    copySelectedClip();
                })}
            >
                Copy <span className={menuShortcutClass}>⌘C</span>
            </button>
            <button
                type="button"
                className={menuBtnClass}
                role="menuitem"
                onClick={act(() => {
                    selectClip(clipId);
                    cutSelectedClip();
                })}
            >
                Cut <span className={menuShortcutClass}>⌘X</span>
            </button>
            <button type="button" className={menuBtnClass} role="menuitem" onClick={act(() => pasteClip())}>
                Paste <span className={menuShortcutClass}>⌘V</span>
            </button>
            <div className={menuSepClass} />
            {isAudio ? (
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
                    <div className={menuSepClass} />
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
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(async () => {
                            notifyUser('Denoising audio…');
                            const { handleAiDenoiseClip } = await import('#/modules/AiGeneration/useCases/actions/handleAiDenoiseClip');
                            await handleAiDenoiseClip(clipId, 0.7);
                            notifyAiChange('Audio denoised', ['Noise reduction applied to clip']);
                        })}
                    >
                        <span className="text-[var(--color-accent-cyan)] mr-1.5">✦</span>
                        Denoise
                    </button>
                </>
            ) : null}
            {isMidi ? (
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
                    <div className={menuSepClass} />
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
            ) : null}
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
            <div className={menuSepClass} />
            <DawMenuMutedRow>Color</DawMenuMutedRow>
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
                ].map((c) => (
                    <button
                        type="button"
                        key={c || 'default'}
                        className="size-4 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                        style={{ backgroundColor: c || 'var(--color-muted)' }}
                        onClick={act(() => setClipColor(clipId, c))}
                        aria-label={c || 'Default color'}
                    />
                ))}
            </div>
            <div className={menuSepClass} />
            <button
                type="button"
                className={`${menuBtnClass} text-destructive hover:bg-destructive/10`}
                role="menuitem"
                onClick={act(deleteSelected)}
            >
                Delete{multiSelected ? ` (${selectedIds.length})` : ''} <span className={menuShortcutClass}>⌫</span>
            </button>
        </div>,
        document.body
    );
};
