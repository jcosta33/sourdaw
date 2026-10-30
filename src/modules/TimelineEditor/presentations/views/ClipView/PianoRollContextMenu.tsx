/**
 * PianoRoll context menu — right-click actions for note editing,
 * quantize, transpose, humanize, strum, AI, and groove operations.
 */
import { type ReactElement, useRef, useState } from 'react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton, DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { logger } from '#/infra/logger/appLogger';
import { copySelectedNotes, pasteNotes } from '#/modules/Arrangement/useCases';
import { executeUserAppAction, pushUndoEntry } from '#/modules/Command/useCases';
import {
    removeMidiNote,
    moveMidiNote,
    setNoteVelocity,
    humanizeNotes,
    getNotesForClip,
    setNotesForClip,
    strumNotes,
    restoreStrumOriginals,
    snapClipToScale,
    getGrooveTemplate,
    getStraightGrooveTemplateId,
} from '#/modules/MIDI/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { generateSeed } from '#/utils/SeededRandom/SeededRandom';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { type MidiNote } from '../../../models/MidiNoteViewTypes';
import {
    copyPianoRollTakeNotes,
    cutPianoRollTakeNotes,
    deletePianoRollTakeNotes,
    duplicatePianoRollTakeNotes,
    pastePianoRollTakeNotes,
    transformPianoRollTakeNotes,
} from '../../helpers/applyPianoRollTakeMenuAction';
import { type PianoRollMenu } from '../../helpers/pianoRollConstants';
import { type PianoRollTakeNotes } from '../../helpers/projectPianoRollTakeNotes';

const pillBtnClass = 'rounded bg-accent/50 px-1.5 py-0.5 text-[9px] hover:bg-accent';

/**
 * Whole-clip note snapshot for undo closures: complete note objects — id and
 * every optional performance field — detached from the store array. Undo must
 * restore the exact prior notes, and `addMidiNote` can only rebuild a stripped
 * pitch/start/duration/velocity copy under a fresh id.
 */
const snapshotClipNotes = (clipId: string): ReturnType<typeof getNotesForClip> =>
    getNotesForClip(clipId).map((node) => ({ ...node }));

type PianoRollContextMenuProps = {
    menu: NonNullable<PianoRollMenu>;
    clipId: string;
    notes: MidiNote[];
    selectedNoteIds: Set<string>;
    onClose: () => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    takeProjection?: PianoRollTakeNotes;
};

