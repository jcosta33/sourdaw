/**
 * PianoRoll — MIDI note editor with canvas rendering, drag gestures,
 * step input, chord stamping, paint mode, lasso selection, and context menu.
 *
 * Composed from:
 * - pianoRollConstants.ts       (shared constants, types, pure helpers)
 * - usePianoRollRenderer.ts     (Canvas 2D drawing hook)
 * - usePianoRollInteractions.ts (mouse/keyboard gesture hook)
 * - PianoRollToolbar.tsx        (toolbar controls — pure component)
 * - PianoRollContextMenu.tsx    (right-click menu — view component)
 */
import { type ReactElement, type Dispatch, type SetStateAction, useRef, useLayoutEffect, useState } from 'react';

import { cn } from '#/helpers/Styles/cn';
import { midiStore } from '#/modules/MIDI';
import { trackStore } from '#/modules/Arrangement/stores';
import { useStore } from '#/infra/store/useStore';

import { usePianoRollRenderer } from '../../hooks/usePianoRollRenderer';
import { usePianoRollInteractions } from '../../hooks/usePianoRollInteractions';
import { PianoRollToolbar } from './PianoRollToolbar';
import { PianoRollContextMenu } from './PianoRollContextMenu';
import { NOTE_NAMES, GRID_BEATS, ROW_HEIGHT, RULER_HEIGHT, getVisiblePitches } from '../../helpers/pianoRollConstants';
import { DawGridHeaderCell } from '#/components/daw/DawGridHeaderCell';
import { DawSideRail } from '#/components/daw/DawSideRail';

type PianoRollProps = {
    clipId: string;
    trackId: string;
    selectedNoteIds: Set<string>;
    onSelectedNoteIdsChange: Dispatch<SetStateAction<Set<string>>>;
    onScrollChange?: (scrollLeft: number) => void;
    onBeatWidthChange?: (beatWidth: number) => void;
    onContentWidthChange?: (contentWidth: number) => void;
};

type PianoRollChordType =
    | 'major'
    | 'minor'
    | 'dim'
    | 'aug'
    | 'sus2'
    | 'sus4'
    | '7'
    | 'maj7'
    | 'min7'
    | 'dim7'
    | 'aug7'
    | '6'
    | 'min6'
    | '9'
    | 'add9'
    | 'min9'
    | '7sus4';

