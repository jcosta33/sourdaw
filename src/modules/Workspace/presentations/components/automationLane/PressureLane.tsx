import { type ReactElement, type MouseEvent as ReactMouseEvent, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { pushUndoEntry } from '../../../useCases/workspaceViewActions';
import { setNotePressure } from '../../../useCases/workspaceViewActions';
import { NOTE_NAMES } from './laneConstants';

type PressureLaneProps = {
    clipId: string | null;
    selectedNoteIds: Set<string>;
};

export const PressureLane = ({ clipId, selectedNoteIds }: PressureLaneProps): ReactElement => {
    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    if (notes.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No notes — add MIDI notes to edit pressure</p>
            </div>
        );
    }

    const handlePressureDrag = (noteId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = e.currentTarget.parentElement;
        if (!container) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const origPressure = notes.find((n) => n.id === noteId)?.pressure ?? 0;

        const onMove = (me: MouseEvent) => {
            const y = me.clientY - rect.top;
            const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
            const pressure = Math.round(ratio * 127);
            setNotePressure(clipId, noteId, pressure);
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const finalNote = (midiStore.value?.notesByClipId[clipId] ?? []).find((n) => n.id === noteId);
            const finalPressure = finalNote?.pressure ?? origPressure;
            if (finalPressure !== origPressure) {
                pushUndoEntry(
                    'Change pressure',
                    () => setNotePressure(clipId, noteId, origPressure),
                    () => setNotePressure(clipId, noteId, finalPressure)
                );
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div className="flex h-full items-end gap-px px-1 pb-1 relative" role="group" aria-label="Pressure lane">
            {notes.map((note) => {
                const pressure = note.pressure ?? 0;
                const isSelected = selectedNoteIds.has(note.id);
                return (
                    <div
                        key={note.id}
                        className={cn(
                            'w-3 rounded-t cursor-ns-resize transition-colors',
                            isSelected
                                ? 'bg-violet-300/80 hover:bg-violet-300'
                                : 'bg-violet-500/30 hover:bg-violet-500/50'
                        )}
                        style={{
                            height: `${(pressure / 127) * 100}%`,
                            minHeight: pressure > 0 ? '2px' : undefined,
                            marginLeft: `${note.startBeat * 3}px`,
                        }}
                        title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}: pressure ${pressure}`}
                        onMouseDown={(e) => handlePressureDrag(note.id, e)}
                    />
                );
            })}
        </div>
    );
};
