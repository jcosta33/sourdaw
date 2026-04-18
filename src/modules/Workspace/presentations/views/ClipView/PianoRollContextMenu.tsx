/**
 * PianoRoll context menu — right-click actions for note editing,
 * quantize, transpose, humanize, strum, AI, and groove operations.
 */
import { type ReactElement, useRef } from 'react';
import { logger } from '#/infra/logger/appLogger';
import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton, DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { type MidiNote } from '../../../models/MidiNoteViewTypes';
import { pushUndoEntry } from '#/modules/Command/useCases';
import {
    addMidiNote,
    removeMidiNote,
    moveMidiNote,
    setNoteVelocity,
    humanizeNotes,
    quantizeNotes,
    transposeNotes,
    getNotesForClip,
    strumNotes,
    restoreStrumOriginals,
    snapClipToScale,
    extractGrooveFromClip,
    applyGrooveToClip,
    restoreGrooveOriginals,
} from '#/modules/MIDI/useCases';
import { copySelectedNotes, pasteNotes } from '#/modules/Arrangement/useCases';
import { generateMidiAI, isTauri } from '#/modules/AudioEngine/useCases';
import { type PianoRollMenu } from '../../helpers/pianoRollConstants';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

const pillBtnClass = 'rounded bg-accent/50 px-1.5 py-0.5 text-[9px] hover:bg-accent';

type PianoRollContextMenuProps = {
    menu: NonNullable<PianoRollMenu>;
    clipId: string;
    notes: MidiNote[];
    selectedNoteIds: Set<string>;
    onClose: () => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
};

