import { type ReactElement, type MouseEvent as ReactMouseEvent, useRef, useEffect, useSyncExternalStore } from 'react';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { pushUndoEntry } from '../../../useCases/workspaceViewActions';
import { setNoteSlide } from '../../../useCases/workspaceViewActions';

type SlideLaneProps = {
    clipId: string | null;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    contentWidth: number;
};

export const SlideLane = ({ clipId, selectedNoteIds, beatWidth, contentWidth }: SlideLaneProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const w = contentWidth;
        const h = container.getBoundingClientRect().height;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        if (notes.length === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('No notes — add MIDI to edit slide', w / 2, h / 2 + 4);
            return;
        }

        for (const note of notes) {
            const slide = note.slide ?? 0;
            const x = note.startBeat * beatWidth;
            const barW = Math.max(3, note.duration * beatWidth - 2);
            const barH = (slide / 127) * (h - 4);
            const barY = h - barH - 2;
            const isSelected = selectedNoteIds.has(note.id);

            ctx.fillStyle = isSelected ? 'rgba(255, 180, 140, 0.8)' : 'rgba(120, 220, 180, 0.45)';
            ctx.beginPath();
            ctx.roundRect(x + 1, barY, barW, barH, [2, 2, 0, 0]);
            ctx.fill();

            ctx.strokeStyle = isSelected ? 'rgba(255, 180, 140, 0.6)' : 'rgba(120, 220, 180, 0.25)';
            ctx.lineWidth = 0.5;
            ctx.stroke();

            if (barW > 14) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.font = '7px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText(String(slide), x + 1 + barW / 2, barY - 2);
            }
        }
    }, [notes, selectedNoteIds, beatWidth, contentWidth]);

    const handleMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        if (!clipId) {
            return;
        }
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }
        const canvasRect = canvas.getBoundingClientRect();
        const mx = e.clientX - canvasRect.left;
        const h = container.getBoundingClientRect().height;

        let hitNote: (typeof notes)[0] | null = null;
        for (const note of notes) {
            const x = note.startBeat * beatWidth;
            const barW = Math.max(3, note.duration * beatWidth - 2);
            if (mx >= x + 1 && mx <= x + 1 + barW) {
                hitNote = note;
                break;
            }
        }

        if (!hitNote) {
            return;
        }

        const noteId = hitNote.id;
        const origSlide = hitNote.slide ?? 0;

        const onMove = (me: MouseEvent) => {
            const containerRect = container.getBoundingClientRect();
            const ry = me.clientY - containerRect.top;
            const r = 1 - Math.max(0, Math.min(1, (ry - 2) / (h - 4)));
            const slide = Math.round(r * 127);
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

        onMove(e.nativeEvent);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div ref={containerRef} className="relative h-full w-full" role="group" aria-label="Slide lane">
            <canvas
                ref={canvasRef}
                className="cursor-ns-resize"
                onMouseDown={handleMouseDown}
            />
        </div>
    );
};
