import { type ReactElement, type MouseEvent as ReactMouseEvent, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { pushUndoEntry } from '../../../useCases/workspaceViewActions';
import { setNoteProbability } from '../../../useCases/workspaceViewActions';
import { NOTE_NAMES } from './laneConstants';

type ProbabilityLaneProps = {
    clipId: string | null;
    selectedNoteIds: Set<string>;
};

export const ProbabilityLane = ({ clipId, selectedNoteIds }: ProbabilityLaneProps): ReactElement => {
    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    if (notes.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No notes — add MIDI notes to edit probability</p>
            </div>
        );
    }

    const handleProbabilityDrag = (noteId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = e.currentTarget.parentElement;
        if (!container) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const origProbability = notes.find((n) => n.id === noteId)?.probability ?? 100;

        const onMove = (me: MouseEvent) => {
            const y = me.clientY - rect.top;
            const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
            const prob = Math.round(ratio * 100);
            setNoteProbability(clipId, noteId, prob);
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const finalNote = (midiStore.value?.notesByClipId[clipId] ?? []).find((n) => n.id === noteId);
            const finalProb = finalNote?.probability ?? origProbability;
            if (finalProb !== origProbability) {
                pushUndoEntry(
                    'Change note probability',
                    () => setNoteProbability(clipId, noteId, origProbability),
                    () => setNoteProbability(clipId, noteId, finalProb)
                );
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div className="flex h-full items-end gap-px px-1 pb-1 relative" role="group" aria-label="Probability lane">
            {notes.map((note) => {
                const isSelected = selectedNoteIds.has(note.id);
                const prob = note.probability ?? 100;
                return (
                    <div
                        key={note.id}
                        className={cn(
                            'w-3 rounded-t cursor-ns-resize transition-colors',
                            isSelected
                                ? 'bg-amber-400/80 hover:bg-amber-400'
                                : 'bg-emerald-400/30 hover:bg-emerald-400/50'
                        )}
                        style={{
                            height: `${prob}%`,
                            marginLeft: `${note.startBeat * 3}px`,
                        }}
                        title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}: ${prob}%`}
                        onMouseDown={(e) => handleProbabilityDrag(note.id, e)}
                    />
                );
            })}
        </div>
    );
};