export const PianoRoll = ({
    clipId,
    trackId,
    selectedNoteIds,
    onSelectedNoteIdsChange,
    onScrollChange,
    onBeatWidthChange,
    onContentWidthChange,
}: PianoRollProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [zoom, setZoom] = useState(1);
    const [_scrollX, setScrollX] = useState(0);
    const setSelectedNoteIds = onSelectedNoteIdsChange;
    const [gridSnap, setGridSnap] = useState(0.25);

    const [scaleRoot, setScaleRoot] = useState(0);
    const [scaleType, setScaleType] = useState<string>('chromatic');
    const [stepInput, setStepInput] = useState(false);
    const [stepBeat, setStepBeat] = useState(0);
    const [showGhostNotes, setShowGhostNotes] = useState(true);
    const [chordMode, setChordMode] = useState(false);
    const [chordType, setChordType] = useState<PianoRollChordType>('major');
    const [paintMode, setPaintMode] = useState(false);
    const [lassoMode, setLassoMode] = useState(false);
    const [isFolded, setIsFolded] = useState(false);

    const beatWidth = Math.max(1, 40 * zoom);

    // ── Store subscriptions ──────────────────────────────────────────
    const midiState = useStore(midiStore, { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    const trackState = useStore(trackStore, { tracks: [], selectedTrackId: null });
    const notes = midiState?.notesByClipId[clipId] ?? [];

    // ── Report layout to parent ──────────────────────────────────────
    useLayoutEffect(() => {
        onBeatWidthChange?.(beatWidth);
    }, [beatWidth, onBeatWidthChange]);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        const parent = canvas?.parentElement;
        if (!parent) {
            return;
        }
        const report = (): void => {
            const parentWidth = parent.clientWidth;
            const totalWidth = Math.max(parentWidth, GRID_BEATS * beatWidth);
            onContentWidthChange?.(totalWidth);
        };
        report();
        const ro = new ResizeObserver(report);
        ro.observe(parent);
        return () => ro.disconnect();
    }, [beatWidth, onContentWidthChange]);

    // ── Refs shared with interactions ────────────────────────────────
    const drawPreviewRef = useRef<{ beat: number; pitch: number; duration: number } | null>(null);
    const rubberBandRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
    const dragPreviewRef = useRef<{
        noteIds: Set<string>;
        beatDelta: number;
        pitchDelta: number;
        durationOverride?: Map<string, number>;
        beatOverride?: Map<string, { beat: number; duration: number }>;
    } | null>(null);

    // ── Canvas rendering ─────────────────────────────────────────────
    const draw = usePianoRollRenderer({
        canvasRef,
        notes,
        clipId,
        trackId,
        beatWidth,
        gridSnap,
        scaleType,
        scaleRoot,
        isFolded,
        selectedNoteIds,
        stepInput,
        stepBeat,
        showGhostNotes,
        midiNotesByClipId: midiState?.notesByClipId ?? null,
        tracks: trackState?.tracks ?? null,
        drawPreviewRef,
        rubberBandRef,
        dragPreviewRef,
    });

    // ── Interactions ─────────────────────────────────────────────────
    const {
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleDoubleClick,
        handleWheel,
        handleKeyDown,
        handleContextMenu,
        ctxMenu,
        setCtxMenu,
        hoverCursor,
    } = usePianoRollInteractions({
        canvasRef,
        clipId,
        trackId,
        notes,
        beatWidth,
        gridSnap,
        scaleType,
        scaleRoot,
        isFolded,
        stepInput,
        stepBeat,
        setStepBeat,
        chordMode,
        chordType,
        paintMode,
        lassoMode,
        selectedNoteIds,
        setSelectedNoteIds,
        setZoom,
        setScrollX,
        draw,
        drawPreviewRef,
        rubberBandRef,
        dragPreviewRef,
    });

    // ── Render ────────────────────────────────────────────────────────
    const visiblePitches = getVisiblePitches(scaleType, scaleRoot, isFolded);

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <PianoRollToolbar
                gridSnap={gridSnap}
                onGridSnapChange={setGridSnap}
                scaleRoot={scaleRoot}
                onScaleRootChange={setScaleRoot}
                scaleType={scaleType}
                onScaleTypeChange={setScaleType}
                isFolded={isFolded}
                onToggleFolded={() => setIsFolded((p) => !p)}
                stepInput={stepInput}
                onToggleStepInput={() => setStepInput((p) => !p)}
                showGhostNotes={showGhostNotes}
                onToggleGhostNotes={() => setShowGhostNotes((p) => !p)}
                chordMode={chordMode}
                onToggleChordMode={() => setChordMode((p) => !p)}
                chordType={chordType}
                onChordTypeChange={setChordType}
                paintMode={paintMode}
                onTogglePaintMode={() => setPaintMode((p) => !p)}
                lassoMode={lassoMode}
                onToggleLassoMode={() => setLassoMode((p) => !p)}
                zoom={zoom}
                onZoomChange={setZoom}
            />

            <div
                className="flex flex-1 overflow-auto"
                onScroll={(e) => {
                    const sl = (e.target as HTMLElement).scrollLeft;
                    setScrollX(sl);
                    onScrollChange?.(sl);
                }}
            >
                {/* Piano keys sidebar */}
                <DawSideRail className="sticky left-0 z-10 w-10">
                    <DawGridHeaderCell className="px-0" style={{ height: RULER_HEIGHT }} />
                    {visiblePitches.map((pitch, row) => {
                        const noteIndex = pitch % 12;
                        const isBlack = [1, 3, 6, 8, 10].includes(noteIndex);
                        return (
                            <div
                                key={row}
                                className={cn(
                                    'flex items-center justify-end pr-1 text-[10px]',
                                    isBlack ? 'bg-surface-base text-muted-foreground/40' : 'text-muted-foreground/60'
                                )}
                                style={{ height: ROW_HEIGHT }}
                            >
                                {NOTE_NAMES[noteIndex]}
                                {Math.floor(pitch / 12) - 1}
                            </div>
                        );
                    })}
                </DawSideRail>

                {/* Canvas */}
                <canvas
                    ref={canvasRef}
                    className="outline-none"
                    style={{ cursor: hoverCursor }}
                    tabIndex={0}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onDoubleClick={handleDoubleClick}
                    onWheel={handleWheel}
                    onKeyDown={handleKeyDown}
                    onContextMenu={handleContextMenu}
                    aria-label="Piano roll editor"
                />
            </div>

            {ctxMenu ? (
                <PianoRollContextMenu
                    menu={ctxMenu}
                    clipId={clipId}
                    notes={notes}
                    selectedNoteIds={selectedNoteIds}
                    onClose={() => setCtxMenu(null)}
                    onSelectAll={() => setSelectedNoteIds(new Set(notes.map((n) => n.id)))}
                    onClearSelection={() => setSelectedNoteIds(new Set())}
                />
            ) : null}
        </div>
    );
};
