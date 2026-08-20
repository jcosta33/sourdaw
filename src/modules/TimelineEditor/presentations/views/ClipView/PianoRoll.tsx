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

import { DawGridHeaderCell } from '#/components/daw/DawGridHeaderCell';
import { DawSideRail } from '#/components/daw/DawSideRail';
import { useStore } from '#/infra/store/useStore';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { trackStore } from '#/modules/Arrangement/stores';
import { midiStore, stepRecordStore, type MidiStoreState } from '#/modules/MIDI/stores';
import {
    setNoteVelocity,
    setNotePressure,
    setNoteSlide,
    setNotePitchBend,
    setStepRecordBeat,
    toggleStepRecordingForClip,
} from '#/modules/MIDI/useCases';
import { projectStore } from '#/modules/Project/stores';
import { setProjectKeyRoot, setProjectScaleName } from '#/modules/Project/useCases';
import { SCALE_PATTERNS, KEY_NAMES } from '#/utils/Music/MusicalScale';
import { cn } from '#/utils/Styles/cn';

import { areOpenedClipNotesEqual } from '../../helpers/openedClipNotesEquality';
import {
    ROW_HEIGHT,
    RULER_HEIGHT,
    EMPTY_NOTES,
    getVisiblePitches,
    getPianoRollExtentBeats,
} from '../../helpers/pianoRollConstants';
import { usePianoRollInteractions } from '../../hooks/usePianoRollInteractions';
import { usePianoRollRenderer } from '../../hooks/usePianoRollRenderer';
import { NotePropertyLane } from '../AutomationLane/NotePropertyLane';

import { PianoRollContextMenu } from './PianoRollContextMenu';
import { PianoRollToolbar } from './PianoRollToolbar';