export const PianoRollContextMenu = ({
    menu,
    clipId,
    notes,
    selectedNoteIds,
    onClose,
    onSelectAll,
    onClearSelection,
    takeProjection,
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
            await executeUserAppAction(
                { type: 'completeMidi', payload: { clipId, direction: 'forward', bars: 4 } },
                { source: 'ai' }
            );
        } catch (error) {
            logger.warn('AI MIDI completion failed', error);
        }
    };

    const handleExtractGroove = async (): Promise<void> => {
        const templateId = `groove-${clipId}-v1`;
        await executeUserAppAction({ type: 'extractGroove', payload: { clipId, templateId } });
        const extractedTemplateId = getGrooveTemplate(templateId)?.id ?? getStraightGrooveTemplateId();
        setGrooveTemplateId(extractedTemplateId);
    };

    const handleApplyGroove = async (): Promise<void> => {
        if (!grooveTemplateId) {
            return;
        }
        await executeUserAppAction({
            type: 'applyGroove',
            payload: { clipId, grooveId: grooveTemplateId, amount: 0.5 },
        });
    };

    const hasFrozenSelection = [...selectedNoteIds].some((id) => takeProjection?.ownersByViewId.has(id));
    const usesFrozenRows = Boolean(
        takeProjection &&
        (hasFrozenSelection || (selectedNoteIds.size === 0 && takeProjection.insertOwnerAtBeat(menu.beat) !== null))
    );
    const runFrozen = (work: Promise<boolean>, label: string): void => {
        void work
            .then((completed) => {
                if (!completed) {
                    logger.warn(`${label} conflicts with selected MIDI take source`);
                    notifyUser(`${label} could not be applied because the selected take changed.`, 'warning');
                }
            })
            .catch((error) => logger.warn(`Could not ${label.toLowerCase()} selected MIDI take notes`, error));
    };
    const transformFrozen = (transform: Parameters<typeof transformPianoRollTakeNotes>[3], label: string): void => {
        if (usesFrozenRows && takeProjection) {
            runFrozen(transformPianoRollTakeNotes(takeProjection, clipId, selectedNoteIds, transform, label), label);
        }
    };
    const deleteFrozenSelection = async (label: string): Promise<boolean> => {
        if (!takeProjection) {
            return false;
        }
        const deleted = await deletePianoRollTakeNotes(takeProjection, clipId, selectedNoteIds, label);
        if (!deleted) {
            return false;
        }
        onClearSelection();
        return true;
    };

    return (
        <DawContextMenuSurface onClose={onClose} ref={ref} x={menu.x} y={menu.y} className="min-w-[170px]" role="menu">
            {/* Select/Clipboard */}
            <DawMenuButton role="menuitem" shortcut="⌘A" onClick={act(onSelectAll)}>
                Select All
            </DawMenuButton>
            <DawMenuSeparator className="border-border/50" />
            <DawMenuButton
                role="menuitem"
                shortcut="⌘C"
                disabled={selectedNoteIds.size === 0}
                onClick={act(() => {
                    if (usesFrozenRows && takeProjection) {
                        copyPianoRollTakeNotes(takeProjection, selectedNoteIds);
                    } else {
                        copySelectedNotes(clipId, [...selectedNoteIds]);
                    }
                })}
            >
                Copy
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                shortcut="⌘X"
                disabled={selectedNoteIds.size === 0}
                onClick={act(() => {
                    if (usesFrozenRows && takeProjection) {
                        runFrozen(
                            cutPianoRollTakeNotes(takeProjection, clipId, selectedNoteIds).then((completed) => {
                                if (completed) {
                                    onClearSelection();
                                }
                                return completed;
                            }),
                            'Cut'
                        );
                        return;
                    }
                    const cutNotes = notes.filter((node) => selectedNoteIds.has(node.id)).map((node) => ({ ...node }));
                    const notesBefore = snapshotClipNotes(clipId);
                    copySelectedNotes(clipId, [...selectedNoteIds]);
                    for (const id of selectedNoteIds) {
                        removeMidiNote(clipId, id);
                    }
                    const notesAfter = snapshotClipNotes(clipId);
                    if (cutNotes.length > 0) {
                        pushUndoEntry(
                            `Cut ${cutNotes.length} note${cutNotes.length > 1 ? 's' : ''}`,
                            () => setNotesForClip(clipId, notesBefore),
                            () => setNotesForClip(clipId, notesAfter)
                        );
                    }
                    onClearSelection();
                })}
            >
                Cut
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                shortcut="⌘V"
                onClick={act(() => {
                    if (usesFrozenRows && takeProjection) {
                        runFrozen(pastePianoRollTakeNotes(takeProjection, clipId, menu.beat), 'Paste');
                    } else {
                        pasteNotes(clipId, menu.beat);
                    }
                })}
            >
                Paste
            </DawMenuButton>
            {usesFrozenRows && takeProjection && selectedNoteIds.size > 0 && (
                <DawMenuButton
                    role="menuitem"
                    shortcut="⌘D"
                    onClick={act(() => {
                        runFrozen(duplicatePianoRollTakeNotes(takeProjection, clipId, selectedNoteIds), 'Duplicate');
                    })}
                >
                    Duplicate
                </DawMenuButton>
            )}
            {/* Quantize */}
            <DawMenuSeparator className="border-border/50" />
            {/* gridSize is beats while labels are note values in 4/4: the
                1-beat grid is the 1/4 note, matching the clip menu (#4801). */}
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Quantize
            </DawMenuSectionLabel>
            <Row align="stretch" gap={1} className="px-3 py-0.5">
                {([1, 0.5, 0.25, 0.125] as const).map((g) => (
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        key={g}
                        className={pillBtnClass}
                        onClick={act(() => {
                            if (usesFrozenRows) {
                                transformFrozen({ kind: 'quantize', gridSize: g }, 'Quantize MIDI take notes');
                                return;
                            }
                            void executeUserAppAction({
                                type: 'quantizeNotes',
                                payload: {
                                    clipId,
                                    gridSize: g,
                                    ...(selectedNoteIds.size > 0 ? { noteIds: [...selectedNoteIds] } : {}),
                                },
                            }).catch(() => logger.warn('Could not quantize notes'));
                        })}
                    >
                        {{ 1: '1/4', 0.5: '1/8', 0.25: '1/16', 0.125: '1/32' }[g]}
                    </Button>
                ))}
            </Row>
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Quantize Length
            </DawMenuSectionLabel>
            <Row align="stretch" gap={1} className="px-3 py-0.5">
                {([1, 0.5, 0.25, 0.125] as const).map((g) => (
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        key={`len-${g}`}
                        className={pillBtnClass}
                        onClick={act(() => {
                            if (usesFrozenRows) {
                                transformFrozen({ kind: 'quantize-length', gridSize: g }, 'Quantize MIDI take lengths');
                                return;
                            }
                            void executeUserAppAction({
                                type: 'quantizeNoteLengths',
                                payload: {
                                    clipId,
                                    gridSize: g,
                                    ...(selectedNoteIds.size > 0 ? { noteIds: [...selectedNoteIds] } : {}),
                                },
                            }).catch(() => logger.warn('Could not quantize note lengths'));
                        })}
                    >
                        {{ 1: '1/4', 0.5: '1/8', 0.25: '1/16', 0.125: '1/32' }[g]}
                    </Button>
                ))}
            </Row>
            {/* Transpose */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Transpose
            </DawMenuSectionLabel>
            <Row align="stretch" gap={1} className="px-3 py-0.5">
                {([-12, -1, 1, 12] as const).map((semi) => (
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        key={semi}
                        className={pillBtnClass}
                        onClick={act(() => {
                            if (usesFrozenRows) {
                                transformFrozen({ kind: 'transpose', semitones: semi }, 'Transpose MIDI take notes');
                                return;
                            }
                            void executeUserAppAction({
                                type: 'transposeNotes',
                                payload: {
                                    clipId,
                                    semitones: semi,
                                    ...(selectedNoteIds.size > 0 ? { noteIds: [...selectedNoteIds] } : {}),
                                },
                            }).catch(() => logger.warn('Could not transpose notes'));
                        })}
                    >
                        {{ '-12': '-Oct', '-1': '-1', '1': '+1', '12': '+Oct' }[semi]}
                    </Button>
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
                    if (usesFrozenRows) {
                        transformFrozen({ kind: 'snap-scale' }, 'Snap MIDI take notes to scale');
                        return;
                    }
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
            {/* Transform */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Transform
            </DawMenuSectionLabel>
            <DawMenuButton
                role="menuitem"
                disabled={notes.length === 0}
                onClick={act(() => {
                    if (usesFrozenRows) {
                        transformFrozen({ kind: 'invert' }, 'Invert MIDI take notes');
                        return;
                    }
                    void executeUserAppAction({
                        type: 'invertNotes',
                        payload: { clipId },
                    }).catch(() => logger.warn('Could not invert notes'));
                })}
            >
                Invert Pitch
            </DawMenuButton>
            <DawMenuButton
                role="menuitem"
                disabled={notes.length === 0}
                onClick={act(() => {
                    if (usesFrozenRows) {
                        transformFrozen({ kind: 'retrograde' }, 'Reverse MIDI take notes');
                        return;
                    }
                    void executeUserAppAction({
                        type: 'retrogradeNotes',
                        payload: { clipId },
                    }).catch(() => logger.warn('Could not retrograde notes'));
                })}
            >
                Reverse (Retrograde)
            </DawMenuButton>
            {/* Velocity */}
            <DawMenuSeparator className="border-border/50" />
            <DawMenuSectionLabel className="text-[10px] font-normal normal-case tracking-normal">
                Velocity
            </DawMenuSectionLabel>
            <Row align="stretch" gap={1} className="px-3 py-0.5">
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    disabled={notes.length === 0}
                    className={pillBtnClass}
                    onClick={act(() => {
                        if (usesFrozenRows) {
                            transformFrozen({ kind: 'scale-velocity', factor: 0.8 }, 'Scale MIDI take velocities');
                            return;
                        }
                        void executeUserAppAction({
                            type: 'scaleAllVelocities',
                            payload: { clipId, factor: 0.8 },
                        }).catch(() => logger.warn('Could not scale velocities'));
                    })}
                >
                    -20%
                </Button>
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    disabled={notes.length === 0}
                    className={pillBtnClass}
                    onClick={act(() => {
                        if (usesFrozenRows) {
                            transformFrozen({ kind: 'scale-velocity', factor: 1.2 }, 'Scale MIDI take velocities');
                            return;
                        }
                        void executeUserAppAction({
                            type: 'scaleAllVelocities',
                            payload: { clipId, factor: 1.2 },
                        }).catch(() => logger.warn('Could not scale velocities'));
                    })}
                >
                    +20%
                </Button>
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    disabled={notes.length === 0}
                    className={pillBtnClass}
                    onClick={act(() => {
                        if (usesFrozenRows) {
                            transformFrozen({ kind: 'set-velocity', velocity: 100 }, 'Set MIDI take velocities');
                            return;
                        }
                        void executeUserAppAction({
                            type: 'setAllVelocities',
                            payload: { clipId, velocity: 100 },
                        }).catch(() => logger.warn('Could not set velocities'));
                    })}
                >
                    =100
                </Button>
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    disabled={notes.length === 0}
                    className={pillBtnClass}
                    onClick={act(() => {
                        if (usesFrozenRows) {
                            transformFrozen({ kind: 'set-velocity', velocity: 64 }, 'Set MIDI take velocities');
                            return;
                        }
                        void executeUserAppAction({
                            type: 'setAllVelocities',
                            payload: { clipId, velocity: 64 },
                        }).catch(() => logger.warn('Could not set velocities'));
                    })}
                >
                    =64
                </Button>
            </Row>
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
                        if (usesFrozenRows) {
                            transformFrozen(
                                { kind: 'humanize', timingAmount: amount, seed: generateSeed() },
                                `Humanize MIDI take notes (${label})`
                            );
                            return;
                        }
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
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        key={dir}
                        className={`${pillBtnClass} disabled:opacity-40`}
                        disabled={selectedNoteIds.size < 2}
                        onClick={act(() => {
                            if (usesFrozenRows) {
                                transformFrozen(
                                    { kind: 'strum', direction: dir, amount: 0.04 },
                                    `Strum MIDI take notes ${dir}`
                                );
                                return;
                            }
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
                    </Button>
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
                    if (usesFrozenRows && takeProjection) {
                        runFrozen(deleteFrozenSelection('Delete MIDI take notes'), 'Delete');
                        return;
                    }
                    const deletedNotes = notes
                        .filter((node) => selectedNoteIds.has(node.id))
                        .map((node) => ({ ...node }));
                    const notesBefore = snapshotClipNotes(clipId);
                    for (const id of selectedNoteIds) {
                        removeMidiNote(clipId, id);
                    }
                    const notesAfter = snapshotClipNotes(clipId);
                    if (deletedNotes.length > 0) {
                        pushUndoEntry(
                            `Delete ${deletedNotes.length} note${deletedNotes.length > 1 ? 's' : ''}`,
                            () => setNotesForClip(clipId, notesBefore),
                            () => setNotesForClip(clipId, notesAfter)
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
