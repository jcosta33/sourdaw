/**
 * VirtualKeyboard — Logic Pro–style on-screen piano keyboard.
 *
 * Layout strategy:
 * - Each white key is a fixed 28px wide. The full keyboard is 9 octaves = 63 whites + C8 = 64 whites = 1792px total.
 * - Black keys are absolutely positioned over the white key row using exact pixel math.
 * - The keyboard container scrolls horizontally. On mount it scrolls to show the active octave.
 * - Mouse: pointerdown = noteOn, pointerup/pointerleave = noteOff. Drag across keys glides.
 * - Computer keyboard (ASDFGHJKL; = white keys, WETYUOP = black keys) fires notes only
 *   when the panel is focused. Z/X = octave down/up.
 * - Routes through triggerLiveNoteOn/Off use cases → same path as a physical MIDI controller.
 */

import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '#/infra/store/useStore';
import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { DawDisplaySurface } from '#/components/daw/DawDisplaySurface';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/helpers/Styles/cn';
import { Slider } from '#/components/ui/slider';
import { triggerLiveNoteOn, triggerLiveNoteOff } from '#/modules/AudioEngine/useCases';
import { workspaceStore } from '#/modules/Workspace/stores';
import {
    type WorkspaceState,
    setVirtualKeyboardOctave,
    setVirtualKeyboardVelocity,
} from '#/modules/Workspace/useCases';

// ─── Layout constants ─────────────────────────────────────────────────────────

/** Width of each white key in px */
const KEY_W = 28;
/** Height of a white key fills the container — we use 100% */
const BLACK_KEY_W = 16;
/** Black key height as a % of white key height */
const BLACK_KEY_H_RATIO = 0.62;

/** Number of white keys per octave */
const WHITES_PER_OCT = 7;
/**
 * Number of C octaves displayed (C-1 … C8).
 * C-1 = MIDI 0, C8 = MIDI 108.
 * That's 9 full octaves + 1 trailing C = 9*7+1 = 64 white keys.
 */
const TOTAL_OCTAVES = 9;
const TOTAL_WHITE_KEYS = TOTAL_OCTAVES * WHITES_PER_OCT + 1;
const TOTAL_WIDTH_PX = TOTAL_WHITE_KEYS * KEY_W;

// ─── Music theory helpers ─────────────────────────────────────────────────────

/** Semitone offset within an octave → is it a white key? */
const WHITE_KEY_SEMITONES = new Set([0, 2, 4, 5, 7, 9, 11]);

/**
 * Semitone → pixel offset from the LEFT edge of the white key to the LEFT edge of
 * the black key that follows it, expressed as a fraction of KEY_W.
 * Standard piano proportions: C# sits at ~0.6 of C, D# at ~0.6 of D, etc.
 * We define this as "which white-key boundary does the black key sit near, and how far right of it".
 */
/**
 * Semitone offset → left edge position as a fraction of KEY_W from the octave's C left edge.
 * Standard piano ratios (verified against Logic Pro / Ableton):
 *   White key width = 1 unit. Octave = 7 units wide.
 *   Black key width ≈ 0.57 units. Black key left edges:
 *   C#: 0.6 units from C left  → fraction = 0.6
 *   D#: 1.7 units from C left  → fraction = 1.7   (D starts at 1.0)
 *   F#: 3.6 units from C left  → fraction = 3.6   (F starts at 3.0)
 *   G#: 4.65 units              → fraction = 4.65  (G starts at 4.0)
 *   A#: 5.7 units               → fraction = 5.7   (A starts at 5.0)
 */
const BLACK_KEY_FRACS: Record<number, number> = {
    1: 0.6, // C#
    3: 1.67, // D#
    6: 3.6, // F#
    8: 4.65, // G#
    10: 5.7, // A#
};

// Pre-built list of all black keys: { midi, leftPx } for absolute positioning
type BlackKeyDef = {
    midi: number;
    leftPx: number;
};

