/**
 * VirtualKeyboard — Logic Pro–style on-screen piano keyboard.
 *
 * Layout strategy:
 * - Each white key is a fixed 28px wide. The full keyboard is 9 octaves = 63 whites + C8 = 64 whites = 1792px total.
 * - Black keys are absolutely positioned over the white key row using exact pixel math.
 * - The keyboard container scrolls horizontally. On mount it scrolls to show the active octave.
 * - Mouse: pointerdown = noteOn, pointerup = noteOff. Drag across keys glides. A white-key
 *   pointerdown calls setPointerCapture, so dragging off the key keeps it sounding until
 *   pointerup; re-entering the same held key does not re-trigger it. A global pointerup AND
 *   pointercancel handler releases the held note even when the gesture ends or is cancelled
 *   off the panel. Because capture retargets boundary events to the capture element, a
 *   glissando is driven by `pointermove` + hit-testing (`glideToPoint`), not by
 *   `pointerenter` on the neighbouring key — that never fires once a pointer is captured.
 * - Computer keyboard (ASDFGHJKL; = white keys, WETYUOP = black keys) fires notes only
 *   when the panel is focused. Keys are matched by physical position (event.code) so the
 *   layout works on non-QWERTY keyboards. Z/X = octave down/up.
 * - Routes through triggerLiveNoteOn/Off use cases → same path as a physical MIDI controller.
 */

import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';

import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { DawDisplaySurface } from '#/components/daw/DawDisplaySurface';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { triggerLiveNoteOn, triggerLiveNoteOff } from '#/modules/MIDI/useCases';
import { cn } from '#/utils/Styles/cn';

import { workspaceStore, defaultWorkspaceState } from '../../stores/workspaceStore';
import { setVirtualKeyboardOctave } from '../../useCases/togglePanel/panelToggles/setVirtualKeyboardOctave';
import { setVirtualKeyboardVelocity } from '../../useCases/togglePanel/panelToggles/setVirtualKeyboardVelocity';

// ─── Layout constants ─────────────────────────────────────────────────────────

/** Width of each white key in px */
const KEY_W = 28;
/** Width of each black key in px */
const BLACK_KEY_W = 16;
/** Black key height as a % of white key height */
const BLACK_KEY_H_RATIO = 0.62;

/**
 * MIDI channel passed to the live-note use cases. 0 = omni: the AudioEngine routes the
 * note to the currently selected track (see MIDI/useCases/triggerLiveNoteOn.ts).
 */
const OMNI_CHANNEL = 0;
const LIVE_NOTE_FAILURE_MESSAGE = 'Note could not be played.';

type LiveNoteOperation = 'on' | 'off';

const handleLiveNotePromise = (operation: LiveNoteOperation, promise: Promise<void>): void => {
    void promise.catch((error: unknown) => {
        logger.warn(`[MIDI] Virtual keyboard note-${operation} failed:`, error);
    });
};

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

/**
 * The seven white-key semitone offsets within an octave, in left-to-right order
 * (C D E F G A B). Single source of truth: the ordered array indexes white keys by
 * position; the Set answers white-key membership for a given semitone.
 */
const WHITE_SEMITONE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const WHITE_KEY_SEMITONES = new Set(WHITE_SEMITONE_OFFSETS);

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
    return (octave - 1) * 12 + 12 + (WHITE_SEMITONE_OFFSETS[posInOct] ?? 0);
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

// ─── Computer keyboard mappings ───────────────────────────────────────────────

/**
 * Physical-key code (event.code) → semitone offset from root C of the active octave.
 * Keying on event.code instead of event.key keeps the ASDFGHJKL; row mapped to the same
 * physical keys regardless of the OS keyboard layout (QWERTY, AZERTY, Dvorak, …).
 */
const KEYBOARD_WHITE_MAP: Record<string, number> = {
    KeyA: 0, // C
    KeyS: 2, // D
    KeyD: 4, // E
    KeyF: 5, // F
    KeyG: 7, // G
    KeyH: 9, // A
    KeyJ: 11, // B
    KeyK: 12, // C+1
    KeyL: 14, // D+1
    Semicolon: 16, // E+1
};

const KEYBOARD_BLACK_MAP: Record<string, number> = {
    KeyW: 1, // C#
    KeyE: 3, // D#
    KeyT: 6, // F#
    KeyY: 8, // G#
    KeyU: 10, // A#
    KeyO: 13, // C#+1
    KeyP: 15, // D#+1
};