type PianoRollProps = {
    clipId: string;
    trackId: string;
    /** A9: additional clip IDs to show simultaneously (multi-clip editing) */
    openedClipIds?: string[];
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
    openedClipIds,
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

    const { keyRoot, scaleName } = useStore(projectStore);
    const scaleType = scaleName;
    const stepRecord = useStore(stepRecordStore);
    const [showGhostNotes, setShowGhostNotes] = useState(true);
    const [chordMode, setChordMode] = useState(false);
    const [chordType, setChordType] = useState<PianoRollChordType>('major');
    const [paintMode, setPaintMode] = useState(false);
    const [lassoMode, setLassoMode] = useState(false);
    const [isFolded, setIsFolded] = useState(false);
    const [constrainToScale, setConstrainToScale] = useState(false);
    const [notePreviewEnabled, setNotePreviewEnabled] = useState(true);
    const [showExpressionView, setShowExpressionView] = useState(false);
    const [activeExpressionLane, setActiveExpressionLane] = useState<'velocity' | 'pressure' | 'slide' | 'pitchBend'>(
        'velocity'
    );

    const beatWidth = Math.max(1, 40 * zoom);
    /** A9: focused clip receives newly drawn notes; defaults to primary clipId */
    const [focusedClipId, setFocusedClipId] = useState<string>(clipId);
    const prevClipId = useRef(clipId);
    if (prevClipId.current !== clipId) {
        prevClipId.current = clipId;
        setFocusedClipId(clipId);
    }

    // ── Store subscriptions ──────────────────────────────────────────
    const notes = useStoreSelector(
        midiStore,
        (state: MidiStoreState | null) => state?.notesByClipId[clipId] ?? EMPTY_NOTES
    );
    // A9: build notes map for all simultaneously-open clips (excludes primary clipId)
    const openedClipNotes = useStoreSelector(
        midiStore,
        (state: MidiStoreState | null) =>
            openedClipIds && openedClipIds.length > 0
                ? Object.fromEntries(
                      openedClipIds.filter((id) => id !== clipId).map((id) => [id, state?.notesByClipId[id] ?? []])
                  )
                : undefined,
        areOpenedClipNotesEqual
    );
    // Length of the clip being edited, read from the Arrangement module's own
    // store (foreign modules may read another module's store directly — see
    // AGENTS.md §Architecture). Drives the grid extent below so the piano
    // roll spans the clip it is editing instead of a fixed constant.
    const clipLengthBeats = useStoreSelector(trackStore, (state) => {
        const track = state?.tracks.find((candidate) => candidate.id === trackId);
        const clip = track?.clips.find((candidate) => candidate.id === clipId);
        return clip ? clip.endBeat - clip.startBeat : 0;
    });
    const extentBeats = getPianoRollExtentBeats(clipLengthBeats, notes);

    // ── Report layout to parent ──────────────────────────────────────
    useLayoutEffect(() => {
        onBeatWidthChange?.(beatWidth);
    }, [beatWidth, onBeatWidthChange]);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        const parent = canvas?.parentElement;
        if (!parent) {
            return undefined;
        }
        const report = (): void => {
            const parentWidth = parent.clientWidth;
            const totalWidth = Math.max(parentWidth, extentBeats * beatWidth);
            onContentWidthChange?.(totalWidth);
        };
        report();
        const ro = new ResizeObserver(report);
        ro.observe(parent);
        return () => ro.disconnect();
    }, [beatWidth, onContentWidthChange, extentBeats]);

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
        openedClipIds,
        beatWidth,
        gridSnap,
        scaleType,
        scaleRoot: keyRoot,
        isFolded,
        selectedNoteIds,
        stepInput: stepRecord.active,
        stepBeat: stepRecord.currentBeat,
        stepPitch: stepRecord.currentPitch,
        showGhostNotes,
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
        openedClipNotes,
        focusedClipId,
        beatWidth,
        gridSnap,
        scaleType,
        scaleRoot: keyRoot,
        isFolded,
        stepInput: stepRecord?.active ?? false,
        stepBeat: stepRecord?.currentBeat ?? 0,
        setStepBeat: setStepRecordBeat,
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
        constrainToScale,
        notePreviewEnabled,
    });

    // ── Render ────────────────────────────────────────────────────────
    const visiblePitches = getVisiblePitches(scaleName, keyRoot, isFolded);

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <PianoRollToolbar
                gridSnap={gridSnap}
                onGridSnapChange={setGridSnap}
                scaleRoot={keyRoot}
                onScaleRootChange={setProjectKeyRoot}
                scaleType={scaleName}
                onScaleTypeChange={setProjectScaleName}
                isFolded={isFolded}
                onToggleFolded={() => setIsFolded((param) => !param)}
                constrainToScale={constrainToScale}
                onToggleConstrainToScale={() => setConstrainToScale((param: boolean) => !param)}
                stepInput={stepRecord?.active ?? false}
                onToggleStepInput={() => toggleStepRecordingForClip({ clipId })}
                showGhostNotes={showGhostNotes}
                onToggleGhostNotes={() => setShowGhostNotes((param) => !param)}
                chordMode={chordMode}
                onToggleChordMode={() => setChordMode((param) => !param)}
                chordType={chordType}
                onChordTypeChange={setChordType}
                paintMode={paintMode}
                onTogglePaintMode={() => setPaintMode((param) => !param)}
                lassoMode={lassoMode}
                onToggleLassoMode={() => setLassoMode((param) => !param)}
                notePreviewEnabled={notePreviewEnabled}
                onToggleNotePreview={() => setNotePreviewEnabled((param: boolean) => !param)}
                zoom={zoom}
                onZoomChange={setZoom}
                openedClips={openedClipIds?.map((id) => ({ id, name: id }))}
                focusedClipId={focusedClipId}
                onFocusedClipIdChange={setFocusedClipId}
                showExpressionView={showExpressionView}
                onToggleExpressionView={() => setShowExpressionView((param) => !param)}
                activeExpressionLane={activeExpressionLane}
                onActiveExpressionLaneChange={setActiveExpressionLane}
            />
            <div className="flex flex-1 flex-col overflow-hidden">
                <div
                    className="flex flex-1 overflow-auto"
                    onScroll={(event) => {
                        const sl = (event.target as HTMLElement).scrollLeft;
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
                            const isInScale = SCALE_PATTERNS[scaleName]?.includes((noteIndex - keyRoot + 12) % 12);
                            return (
                                <div
                                    key={row}
                                    className={cn(
                                        'flex items-center justify-end pr-1 text-[10px]',
                                        isBlack
                                            ? 'bg-surface-base text-muted-foreground/40'
                                            : 'text-muted-foreground/60',
                                        isInScale && 'text-accent-primary/80 font-bold'
                                    )}
                                    style={{ height: ROW_HEIGHT }}
                                >
                                    {KEY_NAMES[noteIndex]}
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
                        // Marks this surface as a canvas editor that owns its
                        // destructive keys: `handleKeyDown` deletes the selected
                        // MIDI notes on Delete/Backspace. The global keyboard
                        // contract reads `closest('[data-canvas-editor]')` and
                        // gates the arrangement clip-delete shortcut here so a
                        // focused piano roll does not also delete the clip.
                        data-canvas-editor=""
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onDoubleClick={handleDoubleClick}
                        onKeyDown={handleKeyDown}
                        onContextMenu={handleContextMenu}
                        aria-label="Piano roll editor"
                    />
                </div>

                {/* I4: Expression View bottom panel */}
                {showExpressionView ? (
                    <div className="h-32 border-t border-border/20 bg-surface-well flex">
                        <div className="w-10 shrink-0 border-r border-border/10 flex flex-col items-center py-1">
                            <span className="text-[8px] text-muted-foreground uppercase vertical-text">
                                {activeExpressionLane}
                            </span>
                        </div>
                        <div className="flex-1 overflow-x-hidden">
                            <NotePropertyLane
                                clipId={clipId}
                                trackId={trackId}
                                selectedNoteIds={selectedNoteIds}
                                beatWidth={beatWidth}
                                contentWidth={extentBeats * beatWidth}
                                getValue={(node) => {
                                    if (activeExpressionLane === 'velocity') {
                                        return node.velocity ?? 100;
                                    }
                                    if (activeExpressionLane === 'pressure') {
                                        return node.pressure ?? 0;
                                    }
                                    if (activeExpressionLane === 'slide') {
                                        return node.slide ?? 0;
                                    }
                                    if (activeExpressionLane === 'pitchBend') {
                                        return (((node.pitchBend ?? 0) + 8192) / 16383) * 127;
                                    } // Scale to 0-127
                                    return 0;
                                }}
                                setValue={(cid, nid, val) => {
                                    if (activeExpressionLane === 'velocity') {
                                        setNoteVelocity(cid, nid, val);
                                    }
                                    if (activeExpressionLane === 'pressure') {
                                        setNotePressure(cid, nid, val);
                                    }
                                    if (activeExpressionLane === 'slide') {
                                        setNoteSlide(cid, nid, val);
                                    }
                                    if (activeExpressionLane === 'pitchBend') {
                                        setNotePitchBend(cid, nid, Math.round((val / 127) * 16383) - 8192);
                                    }
                                }}
                                label={activeExpressionLane}
                                undoLabel={`Change ${activeExpressionLane}`}
                            />
                        </div>
                    </div>
                ) : null}
            </div>
            {ctxMenu ? (
                <PianoRollContextMenu
                    menu={ctxMenu}
                    clipId={clipId}
                    notes={notes}
                    selectedNoteIds={selectedNoteIds}
                    onClose={() => setCtxMenu(null)}
                    onSelectAll={() => setSelectedNoteIds(new Set(notes.map((node) => node.id)))}
                    onClearSelection={() => setSelectedNoteIds(new Set())}
                />
            ) : null}
        </div>
    );
};
