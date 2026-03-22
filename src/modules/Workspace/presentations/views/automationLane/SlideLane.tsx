import { type ReactElement, type MouseEvent as ReactMouseEvent, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { pushUndoEntry } from '../../../useCases/workspaceViewActions';
import { setNoteSlide } from '../../../useCases/workspaceViewActions';
import { NOTE_NAMES } from './laneConstants';

type SlideLaneProps = {
    clipId: string | null;
    selectedNoteIds: Set<string>;
};

export const SlideLane = ({ clipId, selectedNoteIds }: SlideLaneProps): ReactElement => {
    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    if (notes.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No notes — add MIDI notes to edit slide</p>
            </div>
        );
    }

    const handleSlideDrag = (noteId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = e.currentTarget.parentElement;
        if (!container) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const origSlide = notes.find((n) => n.id === noteId)?.slide ?? 0;

        const onMove = (me: MouseEvent) => {
            const y = me.clientY - rect.top;
            const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
            const slide = Math.round(ratio * 127);
            setNoteSlide(clipId, noteId, slide);
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const finalNote = (midiStore.value?.notesByClipId[clipId] ?? []).find((n) => n.id === noteId);
            const finalSlide = finalNote?.slide ?? origSlide;
            if (finalSlide !== origSlide) {
                pushUndoEntry(
                    'Change slide',
                    () => setNoteSlide(clipId, noteId, origSlide),
                    () => setNoteSlide(clipId, noteId, finalSlide)
                );
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div className="flex h-full items-end gap-px px-1 pb-1 relative" role="group" aria-label="Slide lane">
            {notes.map((note) => {
                const slide = note.slide ?? 0;
                const isSelected = selectedNoteIds.has(note.id);
                return (
                    <div
                        key={note.id}
                        className={cn(
                            'w-3 rounded-t cursor-ns-resize transition-colors',
                            isSelected ? 'bg-[var(--color-accent-mint)]/80 hover:bg-[var(--color-accent-mint)]' : 'bg-[var(--color-accent-mint)]/30 hover:bg-[var(--color-accent-mint)]/50'
                        )}
                        style={{
                            height: `${(slide / 127) * 100}%`,
                            minHeight: slide > 0 ? '2px' : undefined,
                            marginLeft: `${note.startBeat * 3}px`,
                        }}
                        title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}: slide ${slide}`}
                        onMouseDown={(e) => handleSlideDrag(note.id, e)}
                    />
                );
            })}
        </div>
    );
};