/** Physical-key codes for octave down / up (Z / X). */
const OCTAVE_DOWN_CODE = 'KeyZ';
const OCTAVE_UP_CODE = 'KeyX';

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
    const [liveNoteStatus, setLiveNoteStatus] = useState<string | null>(null);
    /**
     * Latest pressedNotes, mirrored into a ref so teardown handlers (unmount cleanup,
     * visibilitychange→hidden, window.blur) release the notes that are actually held now
     * instead of an empty set.
     *
     * The ref is written SYNCHRONOUSLY by setPressed — the single write path for the
     * held-note set — in the same step as setPressedNotes, so it is never stale relative
     * to the state even before React commits or flushes effects. A teardown event that
     * fires between a note-on and the next commit therefore still sees the held note.
     */
    const pressedNotesRef = useRef<Set<number>>(pressedNotes);
    /**
     * Update the held-note set and its ref atomically. Writing the ref in the same
     * synchronous tick as setPressedNotes keeps pressedNotesRef.current current the instant
     * a note is added or removed, which is what makes teardown release deterministic. Every
     * mutation of pressedNotes goes through here so the ref and the state cannot diverge.
     */
    const setPressed = (updater: (prev: Set<number>) => Set<number>) => {
        const next = updater(pressedNotesRef.current);
        pressedNotesRef.current = next;
        setPressedNotes(next);
    };
    const mouseNote = useRef<number | null>(null);
    const heldKeys = useRef<Set<string>>(new Set());
    /**
     * MIDI note each held computer-keyboard key fired on, captured at noteOn time.
     * keyup releases the exact note that was started, so an octave shift (Z/X) while a key
     * is held does not leak the original noteOn by computing a noteOff at the new octave.
     */
    const heldKeyNotes = useRef<Map<string, number>>(new Map());
    // Prevent a late rejection from rolling back a newer press of the same MIDI note.
    const pendingNoteOnAttemptsRef = useRef<Map<number, symbol>>(new Map());

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
        const attempt = Symbol();
        pendingNoteOnAttemptsRef.current.set(midiNote, attempt);
        void (async () => {
            try {
                await triggerLiveNoteOn(OMNI_CHANNEL, midiNote, velocity);
                if (pendingNoteOnAttemptsRef.current.get(midiNote) === attempt) {
                    pendingNoteOnAttemptsRef.current.delete(midiNote);
                }
                // A note played: the engine has recovered, so clear any lingering failure
                // banner and restore the keyboard-shortcut hint.
                setLiveNoteStatus(null);
            } catch (error: unknown) {
                logger.warn('[MIDI] Virtual keyboard note-on failed:', error);
                if (pendingNoteOnAttemptsRef.current.get(midiNote) !== attempt) {
                    return;
                }
                pendingNoteOnAttemptsRef.current.delete(midiNote);
                setPressed((prev) => {
                    if (!prev.has(midiNote)) {
                        return prev;
                    }
                    const next = new Set(prev);
                    next.delete(midiNote);
                    return next;
                });
                // Defense in depth: the engine un-registers a note whose awaited processing
                // rejected, but a synchronous failure after registration would still leak it.
                handleLiveNotePromise('off', triggerLiveNoteOff(OMNI_CHANNEL, midiNote));
                setLiveNoteStatus((current) => current ?? LIVE_NOTE_FAILURE_MESSAGE);
            }
        })();
        setPressed((prev) => {
            if (prev.has(midiNote)) {
                return prev;
            }
            const next = new Set(prev);
            next.add(midiNote);
            return next;
        });
    };

    const triggerNoteOff = (midiNote: number) => {
        pendingNoteOnAttemptsRef.current.delete(midiNote);
        handleLiveNotePromise('off', triggerLiveNoteOff(OMNI_CHANNEL, midiNote));
        setPressed((prev) => {
            if (!prev.has(midiNote)) {
                return prev;
            }
            const next = new Set(prev);
            next.delete(midiNote);
            return next;
        });
    };

    // ── Mouse interaction ─────────────────────────────────────────────────────

    /**
     * Glide the held mouse note to `midiNote` while the primary button is down.
     * Re-entering the note that is already sounding (mouseNote.current) is a no-op, so dragging
     * off a key and back onto it — including across an overlapping black key — sustains the note
     * instead of re-triggering a fresh noteOff/noteOn.
     */
    const glideTo = (midiNote: number, event: React.PointerEvent<HTMLDivElement>) => {
        if (event.buttons !== 1 || mouseNote.current === null || mouseNote.current === midiNote) {
            return;
        }
        triggerNoteOff(mouseNote.current);
        mouseNote.current = midiNote;
        triggerNoteOn(midiNote);
    };

    /**
     * Resolve the key under a viewport point via hit-testing.
     *
     * `onWhitePointerDown` calls `setPointerCapture`, and per W3C Pointer Events a
     * captured pointer retargets boundary events to the capture element — so no
     * neighbouring key ever receives `pointerenter` and `onWhitePointerEnter` never
     * fires. Capture is load-bearing (it is what guarantees the note is released even
     * if the gesture ends off the panel), so gliding is driven off `pointermove`
     * coordinates instead. `elementFromPoint` is a plain hit-test, unaffected by
     * capture, and respects z-order, so an overlapping black key wins over the white
     * key beneath it exactly as a real hover would.
     */
    const midiNoteAtPoint = (clientX: number, clientY: number): number | null => {
        const hit = document.elementFromPoint(clientX, clientY);
        const key = hit?.closest<HTMLElement>('[data-midi-note]');
        if (!key) {
            return null;
        }
        const parsed = Number(key.dataset.midiNote);
        if (!Number.isInteger(parsed)) {
            return null;
        }
        return parsed;
    };

    /** Glide the held note to whichever key the pointer is currently over. */
    const glideToPoint = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.buttons !== 1 || mouseNote.current === null) {
            return;
        }
        const midiNote = midiNoteAtPoint(event.clientX, event.clientY);
        if (midiNote === null || midiNote === mouseNote.current) {
            return;
        }
        triggerNoteOff(mouseNote.current);
        mouseNote.current = midiNote;
        triggerNoteOn(midiNote);
    };

    const onWhitePointerDown = (midiNote: number, event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
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
        glideTo(midiNote, event);
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
        glideTo(midiNote, event);
    };

    // Release the held mouse note on global pointer-up (handles releasing outside the panel)
    // and on pointer-cancel. A touch/pen pointer interrupted by the browser (OS gesture
    // takeover, palm rejection, pointer-capture loss) fires `pointercancel` — not `pointerup`
    // — so without this the started noteOn would leak an audible hung note.
    useEffect(() => {
        const onGlobalRelease = () => {
            if (mouseNote.current !== null) {
                triggerNoteOff(mouseNote.current);
                mouseNote.current = null;
            }
        };
        window.addEventListener('pointerup', onGlobalRelease);
        window.addEventListener('pointercancel', onGlobalRelease);
        return () => {
            window.removeEventListener('pointerup', onGlobalRelease);
            window.removeEventListener('pointercancel', onGlobalRelease);
        };
    }, []);

    // ── Computer keyboard ─────────────────────────────────────────────────────

    /**
     * True when a key event bubbled up from a control that owns its own keyboard handling
     * (the velocity slider). Such events must not be interpreted as note/octave input.
     */
    const isFromIgnoredControl = (event: React.KeyboardEvent<HTMLDivElement>): boolean => {
        const target = event.target as HTMLElement | null;
        return Boolean(target?.closest('[data-vk-ignore-keys]'));
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
            return;
        }
        if (isFromIgnoredControl(event)) {
            return;
        }
        const code = event.code;

        if (code === OCTAVE_DOWN_CODE) {
            event.preventDefault();
            // Guard OS key-repeat so a held Z/X shifts the octave once per physical press.
            if (event.repeat) {
                return;
            }
            setVirtualKeyboardOctave(octave - 1);
            return;
        }
        if (code === OCTAVE_UP_CODE) {
            event.preventDefault();
            if (event.repeat) {
                return;
            }
            setVirtualKeyboardOctave(octave + 1);
            return;
        }

        if (heldKeys.current.has(code)) {
            return;
        }

        const whiteSemi = KEYBOARD_WHITE_MAP[code];
        if (whiteSemi !== undefined) {
            event.preventDefault();
            heldKeys.current.add(code);
            const midiNote = (octave + 1) * 12 + whiteSemi;
            heldKeyNotes.current.set(code, midiNote);
            triggerNoteOn(midiNote);
            return;
        }
        const blackSemi = KEYBOARD_BLACK_MAP[code];
        if (blackSemi !== undefined) {
            event.preventDefault();
            heldKeys.current.add(code);
            const midiNote = (octave + 1) * 12 + blackSemi;
            heldKeyNotes.current.set(code, midiNote);
            triggerNoteOn(midiNote);
        }
    };

    const onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isFromIgnoredControl(event)) {
            return;
        }
        const code = event.code;
        heldKeys.current.delete(code);

        // Release the exact note this key fired on, not one recomputed at the current octave,
        // so an octave shift while the key was held cannot leak the original noteOn.
        const heldNote = heldKeyNotes.current.get(code);
        if (heldNote !== undefined) {
            heldKeyNotes.current.delete(code);
            triggerNoteOff(heldNote);
        }
    };

    /**
     * Release every sounding note and clear all held-key bookkeeping. Reads the live
     * pressedNotes via the ref so it works from teardown handlers whose closures predate
     * the current pressed set. Calling triggerLiveNoteOff directly (not triggerNoteOff)
     * avoids one setState per note; the single setPressedNotes(new Set()) settles UI state.
     */
    const releaseAllHeldNotes = () => {
        heldKeys.current.clear();
        heldKeyNotes.current.clear();
        pendingNoteOnAttemptsRef.current.clear();
        for (const midiNote of pressedNotesRef.current) {
            handleLiveNotePromise('off', triggerLiveNoteOff(OMNI_CHANNEL, midiNote));
        }
        if (pressedNotesRef.current.size > 0) {
            setPressed(() => new Set());
        }
        mouseNote.current = null;
    };

    const onBlur = () => {
        releaseAllHeldNotes();
    };

    // Release all held notes when the component unmounts, the tab is hidden, or the window
    // loses focus — otherwise a note held at that moment leaks a noteOn the matching keyup
    // never fires for (an audible hung note). visibilitychange + window blur cover tab
    // switches and app focus loss; the cleanup covers unmount. Empty deps: the handler reads
    // live state through pressedNotesRef, so it never needs to re-subscribe.
    useEffect(() => {
        const pendingNoteOnAttempts = pendingNoteOnAttemptsRef.current;
        const releaseOnHidden = () => {
            if (document.visibilityState === 'hidden') {
                releaseAllHeldNotes();
            }
        };
        document.addEventListener('visibilitychange', releaseOnHidden);
        window.addEventListener('blur', releaseAllHeldNotes);
        return () => {
            document.removeEventListener('visibilitychange', releaseOnHidden);
            window.removeEventListener('blur', releaseAllHeldNotes);
            pendingNoteOnAttempts.clear();
            // Final teardown: silence anything still sounding so unmount cannot leave a hung note.
            for (const midiNote of pressedNotesRef.current) {
                handleLiveNotePromise('off', triggerLiveNoteOff(OMNI_CHANNEL, midiNote));
            }
        };
    }, []);

    // ── Rendering ─────────────────────────────────────────────────────────────

    const currentOctaveFirstWhite = octaveToFirstWhiteIdx(octave);

    return (
        <div
            ref={panelRef}
            className="flex h-full w-full select-none flex-col overflow-hidden rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,18,20,0.98),rgba(11,11,13,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none"
            // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- application role requires programmatic focus for keyboard input
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
                <DawInlineHint
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className={cn(
                        'font-mono',
                        liveNoteStatus === null
                            ? 'hidden bg-black/[0.2] text-white/30 md:inline-flex'
                            : 'inline-flex bg-[var(--color-state-danger)]/10 text-[var(--color-state-danger)]'
                    )}
                >
                    {liveNoteStatus ?? 'A…; white · W E T Y U O P black · Z/X octave'}
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
                    {/* Marked so the panel onKeyDown/onKeyUp ignore key events that originate
                        inside the velocity slider — otherwise a mapped key (e.g. A) typed while
                        the slider thumb is focused would bubble up and fire a spurious note. */}
                    <span style={{ display: 'contents' }} data-vk-ignore-keys="">
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
                    </span>
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

                                let keyClasses = 'bg-[oklch(0.94_0_0)] hover:bg-[oklch(0.88_0_0)] border-r-neutral-300';
                                if (isPressed) {
                                    keyClasses =
                                        'bg-[var(--color-accent-lavender)]/50 border-r-[var(--color-accent-lavender)]/40';
                                } else if (isCurrentOctaveStart) {
                                    keyClasses =
                                        'bg-[oklch(0.97_0.005_260)] hover:bg-[oklch(0.91_0.01_260)] border-r-neutral-300';
                                }

                                return (
                                    <div
                                        key={whiteIdx}
                                        className={cn(
                                            'relative shrink-0 border-r flex flex-col justify-end items-center pb-1 cursor-pointer',
                                            keyClasses
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
                                        // Pointer capture retargets every move to this key, so this
                                        // handler — not the neighbour's pointerenter — is what drives
                                        // a glissando that began on a white key.
                                        onPointerMove={isValid ? glideToPoint : undefined}
                                        data-midi-note={midiNote}
                                        aria-label={isC ? `C${displayOctave} (MIDI ${midiNote})` : `MIDI ${midiNote}`}
                                        aria-pressed={isPressed}
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
                                    onPointerMove={glideToPoint}
                                    data-midi-note={midiNote}
                                    aria-label={`MIDI ${midiNote}`}
                                    aria-pressed={isPressed}
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