/** Convert a white-key index within the full keyboard (0 = C-1) to its MIDI note number */
function whiteIdxToMidi(whiteIdx: number): number {
    const octave = Math.floor(whiteIdx / WHITES_PER_OCT); // 0 = C-1 octave
    const posInOct = whiteIdx % WHITES_PER_OCT;
    const semiOffsets = [0, 2, 4, 5, 7, 9, 11];
    return (octave - 1) * 12 + 12 + (semiOffsets[posInOct] ?? 0);
    // octave 0 → C-1 = MIDI 0: (0-1)*12+12 = 0 ✓
    // octave 1 → C0 = MIDI 12: (1-1)*12+12 = 12 ✓
    // octave 5 → C4 = MIDI 60: (5-1)*12+12 = 60 ✓
}

/** First white-key index (in full keyboard) for a given display octave */
function octaveToFirstWhiteIdx(displayOctave: number): number {
    // C-1 is white idx 0, C0 is 7, C4 is 35, etc.
    return (displayOctave + 1) * WHITES_PER_OCT;
}

function buildBlackKeys(): BlackKeyDef[] {
    const keys: BlackKeyDef[] = [];
    for (let oct = 0; oct < TOTAL_OCTAVES; oct++) {
        const octaveLeftPx = oct * WHITES_PER_OCT * KEY_W;
        for (const [semiStr, frac] of Object.entries(BLACK_KEY_FRACS)) {
            const semi = Number(semiStr);
            const midi = (oct - 1) * 12 + 12 + semi;
            if (midi < 0 || midi > 127) {
                continue;
            }
            const leftPx = octaveLeftPx + frac * KEY_W;
            keys.push({ midi, leftPx });
        }
    }
    return keys;
}

const ALL_BLACK_KEYS = buildBlackKeys();

const defaultWorkspaceState: WorkspaceState = {
    virtualKeyboardOctave: 4,
    virtualKeyboardVelocity: 100,
} as WorkspaceState;

// ─── Computer keyboard mappings ───────────────────────────────────────────────

/** ASDFGHJKL; → semitone offset from root C of the active octave */
const KEYBOARD_WHITE_MAP: Record<string, number> = {
    a: 0, // C
    s: 2, // D
    d: 4, // E
    f: 5, // F
    g: 7, // G
    h: 9, // A
    j: 11, // B
    k: 12, // C+1
    l: 14, // D+1
    ';': 16, // E+1
};

const KEYBOARD_BLACK_MAP: Record<string, number> = {
    w: 1, // C#
    e: 3, // D#
    t: 6, // F#
    y: 8, // G#
    u: 10, // A#
    o: 13, // C#+1
    p: 15, // D#+1
};

// ─── Component ────────────────────────────────────────────────────────────────

type VirtualKeyboardProps = {
    onClose?: () => void;
};

