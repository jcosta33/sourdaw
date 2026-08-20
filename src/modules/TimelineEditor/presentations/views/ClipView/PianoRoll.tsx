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
    PITCH_RAIL_WIDTH,
    getVisiblePitches,
    getPianoRollExtentBeats,
} from '../../helpers/pianoRollConstants';
import { usePianoRollInteractions } from '../../hooks/usePianoRollInteractions';
import { usePianoRollRenderer } from '../../hooks/usePianoRollRenderer';
import { NotePropertyLane } from '../AutomationLane/NotePropertyLane';

import { PianoRollContextMenu } from './PianoRollContextMenu';
import { PianoRollToolbar } from './PianoRollToolbar';

/**
 * Structural equality for the `clipId -> length in beats` map used to derive
 * the grid extent. The selector below rebuilds this record on every
 * `trackStore` notification (its identity is never stable), so
 * `useStoreSelector` needs a predicate to tell a real length change from the
 * same lengths in a new wrapper — otherwise every store notification would
 * recompute `extentBeats` and re-run the layout effects that report it
 * upward.
 */
function areClipLengthsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
    if (a === b) {
        return true;
    }
    const ids = Object.keys(a);
    if (ids.length !== Object.keys(b).length) {
        return false;
    }
    return ids.every((id) => a[id] === b[id]);
}

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
    // The scroll container is the piano roll's viewport: the renderer sizes the
    // canvas backing store from its `clientWidth` and draws from its
    // `scrollLeft`, and the interaction handlers add that same `scrollLeft` to
    // turn a pointer position into a beat.
    const scrollRef = useRef<HTMLDivElement>(null);
    // Scroll container for the expression view's velocity/pressure/slide/
    // pitch-bend panel, and the panel's viewport in exactly the sense
    // `scrollRef` is the roll's: `NotePropertyLane` sizes its backing store
    // from this element's `clientWidth` and draws from its `scrollLeft`. It is
    // a real scroll container, synced to the main canvas's `scrollLeft` in the
    // handler below, because `contentWidth` is unbounded — it tracks the clip's
    // real length, not a fixed zoom-independent cap. Same pattern as
    // AutomationLane.tsx (`scrollRef` + `overflow-x-auto`, synced from outside
    // via ClipView.tsx's `handlePianoRollScroll`) — this one syncs internally
    // since both scroll containers live in this component.
    const expressionScrollRef = useRef<HTMLDivElement>(null);
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
    // Length of the primary clip plus every clip opened alongside it, read
    // from the Arrangement module's own store (foreign modules may read
    // another module's store directly — see AGENTS.md §Architecture). Drives
    // the grid extent below so the piano roll spans everything actually
    // drawn, not just the clip it was opened on. An opened clip may live on
    // any track, so this searches every track's clips rather than only
    // `trackId`'s.
    const clipLengthsBeats = useStoreSelector(
        trackStore,
        (state) => {
            const ids = openedClipIds && openedClipIds.length > 0 ? [clipId, ...openedClipIds] : [clipId];
            const lengths: Record<string, number> = {};
            for (const id of ids) {
                let length = 0;
                for (const track of state?.tracks ?? []) {
                    const clip = track.clips.find((candidate) => candidate.id === id);
                    if (clip) {
                        length = clip.endBeat - clip.startBeat;
                        break;
                    }
                }
                lengths[id] = length;
            }
            return lengths;
        },
        areClipLengthsEqual
    );
    // Extent is derived from the primary clip and every opened clip together
    // — see `getPianoRollExtentBeats` in pianoRollConstants.ts. Opened clips'
    // notes are drawn in this same coordinate space (`openedClipNotes` below,
    // rendered by `usePianoRollRenderer.ts`'s `drawOpenedClipNotes`) and are
    // editable, not read-only, so their content must also grow the extent.
    //
    // This is a CSS layout measurement and nothing else: it is the width of
    // the scroll wrapper below and of the expression lane's content. It is
    // deliberately unbounded and independent of `devicePixelRatio` — the
    // canvas backing store is sized from the viewport, not from this, so no
    // zoom level can put a beat outside it.
    const extentBeats = getPianoRollExtentBeats([
        { clipLengthBeats: clipLengthsBeats[clipId] ?? 0, notes },
        ...Object.entries(openedClipNotes ?? {}).map(([id, openedNotes]) => ({
            clipLengthBeats: clipLengthsBeats[id] ?? 0,
            notes: openedNotes,
        })),
    ]);
    const contentWidth = extentBeats * beatWidth;

    // ── Report layout to parent ──────────────────────────────────────
    useLayoutEffect(() => {
        onBeatWidthChange?.(beatWidth);
    }, [beatWidth, onBeatWidthChange]);

    useLayoutEffect(() => {
        const viewport = scrollRef.current;
        if (!viewport) {
            return undefined;
        }
        const report = (): void => {
            onContentWidthChange?.(Math.max(viewport.clientWidth, contentWidth));
        };
        report();
        const ro = new ResizeObserver(report);
        ro.observe(viewport);
        return () => ro.disconnect();
    }, [onContentWidthChange, contentWidth]);

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
        scrollRef,
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
        scrollRef,
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
                    ref={scrollRef}
                    className="flex flex-1 overflow-auto"
                    onScroll={(event) => {
                        const sl = (event.target as HTMLElement).scrollLeft;
                        setScrollX(sl);
                        onScrollChange?.(sl);
                        if (expressionScrollRef.current) {
                            expressionScrollRef.current.scrollLeft = sl;
                        }
                    }}
                >
                    {/* Piano keys sidebar */}
                    <DawSideRail className="sticky left-0 z-10" style={{ width: PITCH_RAIL_WIDTH }}>
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

                    {/*
                     * Layout extent. This wrapper — plain CSS, bounded by
                     * nothing — is what makes the arrangement scrollable, so
                     * every beat stays reachable at every zoom. `flex-1`
                     * fills the viewport when the content is shorter than it;
                     * `minWidth` takes over once the content is longer.
                     */}
                    <div className="flex-1" style={{ minWidth: contentWidth }}>
                        {/*
                         * Viewport canvas. Its backing store covers only what
                         * is on screen (see usePianoRollRenderer), so it sticks
                         * to the right edge of the pitch rail — the left edge
                         * of the content area — while the wrapper above scrolls
                         * past it. `left` must equal the rail's own width or
                         * the drawn slice and the visible slice disagree, which
                         * is why both read the same constant.
                         */}
                        <canvas
                            ref={canvasRef}
                            className="sticky outline-none"
                            style={{ left: PITCH_RAIL_WIDTH, cursor: hoverCursor }}
                            tabIndex={0}
                            // Marks this surface as a canvas editor that owns
                            // its destructive keys: `handleKeyDown` deletes the
                            // selected MIDI notes on Delete/Backspace. The
                            // global keyboard contract reads
                            // `closest('[data-canvas-editor]')` and gates the
                            // arrangement clip-delete shortcut here so a focused
                            // piano roll does not also delete the clip.
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
                </div>

                {/* I4: Expression View bottom panel */}
                {showExpressionView ? (
                    <div className="h-32 border-t border-border/20 bg-surface-well flex">
                        <div className="w-10 shrink-0 border-r border-border/10 flex flex-col items-center py-1">
                            <span className="text-[8px] text-muted-foreground uppercase vertical-text">
                                {activeExpressionLane}
                            </span>
                        </div>
                        <div
                            ref={expressionScrollRef}
                            className="flex-1 overflow-x-auto"
                            style={{ scrollbarWidth: 'none' }}
                        >
                            <div style={{ width: contentWidth, height: '100%' }}>
                                <NotePropertyLane
                                    clipId={clipId}
                                    trackId={trackId}
                                    selectedNoteIds={selectedNoteIds}
                                    beatWidth={beatWidth}
                                    scrollRef={expressionScrollRef}
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
