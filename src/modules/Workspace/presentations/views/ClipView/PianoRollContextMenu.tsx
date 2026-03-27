/**
 * PianoRoll context menu — right-click actions for note editing,
 * quantize, transpose, humanize, strum, AI, and groove operations.
 */
import { type ReactElement, useEffect, useRef } from 'react';
import { type MidiNote } from '#/modules/MIDI/useCases/midi';
import { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';
import { addMidiNote } from '#/modules/MIDI/useCases/midiNoteCrud/addMidiNote';
import { removeMidiNote } from '#/modules/MIDI/useCases/midiNoteCrud/removeMidiNote';
import { moveMidiNote } from '#/modules/MIDI/useCases/midiNoteCrud/moveMidiNote';
import { setNoteVelocity } from '#/modules/MIDI/useCases/midiNoteCrud/setNoteVelocity';
import { humanizeNotes } from '#/modules/MIDI/useCases/midiNoteTransforms/humanizeNotes';
import { quantizeNotes } from '#/modules/MIDI/useCases/midiNoteTransforms/quantizeNotes';
import { transposeNotes } from '#/modules/MIDI/useCases/midiNoteTransforms/transposeNotes';
import { getNotesForClip } from '#/modules/MIDI/useCases/midiNoteCrud/getNotesForClip';
import { copySelectedNotes } from '#/modules/Arrangement/useCases/clipboard/copySelectedNotes';
import { pasteNotes } from '#/modules/Arrangement/useCases/clipboard/pasteNotes';
import { strumNotes, restoreStrumOriginals } from '#/modules/MIDI/useCases/strumNotes';
import {
    extractGrooveFromClip,
    applyGrooveToClip,
    restoreGrooveOriginals,
} from '#/modules/MIDI/useCases/grooveExtraction';
import { generateMidiAI, isTauri } from '#/modules/AudioEngine/useCases/nativeAiBridge';
import { type PianoRollMenu } from '../../helpers/pianoRollConstants';

const menuItemClass = 'flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent';
const pillBtnClass = 'rounded bg-accent/50 px-1.5 py-0.5 text-[9px] hover:bg-accent';
const dividerClass = 'my-1 border-t border-border/50';
const sectionLabelClass = 'px-3 py-1 text-[10px] text-muted-foreground';

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

    useEffect(() => {
        const dismiss = (e: globalThis.MouseEvent): void => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const esc = (e: globalThis.KeyboardEvent): void => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('mousedown', dismiss);
        document.addEventListener('keydown', esc);
        return () => {
            document.removeEventListener('mousedown', dismiss);
            document.removeEventListener('keydown', esc);
        };
    }, [onClose]);

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
            console.error('AI Generation requires native backend');
        }
    };

    return (
        <div
            ref={ref}
            className="fixed z-50 min-w-[170px] rounded-md border border-border bg-popover py-1 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
        >
            {/* Select/Clipboard */}
            <button type="button" className={menuItemClass} role="menuitem" onClick={act(onSelectAll)}>
                Select All <span className="ml-auto pl-4 text-muted-foreground">⌘A</span>
            </button>
            <div className={dividerClass} />
            <button
                type="button"
                className={menuItemClass}
                role="menuitem"
                disabled={selectedNoteIds.size === 0}
                onClick={act(() => copySelectedNotes(clipId, [...selectedNoteIds]))}
            >
                Copy <span className="ml-auto pl-4 text-muted-foreground">⌘C</span>
            </button>
            <button
                type="button"
                className={menuItemClass}
                role="menuitem"
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
                Cut <span className="ml-auto pl-4 text-muted-foreground">⌘X</span>
            </button>
            <button
                type="button"
                className={menuItemClass}
                role="menuitem"
                onClick={act(() => pasteNotes(clipId, menu.beat))}
            >
                Paste <span className="ml-auto pl-4 text-muted-foreground">⌘V</span>
            </button>

            {/* Quantize */}
            <div className={dividerClass} />
            <div className={sectionLabelClass}>Quantize</div>
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
                                    for (const n of before) moveMidiNote(clipId, n.id, n.pitch, n.startBeat);
                                },
                                () => {
                                    for (const n of after) moveMidiNote(clipId, n.id, n.pitch, n.startBeat);
                                }
                            );
                        })}
                    >
                        {g === 1 ? '1/1' : g === 0.5 ? '1/2' : g === 0.25 ? '1/4' : '1/8'}
                    </button>
                ))}
            </div>

            {/* Transpose */}
            <div className={dividerClass} />
            <div className={sectionLabelClass}>Transpose</div>
            <div className="flex gap-1 px-3 py-0.5">
                {([-12, -1, 1, 12] as const).map((semi) => (
                    <button
                        type="button"
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

            {/* Humanize */}
            <div className={dividerClass} />
            {([
                { amount: 0.02, label: 'subtle' },
                { amount: 0.05, label: 'medium' },
            ] as const).map(({ amount, label }) => (
                <button
                    type="button"
                    key={label}
                    className={menuItemClass}
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
                                    moveMidiNote(clipId, n.id, notes.find((o) => o.id === n.id)?.pitch ?? 60, n.startBeat);
                                    setNoteVelocity(clipId, n.id, n.velocity);
                                }
                            },
                            () => {
                                for (const n of after) {
                                    moveMidiNote(clipId, n.id, notes.find((o) => o.id === n.id)?.pitch ?? 60, n.startBeat);
                                    setNoteVelocity(clipId, n.id, n.velocity);
                                }
                            }
                        );
                    })}
                >
                    Humanize ({label})
                </button>
            ))}

            {/* Strum */}
            <div className={dividerClass} />
            <div className={sectionLabelClass}>Strum</div>
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
            <div className={dividerClass} />
            <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-[var(--color-accent-lavender)] font-medium hover:bg-accent"
                role="menuitem"
                onClick={act(handleAIGenerate)}
            >
                <span>AI Auto-Complete</span>
                <span className="text-[9px] opacity-60 border border-current rounded px-1 ml-2">
                    {isTauri() ? 'Desktop' : 'Web'}
                </span>
            </button>

            {/* Groove */}
            <div className={dividerClass} />
            <div className={sectionLabelClass}>Groove</div>
            <button
                type="button"
                className={menuItemClass}
                role="menuitem"
                onClick={act(() => {
                    const groove = extractGrooveFromClip(clipId);
                    if (groove) {
                        (window as unknown as Record<string, unknown>).__lastGrooveTemplate = groove;
                    }
                })}
            >
                Extract Groove
            </button>
            <button
                type="button"
                className={`${menuItemClass} disabled:opacity-40`}
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
                                () =>
                                    applyGrooveToClip(
                                        clipId,
                                        groove as Parameters<typeof applyGrooveToClip>[1],
                                        0.5
                                    )
                            );
                        }
                    }
                })}
            >
                Apply Groove (50%)
            </button>

            {/* Delete */}
            <div className={dividerClass} />
            <button
                type="button"
                className="flex w-full items-center px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                role="menuitem"
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
                                for (const n of deletedNotes) addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity);
                            },
                            () => {
                                for (const n of deletedNotes) removeMidiNote(clipId, n.id);
                            }
                        );
                    }
                    onClearSelection();
                })}
            >
                Delete Selected <span className="ml-auto pl-4 text-muted-foreground">⌫</span>
            </button>
        </div>
    );
};