export const VirtualKeyboard = ({ onClose }: VirtualKeyboardProps): ReactElement => {
    const workspace = useStore(workspaceStore, defaultWorkspaceState);
    const octave = workspace.virtualKeyboardOctave;
    const velocity = workspace.virtualKeyboardVelocity;

    const panelRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const [pressedNotes, setPressedNotes] = useState<Set<number>>(new Set());
    const mouseNote = useRef<number | null>(null);
    const heldKeys = useRef<Set<string>>(new Set());

    // Scroll to current octave on mount and when octave changes
    useLayoutEffect(() => {
        if (!scrollRef.current) {
            return;
        }
        const firstWhite = octaveToFirstWhiteIdx(octave);
        const targetScroll = firstWhite * KEY_W - 60; // a little left-padding
        scrollRef.current.scrollLeft = Math.max(0, targetScroll);
    }, [octave]);

    // ── Note helpers ──────────────────────────────────────────────────────────

    const triggerNoteOn = (midiNote: number) => {
        if (midiNote < 0 || midiNote > 127) {
            return;
        }
        triggerLiveNoteOn(0, midiNote, velocity);
        setPressedNotes((prev) => {
            if (prev.has(midiNote)) {
                return prev;
            }
            const next = new Set(prev);
            next.add(midiNote);
            return next;
        });
    };

    const triggerNoteOff = (midiNote: number) => {
        triggerLiveNoteOff(0, midiNote);
        setPressedNotes((prev) => {
            if (!prev.has(midiNote)) {
                return prev;
            }
            const next = new Set(prev);
            next.delete(midiNote);
            return next;
        });
    };

    // ── Mouse interaction ─────────────────────────────────────────────────────

    const onWhitePointerDown = (midiNote: number, event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
        if (mouseNote.current !== null && mouseNote.current !== midiNote) {
            triggerNoteOff(mouseNote.current);
        }
        mouseNote.current = midiNote;
        triggerNoteOn(midiNote);
        panelRef.current?.focus({ preventScroll: true });
    };

    const onWhitePointerUp = (midiNote: number, event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (mouseNote.current === midiNote) {
            triggerNoteOff(midiNote);
            mouseNote.current = null;
        }
    };

    const onWhitePointerEnter = (midiNote: number, event: React.PointerEvent<HTMLDivElement>) => {
        if (event.buttons === 1 && mouseNote.current !== null && mouseNote.current !== midiNote) {
            triggerNoteOff(mouseNote.current);
            mouseNote.current = midiNote;
            triggerNoteOn(midiNote);
        }
    };

    const onBlackPointerDown = (midiNote: number, event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (mouseNote.current !== null && mouseNote.current !== midiNote) {
            triggerNoteOff(mouseNote.current);
        }
        mouseNote.current = midiNote;
        triggerNoteOn(midiNote);
        panelRef.current?.focus({ preventScroll: true });
    };

    const onBlackPointerUp = (midiNote: number, event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (mouseNote.current === midiNote) {
            triggerNoteOff(midiNote);
            mouseNote.current = null;
        }
    };

    const onBlackPointerEnter = (midiNote: number, event: React.PointerEvent<HTMLDivElement>) => {
        if (event.buttons === 1 && mouseNote.current !== null && mouseNote.current !== midiNote) {
            triggerNoteOff(mouseNote.current);
            mouseNote.current = midiNote;
            triggerNoteOn(midiNote);
        }
    };

    // Release mouse note on global pointer-up (handles releasing outside panel)
    useEffect(() => {
        const onGlobalUp = () => {
            if (mouseNote.current !== null) {
                triggerNoteOff(mouseNote.current);
                mouseNote.current = null;
            }
        };
        window.addEventListener('pointerup', onGlobalUp);
        return () => window.removeEventListener('pointerup', onGlobalUp);
    }, []);

    // ── Computer keyboard ─────────────────────────────────────────────────────

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        const key = event.key.toLowerCase();

        if (key === 'z') {
            event.preventDefault();
            setVirtualKeyboardOctave(octave - 1);
            return;
        }
        if (key === 'x') {
            event.preventDefault();
            setVirtualKeyboardOctave(octave + 1);
            return;
        }

        if (heldKeys.current.has(key)) {
            return;
        }
        heldKeys.current.add(key);

        const whiteSemi = KEYBOARD_WHITE_MAP[key];
        if (whiteSemi !== undefined) {
            event.preventDefault();
            triggerNoteOn(octave * 12 + whiteSemi);
            return;
        }
        const blackSemi = KEYBOARD_BLACK_MAP[key];
        if (blackSemi !== undefined) {
            event.preventDefault();
            triggerNoteOn(octave * 12 + blackSemi);
        }
    };

    const onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const key = event.key.toLowerCase();
        heldKeys.current.delete(key);

        const whiteSemi = KEYBOARD_WHITE_MAP[key];
        if (whiteSemi !== undefined) {
            triggerNoteOff(octave * 12 + whiteSemi);
            return;
        }
        const blackSemi = KEYBOARD_BLACK_MAP[key];
        if (blackSemi !== undefined) {
            triggerNoteOff(octave * 12 + blackSemi);
        }
    };

    const onBlur = () => {
        heldKeys.current.clear();
        for (const midiNote of pressedNotes) {
            triggerLiveNoteOff(0, midiNote);
        }
        setPressedNotes(new Set());
        mouseNote.current = null;
    };

    // ── Rendering ─────────────────────────────────────────────────────────────

    const currentOctaveFirstWhite = octaveToFirstWhiteIdx(octave);

    return (
        <div
            ref={panelRef}
            className="flex h-full w-full select-none flex-col overflow-hidden rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,18,20,0.98),rgba(11,11,13,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onBlur={onBlur}
            aria-label="Virtual Piano Keyboard"
            role="application"
        >
            <DawHeaderBand
                compact
                title="Virtual keyboard"
                titleClassName="text-white/56"
                className="border-b border-white/[0.06] bg-black/[0.16]"
                actions={
                    onClose ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={onClose}
                                    aria-label="Close virtual keyboard"
                                    className="text-white/40 hover:text-white"
                                >
                                    <X className="size-3" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Close keyboard</TooltipContent>
                        </Tooltip>
                    ) : null
                }
            >
                <DawInlineHint className="hidden bg-black/[0.2] font-mono text-white/30 md:inline-flex">
                    A…; white · W E T Y U O P black · Z/X octave
                </DawInlineHint>
            </DawHeaderBand>

            <DawControlStrip className="justify-end border-b border-white/[0.04] bg-black/[0.12] px-2.5 py-1.5">
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                    <span className="text-[9px] uppercase tracking-wider text-white/40 mr-0.5">Oct</span>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setVirtualKeyboardOctave(octave - 1)}
                                aria-label="Octave down"
                                disabled={octave <= 0}
                                className="text-white/60 hover:text-white"
                            >
                                <ChevronLeft className="size-3" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Octave down (Z)</TooltipContent>
                    </Tooltip>
                    <span className="text-[11px] font-semibold tabular-nums w-5 text-center text-white/90">
                        {octave}
                    </span>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setVirtualKeyboardOctave(octave + 1)}
                                aria-label="Octave up"
                                disabled={octave >= 8}
                                className="text-white/60 hover:text-white"
                            >
                                <ChevronRight className="size-3" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Octave up (X)</TooltipContent>
                    </Tooltip>

                    <div className="w-px h-3.5 bg-white/10 mx-1" />

                    <Minus className="size-2.5 text-white/30 shrink-0" />
                    <Slider
                        value={[velocity]}
                        min={1}
                        max={127}
                        step={1}
                        className="w-16"
                        trackClassName="h-1 bg-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]"
                        rangeClassName="[background:linear-gradient(180deg,rgba(170,135,200,0.95)_0%,rgba(170,135,200,0.62)_100%)] shadow-[0_0_10px_rgba(170,135,200,0.18)]"
                        thumbClassName="size-3 rounded-[3px] hover:ring-[rgba(170,135,200,0.28)] focus-visible:ring-[rgba(170,135,200,0.38)]"
                        aria-label="Note velocity"
                        onValueChange={(values) => {
                            const nextValue = values[0];
                            if (nextValue !== undefined) {
                                setVirtualKeyboardVelocity(nextValue);
                            }
                        }}
                    />
                    <Plus className="size-2.5 text-white/30 shrink-0" />
                    <span className="text-[9px] tabular-nums text-white/40 w-5 text-right">{velocity}</span>
                </div>
            </DawControlStrip>

            <DawDisplaySurface className="min-h-0 flex-1 items-stretch justify-start rounded-none border-t border-white/[0.03] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0.08))] p-0">
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-x-auto overflow-y-hidden"
                    style={{ scrollbarWidth: 'none' }}
                >
                    <div className="relative h-full" style={{ width: TOTAL_WIDTH_PX, minHeight: '100%' }}>
                        <div className="absolute inset-0 flex">
                            {Array.from({ length: TOTAL_WHITE_KEYS }, (_, whiteIdx) => {
                                const midiNote = whiteIdxToMidi(whiteIdx);
                                const semitone = ((midiNote % 12) + 12) % 12;
                                const isC = semitone === 0;
                                const isValid = midiNote >= 0 && midiNote <= 127 && WHITE_KEY_SEMITONES.has(semitone);
                                const isCurrentOctaveStart =
                                    whiteIdx >= currentOctaveFirstWhite &&
                                    whiteIdx < currentOctaveFirstWhite + WHITES_PER_OCT;
                                const isPressed = pressedNotes.has(midiNote);
                                const displayOctave = Math.floor(midiNote / 12) - 1;

                                return (
                                    <div
                                        key={whiteIdx}
                                        className={cn(
                                            'relative shrink-0 border-r flex flex-col justify-end items-center pb-1 cursor-pointer',
                                            isPressed
                                                ? 'bg-[var(--color-accent-lavender)]/50 border-r-[var(--color-accent-lavender)]/40'
                                                : isCurrentOctaveStart
                                                  ? 'bg-[oklch(0.97_0.005_260)] hover:bg-[oklch(0.91_0.01_260)] border-r-neutral-300'
                                                  : 'bg-[oklch(0.94_0_0)] hover:bg-[oklch(0.88_0_0)] border-r-neutral-300'
                                        )}
                                        style={{
                                            width: KEY_W,
                                            boxShadow:
                                                'inset -1px 0 0 rgba(0,0,0,0.08), inset 0 -2px 4px rgba(0,0,0,0.06)',
                                        }}
                                        onPointerDown={
                                            isValid ? (event) => onWhitePointerDown(midiNote, event) : undefined
                                        }
                                        onPointerUp={isValid ? (event) => onWhitePointerUp(midiNote, event) : undefined}
                                        onPointerEnter={
                                            isValid ? (event) => onWhitePointerEnter(midiNote, event) : undefined
                                        }
                                        aria-label={isC ? `C${displayOctave} (MIDI ${midiNote})` : `MIDI ${midiNote}`}
                                        role="button"
                                    >
                                        {isC ? (
                                            <span
                                                className="text-[8px] font-medium select-none pointer-events-none leading-none"
                                                style={{
                                                    color: isPressed ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.35)',
                                                }}
                                            >
                                                C{displayOctave}
                                            </span>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>

                        {ALL_BLACK_KEYS.map(({ midi: midiNote, leftPx }) => {
                            const isPressed = pressedNotes.has(midiNote);
                            return (
                                <div
                                    key={midiNote}
                                    className={cn(
                                        'absolute top-0 z-10 rounded-b-[3px] cursor-pointer',
                                        isPressed
                                            ? 'bg-[var(--color-accent-lavender)]'
                                            : 'bg-[oklch(0.12_0_0)] hover:bg-[oklch(0.2_0_0)]'
                                    )}
                                    style={{
                                        left: leftPx,
                                        width: BLACK_KEY_W,
                                        height: `${BLACK_KEY_H_RATIO * 100}%`,
                                        boxShadow: isPressed
                                            ? '0 3px 10px rgba(139,92,246,0.7), inset 0 -1px 0 rgba(255,255,255,0.1)'
                                            : '1px 3px 6px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.06)',
                                    }}
                                    onPointerDown={(event) => onBlackPointerDown(midiNote, event)}
                                    onPointerUp={(event) => onBlackPointerUp(midiNote, event)}
                                    onPointerEnter={(event) => onBlackPointerEnter(midiNote, event)}
                                    aria-label={`MIDI ${midiNote}`}
                                    role="button"
                                />
                            );
                        })}
                    </div>
                </div>
            </DawDisplaySurface>
        </div>
    );
};
