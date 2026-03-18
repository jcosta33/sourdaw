import { type ReactElement, type MouseEvent as ReactMouseEvent, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { pushUndoEntry } from '../../../useCases/workspaceViewActions';
import { setNoteVelocity } from '../../../useCases/workspaceViewActions';
import { NOTE_NAMES } from './laneConstants';

type VelocityLaneProps = {
    clipId: string | null;
    selectedNoteIds: Set<string>;
};

export const VelocityLane = ({ clipId, selectedNoteIds }: VelocityLaneProps): ReactElement => {
    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    if (notes.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No notes — add MIDI notes to see velocity</p>
            </div>
        );
    }

    const handleVelocityDrag = (noteId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = e.currentTarget.parentElement;
        if (!container) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const origVelocity = notes.find((n) => n.id === noteId)?.velocity ?? 100;

        const onMove = (me: MouseEvent) => {
            const y = me.clientY - rect.top;
            const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
            const velocity = Math.round(ratio * 127);
            setNoteVelocity(clipId, noteId, velocity);
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const finalNote = (midiStore.value?.notesByClipId[clipId] ?? []).find((n) => n.id === noteId);
            const finalVelocity = finalNote?.velocity ?? origVelocity;
            if (finalVelocity !== origVelocity) {
                pushUndoEntry(
                    'Change velocity',
                    () => setNoteVelocity(clipId, noteId, origVelocity),
                    () => setNoteVelocity(clipId, noteId, finalVelocity)
                );
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div className="flex h-full items-end gap-px px-1 pb-1 relative" role="group" aria-label="Velocity lane">
            {notes.map((note) => {
                const isSelected = selectedNoteIds.has(note.id);
                return (
                    <div
                        key={note.id}
                        className={cn(
                            'w-3 rounded-t cursor-ns-resize transition-colors',
                            isSelected ? 'bg-amber-400/80 hover:bg-amber-400' : 'bg-blue-400/30 hover:bg-blue-400/50'
                        )}
                        style={{
                            height: `${(note.velocity / 127) * 100}%`,
                            marginLeft: `${note.startBeat * 3}px`,
                        }}
                        title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}: vel ${note.velocity}`}
                        onMouseDown={(e) => handleVelocityDrag(note.id, e)}
                    />
                );
            })}
        </div>
    );
};
