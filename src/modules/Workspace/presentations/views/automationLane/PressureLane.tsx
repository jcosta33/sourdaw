import { type ReactElement, type MouseEvent, useRef, useEffect, useSyncExternalStore } from 'react';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';
import { setNotePressure } from '#/modules/MIDI/useCases/midiEventUseCases';
import { resolveToken } from '#/helpers/UI/resolveToken';

/** Inject an alpha value into an oklch() color string. */
const colorWithAlpha = (color: string, alpha: number): string => {
    const match = color.match(/oklch\(([^)]+)\)/);
    if (match) {
        const base = match[1]!.replace(/\s*\/\s*[\d.]+\s*$/, '').trim();
        return `oklch(${base} / ${alpha})`;
    }
    return color;
};

/** Return a brighter version of an oklch color. */
const brightenColor = (color: string, amount: number = 0.18): string => {
    const match = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (match) {
        const l = Math.min(1, parseFloat(match[1]!) + amount);
        const c = parseFloat(match[2]!);
        const h = parseFloat(match[3]!);
        return `oklch(${l.toFixed(3)} ${c} ${h})`;
    }
    return color;
};

type PressureLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    contentWidth: number;
};

export const PressureLane = ({ clipId, trackId, selectedNoteIds, beatWidth, contentWidth }: PressureLaneProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value
    );

    const trackState = useSyncExternalStore(
        (cb) => trackStore.subscribe(() => cb()),
        () => trackStore.value,
        () => trackStore.value
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    const activeTrack = trackState?.tracks.find((t) => t.id === trackId);
    const activeClip = activeTrack?.clips.find((c) => c.id === clipId);
    const clipColor = activeClip?.color || activeTrack?.color || 'oklch(0.45 0.06 250)';
    const selectedColor = brightenColor(clipColor, 0.22);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const containerWidth = container.getBoundingClientRect().width;
        const w = Math.max(containerWidth, contentWidth);
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

        ctx.fillStyle = resolveToken('--color-bg-overlay', '#151515');
        ctx.fillRect(0, 0, w, h);

        if (notes.length === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('No notes — add MIDI to edit pressure', w / 2, h / 2 + 4);
            return;
        }

        for (const note of notes) {
            const pressure = note.pressure ?? 0;
            const x = note.startBeat * beatWidth;
            const barW = Math.max(3, note.duration * beatWidth - 2);
            const barH = (pressure / 127) * (h - 4);
            const barY = h - barH - 2;
            const isSelected = selectedNoteIds.has(note.id);

            const noteColor = isSelected ? selectedColor : clipColor;
            const alpha = 0.35 + (pressure / 127) * 0.55;

            ctx.fillStyle = colorWithAlpha(noteColor, alpha);
            ctx.beginPath();
            ctx.roundRect(x + 1, barY, barW, barH, [2, 2, 0, 0]);
            ctx.fill();

            ctx.strokeStyle = colorWithAlpha(noteColor, isSelected ? 0.6 : 0.25);
            ctx.lineWidth = 0.5;
            ctx.stroke();

            if (barW > 14) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.font = '7px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText(String(pressure), x + 1 + barW / 2, barY - 2);
            }
        }
    }, [notes, selectedNoteIds, beatWidth, contentWidth, clipColor, selectedColor]);

    const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
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
        const origPressure = hitNote.pressure ?? 0;

        const onMove = (me: globalThis.MouseEvent) => {
            const containerRect = container.getBoundingClientRect();
            const ry = me.clientY - containerRect.top;
            const r = 1 - Math.max(0, Math.min(1, (ry - 2) / (h - 4)));
            const pressure = Math.round(r * 127);
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

        onMove(e.nativeEvent);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div ref={containerRef} className="relative h-full w-full" role="group" aria-label="Pressure lane">
            <canvas
                ref={canvasRef}
                className="cursor-ns-resize"
                onMouseDown={handleMouseDown}
            />
        </div>
    );
};