export const PianoRollContextMenu = ({
    menu,
    clipId,
    notes,
    selectedNoteIds,
    onClose,
    onSelectAll,
    onClearSelection,
}: PianoRollContextMenuProps): ReactElement => {
    const ref = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(ref, onClose);

    const act = (fn: () => void) => () => {
        fn();
        onClose();
    };

    const handleAIGenerate = async (): Promise<void> => {
        try {
            const clipNotes = getNotesForClip(clipId);
            const seed = clipNotes
                .slice(-8)
                .map(
                    (n) =>
                        [Math.floor(n.pitch), n.velocity, n.startBeat, n.duration] as [number, number, number, number]
                );
            const res = await generateMidiAI(seed, 16);
            if (res?.notes) {
                for (const note of res.notes) {
                    addMidiNote(clipId, note.pitch, note.start_beat, note.duration_beats, note.velocity);
                }
            }
        } catch {
            logger.warn('AI Generation requires native backend');
        }
    };

    return (
        <DawContextMenuSurface ref={ref} x={menu.x} y={menu.y} className="min-w-[170px]" role="menu">
            {/* Select/Clipboard */}
            <DawMenuButton role="menuitem" shortcut="⌘A" onClick={act(onSelectAll)}>
                Select All
            </DawMenuButton>
            <DawMenuSeparator className="border-border/50" />
            <DawMenuButton
                role="menuitem"
                shortcut="⌘C"
                disabled={selectedNoteIds.size === 0}
                onClick={act(() => copySelectedNotes(clipId, [...selectedNoteIds]))}
            >
                Copy
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                shortcut="⌘X"
                disabled={selectedNoteIds.size === 0}
                onClick={act(() => {
                    const cutNotes = notes.filter((n) => selectedNoteIds.has(n.id)).map((n) => ({ ...n }));
                    copySelectedNotes(clipId, [...selectedNoteIds]);
                    for (const id of selectedNoteIds) {
                        removeMidiNote(clipId, id);
                    }
                    if (cutNotes.length > 0) {
                        pushUndoEntry(
                            `Cut ${cutNotes.length} note${cutNotes.length > 1 ? 's' : ''}`,
                            () => {
                                for (const n of cutNotes) {
                                    addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity);
                                }
                            },
                            () => {
                                for (const n of cutNotes) {
                                    removeMidiNote(clipId, n.id);
                                }
                            }
                        );
                    }
                    onClearSelection();
                })}
            >
                Cut
            </DawMenuButton>
            <DawMenuButton role="menuitem" shortcut="⌘V" onClick={act(() => pasteNotes(clipId, menu.beat))}>
                Paste
            </DawMenuButton>

            {/* Quantize */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Quantize
            </DawMenuSectionLabel>
            <div className="flex gap-1 px-3 py-0.5">
                {([1, 0.5, 0.25, 0.125] as const).map((g) => (
                    <button
                        type="button"
                        key={g}
                        className={pillBtnClass}
                        onClick={act(() => {
                            const before = getNotesForClip(clipId).map((n) => ({ ...n }));
                            quantizeNotes(clipId, g);
                            const after = getNotesForClip(clipId).map((n) => ({ ...n }));
                            pushUndoEntry(
                                `Quantize notes (${g === 1 ? '1/1' : g === 0.5 ? '1/2' : g === 0.25 ? '1/4' : '1/8'})`,
                                () => {
                                    for (const n of before) {moveMidiNote(clipId, n.id, n.pitch, n.startBeat);}
                                },
                                () => {
                                    for (const n of after) {moveMidiNote(clipId, n.id, n.pitch, n.startBeat);}
                                }
                            );
                        })}
                    >
                        {g === 1 ? '1/1' : g === 0.5 ? '1/2' : g === 0.25 ? '1/4' : '1/8'}
                    </button>
                ))}
            </div>

            {/* Transpose */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Transpose
            </DawMenuSectionLabel>
            <div className=\"flex gap-1 px-3 py-0.5\">
                {([-12, -1, 1, 12] as const).map((semi) => (
                    <button
                        type=\"button\"
                        key={semi}
                        className={pillBtnClass}
                        onClick={act(() => {
                            transposeNotes(clipId, semi);
                            pushUndoEntry(
                                `Transpose ${semi > 0 ? '+' : ''}${semi} semitone${Math.abs(semi) !== 1 ? 's' : ''}`,
                                () => transposeNotes(clipId, -semi),
                                () => transposeNotes(clipId, semi)
                            );
                        })}
                    >
                        {semi === -12 ? '-Oct' : semi === -1 ? '-1' : semi === 1 ? '+1' : '+Oct'}
                    </button>
                ))}
            </div>

            {/* Scale */}
            <DawMenuSeparator className=\"border-border/50\" />
            <DawMenuSectionLabel className=\"text-[10px] font-normal normal-case tracking-normal\">
                Scale
            </DawMenuSectionLabel>
            <DawMenuButton
                role=\"menuitem\"
                onClick={act(() => {
                    const before = getNotesForClip(clipId).map((n) => ({ ...n }));
                    snapClipToScale(clipId);
                    const after = getNotesForClip(clipId).map((n) => ({ ...n }));
                    pushUndoEntry(
                        'Snap notes to scale',
                        () => {
                            for (const n of before) {
                                moveMidiNote(clipId, n.id, n.pitch, n.startBeat);
                            }
                        },
                        () => {
                            for (const n of after) {
                                moveMidiNote(clipId, n.id, n.pitch, n.startBeat);
                            }
                        }
                    );
                })}
            >
                Snap to Scale
            </DawMenuButton>


            {/* Humanize */}
            <DawMenuSeparator className="border-border/50" />
            {(
                [
                    { amount: 0.02, label: 'subtle' },
                    { amount: 0.05, label: 'medium' },
                ] as const
            ).map(({ amount, label }) => (
                <DawMenuButton
                    key={label}
                    role="menuitem"
                    onClick={act(() => {
                        const before = getNotesForClip(clipId).map((n) => ({
                            id: n.id,
                            startBeat: n.startBeat,
                            velocity: n.velocity,
                        }));
                        humanizeNotes(clipId, amount);
                        const after = getNotesForClip(clipId).map((n) => ({
                            id: n.id,
                            startBeat: n.startBeat,
                            velocity: n.velocity,
                        }));
                        pushUndoEntry(
                            `Humanize (${label})`,
                            () => {
                                for (const n of before) {
                                    moveMidiNote(
                                        clipId,
                                        n.id,
                                        notes.find((o) => o.id === n.id)?.pitch ?? 60,
                                        n.startBeat
                                    );
                                    setNoteVelocity(clipId, n.id, n.velocity);
                                }
                            },
                            () => {
                                for (const n of after) {
                                    moveMidiNote(
                                        clipId,
                                        n.id,
                                        notes.find((o) => o.id === n.id)?.pitch ?? 60,
                                        n.startBeat
                                    );
                                    setNoteVelocity(clipId, n.id, n.velocity);
                                }
                            }
                        );
                    })}
                >
                    Humanize ({label})
                </DawMenuButton>
            ))}

            {/* Strum */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Strum
            </DawMenuSectionLabel>
            <div className="flex gap-1 px-3 py-0.5">
                {(['up', 'down'] as const).map((dir) => (
                    <button
                        type="button"
                        key={dir}
                        className={`${pillBtnClass} disabled:opacity-40`}
                        disabled={selectedNoteIds.size < 2}
                        onClick={act(() => {
                            const ids = [...selectedNoteIds];
                            const originals = strumNotes(clipId, ids, 0.04, dir);
                            if (originals) {
                                pushUndoEntry(
                                    `Strum ${dir}`,
                                    () => restoreStrumOriginals(clipId, originals),
                                    () => strumNotes(clipId, ids, 0.04, dir)
                                );
                            }
                        })}
                    >
                        {dir === 'up' ? '↑ Up' : '↓ Down'}
                    </button>
                ))}
            </div>

            {/* AI */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuButton
                role="menuitem"
                className="font-medium text-[var(--color-accent-lavender)]"
                trailingContent={
                    <span className="rounded border border-current px-1 text-[9px] opacity-60">
                        {isTauri() ? 'Desktop' : 'Web'}
                    </span>
                }
                onClick={act(handleAIGenerate)}
            >
                AI Auto-Complete
            </DawMenuButton>

            {/* Groove */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Groove
            </DawMenuSectionLabel>
            <DawMenuButton
                role="menuitem"
                onClick={act(() => {
                    const groove = extractGrooveFromClip(clipId);
                    if (groove) {
                        (window as unknown as Record<string, unknown>).__lastGrooveTemplate = groove;
                    }
                })}
            >
                Extract Groove
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                disabled={!(window as unknown as Record<string, unknown>).__lastGrooveTemplate}
                onClick={act(() => {
                    const groove = (window as unknown as Record<string, unknown>).__lastGrooveTemplate;
                    if (groove) {
                        const originals = applyGrooveToClip(
                            clipId,
                            groove as Parameters<typeof applyGrooveToClip>[1],
                            0.5
                        );
                        if (originals) {
                            pushUndoEntry(
                                'Apply groove',
                                () => restoreGrooveOriginals(clipId, originals),
                                () => applyGrooveToClip(clipId, groove as Parameters<typeof applyGrooveToClip>[1], 0.5)
                            );
                        }
                    }
                })}
            >
                Apply Groove (50%)
            </DawMenuButton>

            {/* Delete */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuButton
                role="menuitem"
                tone="danger"
                shortcut="⌫"
                disabled={selectedNoteIds.size === 0}
                onClick={act(() => {
                    const deletedNotes = notes.filter((n) => selectedNoteIds.has(n.id)).map((n) => ({ ...n }));
                    for (const id of selectedNoteIds) {
                        removeMidiNote(clipId, id);
                    }
                    if (deletedNotes.length > 0) {
                        pushUndoEntry(
                            `Delete ${deletedNotes.length} note${deletedNotes.length > 1 ? 's' : ''}`,
                            () => {
                                for (const n of deletedNotes)
                                    {addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity);}
                            },
                            () => {
                                for (const n of deletedNotes) {removeMidiNote(clipId, n.id);}
                            }
                        );
                    }
                    onClearSelection();
                })}
            >
                Delete Selected
            </DawMenuButton>
        </DawContextMenuSurface>
    );
};
