/**
 * PianoRoll context menu — right-click actions for note editing,
 * quantize, transpose, humanize, strum, AI, and groove operations.
 */
import { type ReactElement, useRef, useState } from 'react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton, DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Row } from '#/components/layout';
import { logger } from '#/infra/logger/appLogger';
import { copySelectedNotes, pasteNotes } from '#/modules/Arrangement/useCases';
import { executeAppAction, pushUndoEntry } from '#/modules/Command/useCases';
import {
    addMidiNote,
    removeMidiNote,
    moveMidiNote,
    setNoteVelocity,
    humanizeNotes,
    getNotesForClip,
    strumNotes,
    restoreStrumOriginals,
    snapClipToScale,
    getGrooveTemplate,
    getStraightGrooveTemplateId,
} from '#/modules/MIDI/useCases';
import { generateSeed } from '#/utils/SeededRandom/SeededRandom';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { type MidiNote } from '../../../models/MidiNoteViewTypes';
import { type PianoRollMenu } from '../../helpers/pianoRollConstants';

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
    const [grooveTemplateId, setGrooveTemplateId] = useState<string | null>(null);

    const act = (fn: () => void) => () => {
        fn();
        onClose();
    };

    const handleAIGenerate = async (): Promise<void> => {
        try {
            await executeAppAction(
                { type: 'completeMidi', payload: { clipId, direction: 'forward', bars: 4 } },
                { source: 'ai' }
            );
        } catch (error) {
            logger.warn('AI MIDI completion failed', error);
        }
    };

    const handleExtractGroove = async (): Promise<void> => {
        const templateId = `groove-${clipId}-v1`;
        await executeAppAction({ type: 'extractGroove', payload: { clipId, templateId } });
        const extractedTemplateId = getGrooveTemplate(templateId)?.id ?? getStraightGrooveTemplateId();
        setGrooveTemplateId(extractedTemplateId);
    };

    const handleApplyGroove = async (): Promise<void> => {
        if (!grooveTemplateId) {
            return;
        }
        await executeAppAction({
            type: 'applyGroove',
            payload: { clipId, grooveId: grooveTemplateId, amount: 0.5 },
        });
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
                    const cutNotes = notes.filter((node) => selectedNoteIds.has(node.id)).map((node) => ({ ...node }));
                    copySelectedNotes(clipId, [...selectedNoteIds]);
                    for (const id of selectedNoteIds) {
                        removeMidiNote(clipId, id);
                    }
                    if (cutNotes.length > 0) {
                        pushUndoEntry(
                            `Cut ${cutNotes.length} note${cutNotes.length > 1 ? 's' : ''}`,
                            () => {
                                for (const node of cutNotes) {
                                    addMidiNote(clipId, node.pitch, node.startBeat, node.duration, node.velocity);
                                }
                            },
                            () => {
                                for (const node of cutNotes) {
                                    removeMidiNote(clipId, node.id);
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
            <Row align="stretch" gap={1} className="px-3 py-0.5">
                {([1, 0.5, 0.25, 0.125] as const).map((g) => (
                    <button
                        type="button"
                        key={g}
                        className={pillBtnClass}
                        onClick={act(() => {
                            void executeAppAction({
                                type: 'quantizeNotes',
                                payload: { clipId, gridSize: g },
                            }).catch(() => logger.warn('Could not quantize notes'));
                        })}
                    >
                        {{ 1: '1/1', 0.5: '1/2', 0.25: '1/4', 0.125: '1/8' }[g]}
                    </button>
                ))}
            </Row>
            {/* Transpose */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Transpose
            </DawMenuSectionLabel>
            <Row align="stretch" gap={1} className="px-3 py-0.5">
                {([-12, -1, 1, 12] as const).map((semi) => (
                    <button
                        type="button"
                        key={semi}
                        className={pillBtnClass}
                        onClick={act(() => {
                            void executeAppAction({
                                type: 'transposeNotes',
                                payload: { clipId, semitones: semi },
                            }).catch(() => logger.warn('Could not transpose notes'));
                        })}
                    >
                        {{ '-12': '-Oct', '-1': '-1', '1': '+1', '12': '+Oct' }[semi]}
                    </button>
                ))}
            </Row>
            {/* Scale */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Scale
            </DawMenuSectionLabel>
            <DawMenuButton
                role="menuitem"
                onClick={act(() => {
                    const before = getNotesForClip(clipId).map((node) => ({ ...node }));
                    snapClipToScale(clipId);
                    const after = getNotesForClip(clipId).map((node) => ({ ...node }));
                    pushUndoEntry(
                        'Snap notes to scale',
                        () => {
                            for (const node of before) {
                                moveMidiNote(clipId, node.id, node.pitch, node.startBeat);
                            }
                        },
                        () => {
                            for (const node of after) {
                                moveMidiNote(clipId, node.id, node.pitch, node.startBeat);
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
                        const before = getNotesForClip(clipId).map((node) => ({
                            id: node.id,
                            startBeat: node.startBeat,
                            velocity: node.velocity,
                        }));
                        humanizeNotes(clipId, amount);
                        const after = getNotesForClip(clipId).map((node) => ({
                            id: node.id,
                            startBeat: node.startBeat,
                            velocity: node.velocity,
                        }));
                        pushUndoEntry(
                            `Humanize (${label})`,
                            () => {
                                for (const node of before) {
                                    moveMidiNote(
                                        clipId,
                                        node.id,
                                        notes.find((output) => output.id === node.id)?.pitch ?? 60,
                                        node.startBeat
                                    );
                                    setNoteVelocity(clipId, node.id, node.velocity);
                                }
                            },
                            () => {
                                for (const node of after) {
                                    moveMidiNote(
                                        clipId,
                                        node.id,
                                        notes.find((output) => output.id === node.id)?.pitch ?? 60,
                                        node.startBeat
                                    );
                                    setNoteVelocity(clipId, node.id, node.velocity);
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
            <Row align="stretch" gap={1} className="px-3 py-0.5">
                {(['up', 'down'] as const).map((dir) => (
                    <button
                        type="button"
                        key={dir}
                        className={`${pillBtnClass} disabled:opacity-40`}
                        disabled={selectedNoteIds.size < 2}
                        onClick={act(() => {
                            const ids = [...selectedNoteIds];
                            // Redo replays the transform by re-invoking it, so
                            // the seed is captured once here and handed to both
                            // calls. Without it a randomised strum would redo
                            // onto different offsets than the ones it undid.
                            const seed = generateSeed();
                            const originals = strumNotes(clipId, ids, 0.04, dir, seed);
                            if (originals) {
                                pushUndoEntry(
                                    `Strum ${dir}`,
                                    () => restoreStrumOriginals(clipId, originals),
                                    () => strumNotes(clipId, ids, 0.04, dir, seed)
                                );
                            }
                        })}
                    >
                        {dir === 'up' ? '↑ Up' : '↓ Down'}
                    </button>
                ))}
            </Row>
            {/* AI */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuButton
                role="menuitem"
                className="font-medium text-[var(--color-accent-lavender)]"
                onClick={() => {
                    void handleAIGenerate();
                    onClose();
                }}
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
                onClick={() => {
                    void handleExtractGroove().catch(() => logger.warn('Could not extract groove'));
                }}
            >
                Extract Groove
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                disabled={!grooveTemplateId}
                onClick={() => {
                    void handleApplyGroove().catch(() => logger.warn('Could not assign groove'));
                    onClose();
                }}
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
                    const deletedNotes = notes
                        .filter((node) => selectedNoteIds.has(node.id))
                        .map((node) => ({ ...node }));
                    for (const id of selectedNoteIds) {
                        removeMidiNote(clipId, id);
                    }
                    if (deletedNotes.length > 0) {
                        pushUndoEntry(
                            `Delete ${deletedNotes.length} note${deletedNotes.length > 1 ? 's' : ''}`,
                            () => {
                                for (const node of deletedNotes) {
                                    addMidiNote(clipId, node.pitch, node.startBeat, node.duration, node.velocity);
                                }
                            },
                            () => {
                                for (const node of deletedNotes) {
                                    removeMidiNote(clipId, node.id);
                                }
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
