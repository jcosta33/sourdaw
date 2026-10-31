import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { cancelActiveTimelineGesture } from '#/modules/Arrangement/useCases';
import { resumeEngine } from '#/modules/AudioEngine/useCases';
import { triggerLiveNoteOff, triggerLiveNoteOn } from '#/modules/MIDI/useCases';
import { setVirtualKeyboardOctave } from '#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/setVirtualKeyboardOctave';
import { setVirtualKeyboardVelocity } from '#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/setVirtualKeyboardVelocity';
import { beginDragGesture } from '#/utils/UI/activeDragGesture';

import { VirtualKeyboard } from '../VirtualKeyboard';

// Controllable workspace state so individual tests can drive octave/velocity.
const workspaceState = {
    virtualKeyboardOctave: 4,
    virtualKeyboardVelocity: 100,
};

const loggerWarn = vi.hoisted(() => vi.fn());

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => workspaceState),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: loggerWarn },
}));

// Mock the exact module-ids the component imports from. MIDI stays a cross-module
// barrel (`#/modules/MIDI/useCases`); the octave/velocity use cases now live in this
// module and the component imports them directly from their per-file paths (same-module
// relative imports), so the mocks target those files rather than the `useCases` barrel.
// Mocking the file the component imports directly makes interception independent of load
// order.
//
// The factories provide only the exports the component consumes and do NOT spread
// importOriginal: evaluating the real MIDI barrel drags in the audio engine / WASM init,
// which never settles under jsdom and hangs the run. A minimal surface keeps the test
// deterministic.
vi.mock('#/modules/MIDI/useCases', () => ({
    triggerLiveNoteOn: vi.fn(() => Promise.resolve()),
    triggerLiveNoteOff: vi.fn(() => Promise.resolve()),
}));

// The real barrels pull in the engine and timeline, which never settle under jsdom.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    cancelActiveTimelineGesture: vi.fn(() => false),
}));

vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/setVirtualKeyboardOctave', () => ({
    setVirtualKeyboardOctave: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/setVirtualKeyboardVelocity', () => ({
    setVirtualKeyboardVelocity: vi.fn(),
}));

// Mock UI components
vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, actions, children }: any) => (
        <div data-testid="daw-header-band">
            <span>{title}</span>
            {children}
            {actions}
        </div>
    ),
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="daw-control-strip">{children}</div>
    ),
}));

vi.mock('#/components/daw/DawDisplaySurface', () => ({
    DawDisplaySurface: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="daw-display-surface">{children}</div>
    ),
}));

vi.mock('#/components/daw/DawInlineHint', () => ({
    DawInlineHint: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        <div data-testid="daw-inline-hint" {...props}>
            {children}
        </div>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick, 'aria-label': ariaLabel }: any) => (
        <button onClick={onClick} aria-label={ariaLabel}>
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Radix renders the thumb as a focusable span with role="slider" that handles arrow keys
// itself; the mock keeps that shape so the key-capture rules see a real slider target.
vi.mock('#/components/ui/slider', () => ({
    Slider: ({ value, onValueChange, 'aria-label': ariaLabel }: any) => (
        <span
            role="slider"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-valuenow={value?.[0] || 0}
            data-testid="velocity-slider"
            onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                    onValueChange?.([(value?.[0] || 0) + 1]);
                }
                if (event.key === 'ArrowLeft') {
                    onValueChange?.([(value?.[0] || 0) - 1]);
                }
            }}
        />
    ),
}));

describe('VirtualKeyboard', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        workspaceState.virtualKeyboardOctave = 4;
        workspaceState.virtualKeyboardVelocity = 100;
    });

    it('should render without crashing', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByTestId('daw-header-band')).toBeInTheDocument();
    });

    it('should display virtual keyboard title', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByText(/Virtual keyboard/i)).toBeInTheDocument();
    });

    it('should render control strip', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByTestId('daw-control-strip')).toBeInTheDocument();
    });

    it('should render display surface', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByTestId('daw-display-surface')).toBeInTheDocument();
    });

    it('should display octave controls', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByLabelText(/Octave down/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Octave up/i)).toBeInTheDocument();
    });

    it('should display current octave', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('should render close button when onClose is provided', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByLabelText(/Close virtual keyboard/i)).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        const closeButton = screen.getByLabelText(/Close virtual keyboard/i);
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should render without close button when onClose is not provided', () => {
        render(<VirtualKeyboard />);
        expect(screen.queryByLabelText(/Close virtual keyboard/i)).not.toBeInTheDocument();
    });

    it('should render keyboard hint', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByTestId('daw-inline-hint')).toBeInTheDocument();
    });

    // ── Regression: computer-keyboard input / octave / glide / slider ──────────────

    describe('computer keyboard input', () => {
        const onMock = vi.mocked(triggerLiveNoteOn);
        const offMock = vi.mocked(triggerLiveNoteOff);
        const setOctaveMock = vi.mocked(setVirtualKeyboardOctave);

        // The panel owns the computer keyboard globally, so events land on the body.
        const panel = () => document.body;

        // Fix #5 + #1: the home-row 'A' key plays the same display octave the keyboard
        // scrolls to/labels. With active octave 4 (which scrolls to C4 = MIDI 60), pressing
        // A must fire MIDI 60 — not MIDI 48 (the old `octave * 12` off-by-one).
        it('plays C of the active display octave for the A key (no off-by-one)', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(panel(), { code: 'KeyA' });
            expect(onMock).toHaveBeenCalledTimes(1);
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
        });

        // Fix #1: an octave shift while a key is held must not leak the original noteOn.
        // keyup releases the exact MIDI note keydown fired, regardless of the current octave.
        it('releases the exact note fired at keydown even after the octave changes', () => {
            const { rerender } = render(<VirtualKeyboard />);
            // Press A at octave 4 → MIDI 60.
            fireEvent.keyDown(panel(), { code: 'KeyA' });
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);

            // Octave shifts up while A is still held.
            workspaceState.virtualKeyboardOctave = 5;
            rerender(<VirtualKeyboard />);

            // Releasing A must turn off MIDI 60 (the note that was started), not MIDI 72.
            fireEvent.keyUp(panel(), { code: 'KeyA' });
            expect(offMock).toHaveBeenCalledTimes(1);
            expect(offMock).toHaveBeenCalledWith(0, 60);
        });

        // Fix #2: an OS key-repeat on Z/X (event.repeat) must not sweep the octave.
        it('shifts the octave once per X press and ignores key-repeat', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(panel(), { code: 'KeyX' }); // octave up: real press
            fireEvent.keyDown(panel(), { code: 'KeyX', repeat: true }); // OS auto-repeat
            fireEvent.keyDown(panel(), { code: 'KeyX', repeat: true });
            expect(setOctaveMock).toHaveBeenCalledTimes(1);
            expect(setOctaveMock).toHaveBeenCalledWith(5);
        });

        it('shifts the octave down once per Z press and ignores key-repeat', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(panel(), { code: 'KeyZ' }); // octave down: real press
            fireEvent.keyDown(panel(), { code: 'KeyZ', repeat: true }); // OS auto-repeat
            expect(setOctaveMock).toHaveBeenCalledTimes(1);
            expect(setOctaveMock).toHaveBeenCalledWith(3);
        });

        // A held key must not re-fire noteOn on OS key-repeat (heldKeys dedup).
        it('does not re-trigger a note when a mapped key auto-repeats while held', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(panel(), { code: 'KeyA' });
            expect(onMock).toHaveBeenCalledTimes(1);
            // OS auto-repeat on the same physical key — heldKeys guard suppresses it.
            fireEvent.keyDown(panel(), { code: 'KeyA', repeat: true });
            fireEvent.keyDown(panel(), { code: 'KeyA', repeat: true });
            expect(onMock).toHaveBeenCalledTimes(1);
        });

        it('releases a held note on keyup even when focus has moved into a text field', () => {
            render(<VirtualKeyboard />);
            const input = document.createElement('input');
            document.body.append(input);
            fireEvent.keyDown(panel(), { code: 'KeyA' });
            offMock.mockClear();
            fireEvent.keyUp(input, { code: 'KeyA' });
            expect(offMock).toHaveBeenCalledTimes(1);
            expect(offMock).toHaveBeenCalledWith(0, 60);
        });

        // Fix #3a: keys are matched on physical position (event.code), so a non-QWERTY
        // event.key value does not break the mapping.
        it('maps notes by physical key code, not the produced character', () => {
            render(<VirtualKeyboard />);
            // AZERTY: the physical 'A' position (code KeyA) emits key 'q'. Code-based
            // mapping must still fire C of the active octave.
            fireEvent.keyDown(panel(), { code: 'KeyA', key: 'q' });
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
        });

        // Fix #3b: Shift+mapped-key must not fire a note (shiftKey is in the modifier bail).
        // key 'A' is the Shift-produced character of the KeyA position, so the modifier bail —
        // not a missing key match — is what suppresses the note.
        it('does not fire a note when Shift is held', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(panel(), { code: 'KeyA', key: 'A', shiftKey: true });
            expect(onMock).not.toHaveBeenCalled();
        });

        // The VK owns the computer keyboard wherever focus is: a mapped key typed while the
        // velocity slider thumb is focused plays the note rather than being lost.
        it('plays mapped keys even when the velocity slider has focus', () => {
            render(<VirtualKeyboard />);
            const slider = screen.getByTestId('velocity-slider');
            fireEvent.keyDown(slider, { code: 'KeyA', key: 'a' });
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
        });

        // The workspace velocity is applied to the noteOn, not a hard-coded default — a note
        // fired at velocity 40 must carry 40 to the AudioEngine use case.
        it('applies the current workspace velocity to the noteOn', () => {
            workspaceState.virtualKeyboardVelocity = 40;
            render(<VirtualKeyboard />);
            fireEvent.keyDown(panel(), { code: 'KeyA' });
            expect(onMock).toHaveBeenCalledWith(0, 60, 40);
        });

        it('rolls back rejected note-ons and announces one visible failure status', async () => {
            const firstError = new Error('first note-on failed');
            const secondError = new Error('second note-on failed');
            onMock.mockRejectedValueOnce(firstError).mockRejectedValueOnce(secondError);
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');

            fireEvent.keyDown(panel(), { code: 'KeyA' });

            expect(c4).toHaveAttribute('aria-pressed', 'true');
            await waitFor(() => {
                expect(c4).toHaveAttribute('aria-pressed', 'false');
            });
            expect(offMock).toHaveBeenCalledWith(0, 60);

            const status = screen.getByRole('status');
            expect(status).toHaveAttribute('aria-live', 'polite');
            expect(status).toHaveAttribute('aria-atomic', 'true');
            expect(status).toHaveTextContent('Note could not be played.');
            expect(status).not.toHaveClass('hidden');

            fireEvent.keyDown(panel(), { code: 'KeyS' });

            await waitFor(() => {
                expect(screen.getByLabelText('MIDI 62')).toHaveAttribute('aria-pressed', 'false');
            });
            expect(offMock).toHaveBeenCalledWith(0, 62);
            expect(screen.getAllByRole('status')).toHaveLength(1);
            expect(screen.getAllByText('Note could not be played.')).toHaveLength(1);
            expect(loggerWarn).toHaveBeenNthCalledWith(1, '[MIDI] Virtual keyboard note-on failed:', firstError);
            expect(loggerWarn).toHaveBeenNthCalledWith(2, '[MIDI] Virtual keyboard note-on failed:', secondError);
        });

        // A failure banner is not permanent: once the engine recovers and a later note-on
        // resolves, the status must fall back to the keyboard-shortcut hint — otherwise the
        // error text shadows the hint for the rest of the component's lifetime.
        it('clears the failure status once a later note-on succeeds', async () => {
            onMock.mockRejectedValueOnce(new Error('note-on failed'));
            render(<VirtualKeyboard />);

            fireEvent.keyDown(panel(), { code: 'KeyA' }); // C4 = 60, rejected

            await waitFor(() => {
                expect(screen.getByRole('status')).toHaveTextContent('Note could not be played.');
            });

            fireEvent.keyDown(panel(), { code: 'KeyS' }); // D4 = 62, resolves

            await waitFor(() => {
                expect(screen.getByRole('status')).not.toHaveTextContent('Note could not be played.');
            });
            expect(screen.getByRole('status')).toHaveTextContent('Z/X octave');
        });

        it('does not let a stale note-on rejection roll back a newer press', async () => {
            const staleError = new Error('stale note-on failed');
            let rejectStaleNoteOn!: (reason?: unknown) => void;
            onMock
                .mockImplementationOnce(
                    () =>
                        new Promise<void>((_resolve, reject) => {
                            rejectStaleNoteOn = reject;
                        })
                )
                .mockResolvedValueOnce(undefined);
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');

            fireEvent.keyDown(panel(), { code: 'KeyA' });
            fireEvent.keyUp(panel(), { code: 'KeyA' });
            offMock.mockClear();
            fireEvent.keyDown(panel(), { code: 'KeyA' });
            rejectStaleNoteOn(staleError);

            await waitFor(() => {
                expect(loggerWarn).toHaveBeenCalledWith('[MIDI] Virtual keyboard note-on failed:', staleError);
            });
            expect(c4).toHaveAttribute('aria-pressed', 'true');
            expect(offMock).not.toHaveBeenCalled();
            expect(screen.getByRole('status')).not.toHaveTextContent('Note could not be played.');
        });

        it('handles a note-off rejection without delaying the released state', async () => {
            const error = new Error('note-off failed');
            render(<VirtualKeyboard />);
            const note = screen.getByLabelText('C4 (MIDI 60)');

            fireEvent.keyDown(panel(), { code: 'KeyA' });
            offMock.mockRejectedValueOnce(error);
            fireEvent.keyUp(panel(), { code: 'KeyA' });

            expect(note).toHaveAttribute('aria-pressed', 'false');
            await waitFor(() => {
                expect(loggerWarn).toHaveBeenCalledWith('[MIDI] Virtual keyboard note-off failed:', error);
            });
        });
    });

    describe('mouse glide', () => {
        const onMock = vi.mocked(triggerLiveNoteOn);
        const offMock = vi.mocked(triggerLiveNoteOff);

        /**
         * jsdom implements no layout, so `document.elementFromPoint` does not exist on it
         * at all. Install a stub that reports the key the cursor is notionally over —
         * that is the hit-test the browser performs and the production code depends on.
         */
        const stubHitTestReturning = (element: Element): (() => void) => {
            const hitTest = vi.fn(() => element);
            Object.defineProperty(document, 'elementFromPoint', {
                value: hitTest,
                configurable: true,
                writable: true,
            });
            return () => {
                Reflect.deleteProperty(document, 'elementFromPoint');
            };
        };

        // Fix #4: dragging off a held key and re-entering it must sustain the note,
        // not re-trigger a fresh noteOff/noteOn for the note already sounding.
        it('does not re-trigger the note when re-entering the already-sounding key', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');

            fireEvent.pointerDown(c4, { pointerId: 1 });
            expect(onMock).toHaveBeenCalledTimes(1);
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
            onMock.mockClear();
            offMock.mockClear();

            // Drag still held (buttons=1) back onto the same key.
            fireEvent.pointerEnter(c4, { buttons: 1 });

            expect(onMock).not.toHaveBeenCalled();
            expect(offMock).not.toHaveBeenCalled();
        });

        // Fix (audit F1): a drag that STARTS on a white key calls setPointerCapture, and
        // per W3C Pointer Events a captured pointer retargets boundary events to the
        // capture element — so the neighbouring key never receives `pointerenter` and the
        // glide was silently dead. jsdom models neither capture nor retargeting, so both
        // are simulated explicitly: every move is dispatched on the *captured* key while
        // `elementFromPoint` reports the key actually under the cursor.
        it('glides to the neighbouring key when the drag started on a white key (captured pointer)', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            const d4 = screen.getByLabelText('MIDI 62');

            fireEvent.pointerDown(c4, { pointerId: 1 });
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
            onMock.mockClear();
            offMock.mockClear();

            const restoreHitTest = stubHitTestReturning(d4);
            // Retargeted to c4 (the capture element) even though the cursor is over d4.
            fireEvent.pointerMove(c4, { buttons: 1, clientX: 140, clientY: 40 });
            restoreHitTest();

            expect(offMock).toHaveBeenCalledWith(0, 60);
            expect(onMock).toHaveBeenCalledWith(0, 62, 100);
        });

        it('does not re-trigger while a captured drag stays within the sounding key', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');

            fireEvent.pointerDown(c4, { pointerId: 1 });
            onMock.mockClear();
            offMock.mockClear();

            const restoreHitTest = stubHitTestReturning(c4);
            fireEvent.pointerMove(c4, { buttons: 1, clientX: 100, clientY: 40 });
            restoreHitTest();

            expect(onMock).not.toHaveBeenCalled();
            expect(offMock).not.toHaveBeenCalled();
        });

        it('ignores a captured move with no button held', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            const d4 = screen.getByLabelText('MIDI 62');

            fireEvent.pointerDown(c4, { pointerId: 1 });
            onMock.mockClear();
            offMock.mockClear();

            const restoreHitTest = stubHitTestReturning(d4);
            fireEvent.pointerMove(c4, { buttons: 0, clientX: 140, clientY: 40 });
            restoreHitTest();

            expect(onMock).not.toHaveBeenCalled();
            expect(offMock).not.toHaveBeenCalled();
        });
    });

    describe('pointer cancellation', () => {
        const onMock = vi.mocked(triggerLiveNoteOn);
        const offMock = vi.mocked(triggerLiveNoteOff);

        // A touch/pen pointer interrupted by the browser (OS gesture takeover, palm
        // rejection, pointer-capture loss) fires `pointercancel`, NOT `pointerup`. Without a
        // global pointercancel handler the started noteOn leaks an audible hung note.
        it('releases the held mouse note on a global pointercancel', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');

            fireEvent.pointerDown(c4, { pointerId: 1 });
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
            offMock.mockClear();

            // The browser cancels the gesture instead of completing it with pointerup.
            fireEvent(window, new Event('pointercancel'));

            expect(offMock).toHaveBeenCalledTimes(1);
            expect(offMock).toHaveBeenCalledWith(0, 60);
        });
    });

    // ── Stuck-note prevention on teardown / tab hide / focus loss ───────────────────
    //
    // A note held when the component unmounts, the tab is hidden, or the window loses focus
    // has no keyup/pointerup left to release it — without teardown cleanup it leaks a noteOn
    // (an audible hung note). These assert every held note is released, deterministically.
    describe('releases held notes on teardown', () => {
        const offMock = vi.mocked(triggerLiveNoteOff);

        const panel = () => document.body;

        // Hold A (MIDI 60) and S (MIDI 62) at octave 4, then run the teardown action.
        const holdTwoNotes = () => {
            fireEvent.keyDown(panel(), { code: 'KeyA' }); // C4 = 60
            fireEvent.keyDown(panel(), { code: 'KeyS' }); // D4 = 62
        };

        const releasedNotes = () => offMock.mock.calls.map(([, note]) => note).sort((a, b) => a - b);

        it('fires noteOff for every held note when the component unmounts', () => {
            const { unmount } = render(<VirtualKeyboard />);
            holdTwoNotes();
            offMock.mockClear();

            unmount();

            expect(releasedNotes()).toEqual([60, 62]);
        });

        it('fires noteOff for every held note when the tab becomes hidden', () => {
            render(<VirtualKeyboard />);
            holdTwoNotes();
            offMock.mockClear();

            // Drive visibilitychange → hidden the way the browser would.
            const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            try {
                fireEvent(document, new Event('visibilitychange'));
            } finally {
                if (original) {
                    Object.defineProperty(document, 'visibilityState', original);
                } else {
                    Reflect.deleteProperty(document, 'visibilityState');
                }
            }

            expect(releasedNotes()).toEqual([60, 62]);
        });

        it('does not release notes on visibilitychange while the tab stays visible', () => {
            render(<VirtualKeyboard />);
            holdTwoNotes();
            offMock.mockClear();

            // visibilityState is 'visible' by default in jsdom — a spurious event must be a no-op.
            fireEvent(document, new Event('visibilitychange'));

            expect(offMock).not.toHaveBeenCalled();
        });

        it('fires noteOff for every held note when the window loses focus', () => {
            render(<VirtualKeyboard />);
            holdTwoNotes();
            offMock.mockClear();

            fireEvent(window, new Event('blur'));

            expect(releasedNotes()).toEqual([60, 62]);
        });
    });

    // ── Mouse note triggering (white keys, black keys, glide, global release) ──────
    describe('mouse note triggering', () => {
        const onMock = vi.mocked(triggerLiveNoteOn);
        const offMock = vi.mocked(triggerLiveNoteOff);

        it('fires noteOn on white-key pointerDown and noteOff on pointerUp', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            fireEvent.pointerDown(c4, { pointerId: 1 });
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
            fireEvent.pointerUp(c4, { pointerId: 1 });
            expect(offMock).toHaveBeenCalledWith(0, 60);
        });

        it('releases the previous note and fires the new one when gliding to a different white key', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            const d4 = screen.getByLabelText('MIDI 62');
            fireEvent.pointerDown(c4, { pointerId: 1 });
            onMock.mockClear();
            offMock.mockClear();
            // Glide while button held (buttons=1) onto a different key.
            fireEvent.pointerEnter(d4, { buttons: 1 });
            expect(offMock).toHaveBeenCalledWith(0, 60);
            expect(onMock).toHaveBeenCalledWith(0, 62, 100);
        });

        it('does not glide when no mouse button is held (buttons !== 1)', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            const d4 = screen.getByLabelText('MIDI 62');
            fireEvent.pointerDown(c4, { pointerId: 1 });
            onMock.mockClear();
            offMock.mockClear();
            // buttons=0 → no glide.
            fireEvent.pointerEnter(d4, { buttons: 0 });
            expect(onMock).not.toHaveBeenCalled();
            expect(offMock).not.toHaveBeenCalled();
        });

        it('switches the held mouse note when pointerDown fires on a different key', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            const d4 = screen.getByLabelText('MIDI 62');
            fireEvent.pointerDown(c4, { pointerId: 1 });
            offMock.mockClear();
            // Pressing another key while the first is still held releases the first.
            fireEvent.pointerDown(d4, { pointerId: 2 });
            expect(offMock).toHaveBeenCalledWith(0, 60);
            expect(onMock).toHaveBeenLastCalledWith(0, 62, 100);
        });

        it('fires noteOn on black-key pointerDown and stops propagation', () => {
            render(<VirtualKeyboard />);
            // C#4 = MIDI 61
            const cs4 = screen.getByLabelText('MIDI 61');
            fireEvent.pointerDown(cs4, { pointerId: 1 });
            expect(onMock).toHaveBeenCalledWith(0, 61, 100);
            fireEvent.pointerUp(cs4, { pointerId: 1 });
            expect(offMock).toHaveBeenCalledWith(0, 61);
        });

        it('releases the prior white-key note when pressing a black key', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            const cs4 = screen.getByLabelText('MIDI 61');
            fireEvent.pointerDown(c4, { pointerId: 1 });
            offMock.mockClear();
            // Pressing C#4 while C4 is held releases C4 first.
            fireEvent.pointerDown(cs4, { pointerId: 2 });
            expect(offMock).toHaveBeenCalledWith(0, 60);
            expect(onMock).toHaveBeenLastCalledWith(0, 61, 100);
        });

        it('glides from a white key to a black key while dragging', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            const cs4 = screen.getByLabelText('MIDI 61');
            fireEvent.pointerDown(c4, { pointerId: 1 });
            offMock.mockClear();
            onMock.mockClear();
            // Glide onto the black key while button is held.
            fireEvent.pointerEnter(cs4, { buttons: 1 });
            expect(offMock).toHaveBeenCalledWith(0, 60);
            expect(onMock).toHaveBeenCalledWith(0, 61, 100);
        });

        it('releases the held mouse note on a global pointerup outside the panel', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            fireEvent.pointerDown(c4, { pointerId: 1 });
            offMock.mockClear();
            // Release outside the panel — only the global handler catches it.
            fireEvent(window, new Event('pointerup'));
            expect(offMock).toHaveBeenCalledWith(0, 60);
        });

        it('does not double-release when pointerUp fires on a different key than the one held', () => {
            render(<VirtualKeyboard />);
            const c4 = screen.getByLabelText('C4 (MIDI 60)');
            const d4 = screen.getByLabelText('MIDI 62');
            fireEvent.pointerDown(c4, { pointerId: 1 });
            offMock.mockClear();
            // The per-key handler is a no-op for D4 (mouseNote is C4), but the global
            // pointerup listener still releases the held C4 once.
            fireEvent.pointerUp(d4, { pointerId: 2 });
            expect(offMock).toHaveBeenCalledTimes(1);
            expect(offMock).toHaveBeenCalledWith(0, 60);
        });
    });

    // ── Control surface (octave buttons, velocity slider) ─────────────────────────
    describe('control surface', () => {
        const setOctaveMock = vi.mocked(setVirtualKeyboardOctave);
        const setVelocityMock = vi.mocked(setVirtualKeyboardVelocity);

        it('shifts the octave down on the Octave-down button click', () => {
            render(<VirtualKeyboard />);
            fireEvent.click(screen.getByLabelText(/Octave down/i));
            expect(setOctaveMock).toHaveBeenCalledWith(3);
        });

        it('shifts the octave up on the Octave-up button click', () => {
            render(<VirtualKeyboard />);
            fireEvent.click(screen.getByLabelText(/Octave up/i));
            expect(setOctaveMock).toHaveBeenCalledWith(5);
        });

        it('routes the velocity slider to setVirtualKeyboardVelocity', () => {
            render(<VirtualKeyboard />);
            const slider = screen.getByTestId('velocity-slider');
            fireEvent.keyDown(slider, { key: 'ArrowLeft', code: 'ArrowLeft' });
            expect(setVelocityMock).toHaveBeenCalledWith(99);
        });
    });

    // ── Octave-shift keyboard (Z) ─────────────────────────────────────────────────
    describe('octave shift keyboard', () => {
        const setOctaveMock = vi.mocked(setVirtualKeyboardOctave);

        it('shifts the octave down once on a single Z press', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(document.body, { code: 'KeyZ' });
            expect(setOctaveMock).toHaveBeenCalledWith(3);
        });

        it('ignores modifier-suppressed octave keys', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(document.body, { code: 'KeyZ', ctrlKey: true });
            expect(setOctaveMock).not.toHaveBeenCalled();
        });

        it('releases the exact held note after an octave change on keyup', () => {
            const { rerender } = render(<VirtualKeyboard />);
            const panel = document.body;
            // Hold a black key (KeyW = C#, MIDI 61 at octave 4)
            fireEvent.keyDown(panel, { code: 'KeyW' });
            // Shift octave down via Z while W is held
            workspaceState.virtualKeyboardOctave = 3;
            rerender(<VirtualKeyboard />);
            fireEvent.keyUp(panel, { code: 'KeyW' });
            // keyup releases the original note (61), not the recomputed one (49)
            expect(vi.mocked(triggerLiveNoteOff)).toHaveBeenCalledWith(0, 61);
        });
    });

    // ── Blur ──────────────────────────────────────────────────────────────────────
    describe('window blur', () => {
        const offMock = vi.mocked(triggerLiveNoteOff);

        it('releases every held note when the window loses focus', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(document.body, { code: 'KeyA' }); // C4 = 60
            fireEvent.keyDown(document.body, { code: 'KeyS' }); // D4 = 62
            offMock.mockClear();
            fireEvent(window, new Event('blur'));
            const released = offMock.mock.calls.map(([, note]) => note).sort((a, b) => a - b);
            expect(released).toEqual([60, 62]);
        });
    });

    // ── Computer-keyboard capture while the panel is open ─────────────────────────
    describe('key capture', () => {
        const onMock = vi.mocked(triggerLiveNoteOn);
        const setOctaveMock = vi.mocked(setVirtualKeyboardOctave);
        const setVelocityMock = vi.mocked(setVirtualKeyboardVelocity);

        // A bubble-phase window listener stands in for the global shortcut layer and every
        // other window-level panel listener.
        const bubbleKeydowns: KeyboardEvent[] = [];
        const recordBubble = (event: KeyboardEvent) => {
            bubbleKeydowns.push(event);
        };

        beforeEach(() => {
            bubbleKeydowns.length = 0;
            window.addEventListener('keydown', recordBubble);
        });

        afterEach(() => {
            window.removeEventListener('keydown', recordBubble);
            document.body.replaceChildren();
        });

        it('consumes an unmapped letter so no window listener sees it', () => {
            render(<VirtualKeyboard />);
            // Registered after the keyboard mounted: a later capture listener on the same node
            // still runs after stopPropagation, so only an immediate stop hides the key from it.
            const lateCaptureKeydowns: KeyboardEvent[] = [];
            const recordLateCapture = (event: KeyboardEvent) => {
                lateCaptureKeydowns.push(event);
            };
            window.addEventListener('keydown', recordLateCapture, { capture: true });
            try {
                const notPrevented = fireEvent.keyDown(document.body, { code: 'KeyM', key: 'm' });
                expect(notPrevented).toBe(false);
                expect(lateCaptureKeydowns).toHaveLength(0);
            } finally {
                window.removeEventListener('keydown', recordLateCapture, { capture: true });
            }
            expect(bubbleKeydowns).toHaveLength(0);
            expect(onMock).not.toHaveBeenCalled();
        });

        it.each([
            ['digit', { code: 'Digit1', key: '1' }],
            ['space', { code: 'Space', key: ' ' }],
            ['arrow', { code: 'ArrowLeft', key: 'ArrowLeft' }],
            ['delete', { code: 'Delete', key: 'Delete' }],
            ['question mark', { code: 'Slash', key: '?', shiftKey: true }],
            ['shifted mapped letter', { code: 'KeyA', key: 'A', shiftKey: true }],
            ['alt mapped letter', { code: 'KeyA', key: 'å', altKey: true }],
        ])('swallows %s from every other listener', (_name, init) => {
            render(<VirtualKeyboard />);
            const notPrevented = fireEvent.keyDown(document.body, init);
            expect(notPrevented).toBe(false);
            expect(bubbleKeydowns).toHaveLength(0);
            expect(onMock).not.toHaveBeenCalled();
        });

        it('consumes a musical key and plays its note', () => {
            render(<VirtualKeyboard />);
            const notPrevented = fireEvent.keyDown(document.body, { code: 'KeyA' });
            expect(notPrevented).toBe(false);
            expect(bubbleKeydowns).toHaveLength(0);
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
        });

        it('consumes the octave keys', () => {
            render(<VirtualKeyboard />);
            expect(fireEvent.keyDown(document.body, { code: 'KeyX' })).toBe(false);
            expect(bubbleKeydowns).toHaveLength(0);
            expect(setOctaveMock).toHaveBeenCalledWith(5);
        });

        it('plays a note when a non-editable element has focus', () => {
            render(<VirtualKeyboard />);
            const outside = document.createElement('div');
            document.body.append(outside);
            fireEvent.keyDown(outside, { code: 'KeyA' });
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
        });

        it('leaves a musical key alone when an input elsewhere in the document is the target', () => {
            render(<VirtualKeyboard />);
            const input = document.createElement('input');
            document.body.append(input);
            const notPrevented = fireEvent.keyDown(input, { code: 'KeyA', key: 'a' });
            expect(notPrevented).toBe(true);
            expect(bubbleKeydowns).toHaveLength(1);
            expect(onMock).not.toHaveBeenCalled();
        });

        it.each([
            ['textarea', () => document.createElement('textarea')],
            [
                'contenteditable',
                () => {
                    const element = document.createElement('div');
                    element.setAttribute('contenteditable', 'true');
                    return element;
                },
            ],
            ['select', () => document.createElement('select')],
            [
                'dialog descendant',
                () => {
                    const dialog = document.createElement('div');
                    dialog.setAttribute('role', 'dialog');
                    const child = document.createElement('div');
                    dialog.append(child);
                    document.body.append(dialog);
                    return child;
                },
            ],
            [
                'menu descendant',
                () => {
                    const menu = document.createElement('div');
                    menu.setAttribute('role', 'menu');
                    const child = document.createElement('div');
                    menu.append(child);
                    document.body.append(menu);
                    return child;
                },
            ],
        ])('passes every key through from a %s', (_name, createTarget) => {
            render(<VirtualKeyboard />);
            const target = createTarget();
            if (!target.isConnected) {
                document.body.append(target);
            }
            expect(fireEvent.keyDown(target, { code: 'KeyA', key: 'a' })).toBe(true);
            expect(fireEvent.keyDown(target, { code: 'KeyM', key: 'm' })).toBe(true);
            expect(bubbleKeydowns).toHaveLength(2);
            expect(onMock).not.toHaveBeenCalled();
        });

        it('passes Cmd and Ctrl chords through to the app', () => {
            render(<VirtualKeyboard />);
            expect(fireEvent.keyDown(document.body, { code: 'KeyS', key: 's', metaKey: true })).toBe(true);
            expect(fireEvent.keyDown(document.body, { code: 'KeyA', key: 'a', ctrlKey: true })).toBe(true);
            expect(bubbleKeydowns).toHaveLength(2);
            expect(onMock).not.toHaveBeenCalled();
        });

        it('closes on Escape and consumes it', () => {
            const onClose = vi.fn();
            render(<VirtualKeyboard onClose={onClose} />);
            const notPrevented = fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
            expect(notPrevented).toBe(false);
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(bubbleKeydowns).toHaveLength(0);
        });

        it('does not close on Escape typed into a text field', () => {
            const onClose = vi.fn();
            render(<VirtualKeyboard onClose={onClose} />);
            const input = document.createElement('input');
            document.body.append(input);
            fireEvent.keyDown(input, { code: 'Escape', key: 'Escape' });
            expect(onClose).not.toHaveBeenCalled();
        });

        it('lets arrow keys reach the velocity slider', () => {
            render(<VirtualKeyboard />);
            const slider = screen.getByTestId('velocity-slider');
            const notPrevented = fireEvent.keyDown(slider, { code: 'ArrowRight', key: 'ArrowRight' });
            expect(notPrevented).toBe(true);
            expect(setVelocityMock).toHaveBeenCalledWith(101);
        });

        it('keeps control keys from reaching window listeners while the control still handles them', () => {
            render(<VirtualKeyboard />);
            const slider = screen.getByTestId('velocity-slider');
            fireEvent.keyDown(slider, { code: 'ArrowRight', key: 'ArrowRight' });
            expect(setVelocityMock).toHaveBeenCalledWith(101);
            expect(bubbleKeydowns).toHaveLength(0);

            const button = screen.getByLabelText(/Octave up/i);
            fireEvent.keyDown(button, { code: 'Enter', key: 'Enter' });
            expect(bubbleKeydowns).toHaveLength(0);
        });

        it('still lets a Cmd chord on the slider reach window listeners', () => {
            render(<VirtualKeyboard />);
            const slider = screen.getByTestId('velocity-slider');
            fireEvent.keyDown(slider, { code: 'KeyS', key: 's', metaKey: true });
            expect(bubbleKeydowns).toHaveLength(1);
        });

        it('lets Enter and Space reach a focused button but swallows its other keys', () => {
            render(<VirtualKeyboard />);
            const button = screen.getByLabelText(/Octave up/i);
            expect(fireEvent.keyDown(button, { code: 'Enter', key: 'Enter' })).toBe(true);
            expect(fireEvent.keyDown(button, { code: 'Space', key: ' ' })).toBe(true);
            expect(fireEvent.keyDown(button, { code: 'KeyM', key: 'm' })).toBe(false);
        });

        it('does not let a slider-specific key through on a non-interactive target', () => {
            render(<VirtualKeyboard />);
            expect(fireEvent.keyDown(document.body, { code: 'ArrowRight', key: 'ArrowRight' })).toBe(false);
        });

        it('does not prevent Tab or Shift+Tab', () => {
            render(<VirtualKeyboard />);
            expect(fireEvent.keyDown(document.body, { code: 'Tab', key: 'Tab' })).toBe(true);
            expect(fireEvent.keyDown(document.body, { code: 'Tab', key: 'Tab', shiftKey: true })).toBe(true);
            expect(bubbleKeydowns).toHaveLength(2);
        });

        it('consumes the keyup of a held musical key but lets other keyups through', () => {
            render(<VirtualKeyboard />);
            const keyups: KeyboardEvent[] = [];
            const recordKeyup = (event: KeyboardEvent) => {
                keyups.push(event);
            };
            window.addEventListener('keyup', recordKeyup);
            try {
                fireEvent.keyDown(document.body, { code: 'KeyA' });
                expect(fireEvent.keyUp(document.body, { code: 'KeyA' })).toBe(false);
                expect(fireEvent.keyUp(document.body, { code: 'KeyM' })).toBe(true);
                expect(keyups).toHaveLength(1);
            } finally {
                window.removeEventListener('keyup', recordKeyup);
            }
        });

        it('stops capturing keys once the panel unmounts', () => {
            const { unmount } = render(<VirtualKeyboard />);
            unmount();
            expect(fireEvent.keyDown(document.body, { code: 'KeyM', key: 'm' })).toBe(true);
            expect(bubbleKeydowns).toHaveLength(1);
        });

        it('stops guarding control keys once the panel unmounts', () => {
            const { unmount } = render(<VirtualKeyboard />);
            const slider = document.createElement('span');
            slider.setAttribute('role', 'slider');
            document.body.append(slider);
            fireEvent.keyDown(slider, { code: 'ArrowRight', key: 'ArrowRight' });
            expect(bubbleKeydowns).toHaveLength(0);

            unmount();
            fireEvent.keyDown(slider, { code: 'ArrowRight', key: 'ArrowRight' });
            expect(bubbleKeydowns).toHaveLength(1);
        });

        it('exposes the panel as a labelled region rather than a focus target', () => {
            render(<VirtualKeyboard />);
            const region = screen.getByRole('region', { name: 'Virtual Piano Keyboard' });
            expect(region).not.toHaveAttribute('tabindex');
        });
    });

    // ── Surfaces that own their keys ──────────────────────────────────────────────
    describe('surfaces that own keys', () => {
        const onMock = vi.mocked(triggerLiveNoteOn);

        const addCanvasEditor = (): HTMLCanvasElement => {
            const canvas = document.createElement('canvas');
            canvas.tabIndex = 0;
            canvas.setAttribute('data-canvas-editor', '');
            document.body.append(canvas);
            return canvas;
        };

        afterEach(() => {
            document.body.replaceChildren();
        });

        it.each([
            ['Delete', { code: 'Delete', key: 'Delete' }],
            ['Backspace', { code: 'Backspace', key: 'Backspace' }],
            ['Enter', { code: 'Enter', key: 'Enter' }],
            ['an arrow', { code: 'ArrowUp', key: 'ArrowUp' }],
            ['a velocity preset digit', { code: 'Digit3', key: '3' }],
            ['Shift+S', { code: 'KeyS', key: 'S', shiftKey: true }],
        ])('lets %s reach a focused canvas editor', (_name, init) => {
            render(<VirtualKeyboard />);
            const canvas = addCanvasEditor();
            const received = vi.fn();
            canvas.addEventListener('keydown', received);
            const notPrevented = fireEvent.keyDown(canvas, init);
            expect(notPrevented).toBe(true);
            expect(received).toHaveBeenCalledTimes(1);
            expect(onMock).not.toHaveBeenCalled();
        });

        it('keeps the canvas editor from leaking its keys to window listeners', () => {
            const seen: KeyboardEvent[] = [];
            const record = (event: KeyboardEvent) => {
                seen.push(event);
            };
            window.addEventListener('keydown', record);
            try {
                render(<VirtualKeyboard />);
                fireEvent.keyDown(addCanvasEditor(), { code: 'Delete', key: 'Delete' });
                expect(seen).toHaveLength(0);
            } finally {
                window.removeEventListener('keydown', record);
            }
        });

        it('still plays musical keys while a canvas editor has focus', () => {
            render(<VirtualKeyboard />);
            const canvas = addCanvasEditor();
            const received = vi.fn();
            canvas.addEventListener('keydown', received);
            const notPrevented = fireEvent.keyDown(canvas, { code: 'KeyA', key: 'a' });
            expect(notPrevented).toBe(false);
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
            expect(received).not.toHaveBeenCalled();
        });

        it('swallows keys a canvas editor does not handle', () => {
            render(<VirtualKeyboard />);
            expect(fireEvent.keyDown(addCanvasEditor(), { code: 'KeyM', key: 'm' })).toBe(false);
        });

        describe('with focus on an option of a persistent listbox', () => {
            const addOption = (): HTMLElement => {
                const listbox = document.createElement('div');
                listbox.setAttribute('role', 'listbox');
                const option = document.createElement('div');
                option.setAttribute('role', 'option');
                option.tabIndex = 0;
                listbox.append(option);
                document.body.append(listbox);
                return option;
            };

            it('still plays musical keys', () => {
                render(<VirtualKeyboard />);
                const notPrevented = fireEvent.keyDown(addOption(), { code: 'KeyA', key: 'a' });
                expect(notPrevented).toBe(false);
                expect(onMock).toHaveBeenCalledWith(0, 60, 100);
            });

            it('still closes on Escape', () => {
                const onClose = vi.fn();
                render(<VirtualKeyboard onClose={onClose} />);
                fireEvent.keyDown(addOption(), { code: 'Escape', key: 'Escape' });
                expect(onClose).toHaveBeenCalledTimes(1);
            });

            it('swallows keys the list does not handle', () => {
                render(<VirtualKeyboard />);
                expect(fireEvent.keyDown(addOption(), { code: 'KeyM', key: 'm' })).toBe(false);
            });

            it.each(['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '])('lets %s through to the list', (key) => {
                render(<VirtualKeyboard />);
                const option = addOption();
                const received = vi.fn();
                option.addEventListener('keydown', received);
                expect(fireEvent.keyDown(option, { code: key, key })).toBe(true);
                expect(received).toHaveBeenCalledTimes(1);
                expect(onMock).not.toHaveBeenCalled();
            });
        });

        it('lets Enter activate a focused link', () => {
            render(<VirtualKeyboard />);
            const link = document.createElement('a');
            link.setAttribute('href', '#main');
            document.body.append(link);
            expect(fireEvent.keyDown(link, { code: 'Enter', key: 'Enter' })).toBe(true);
        });
    });

    // ── Escape is the lowest-priority owner ───────────────────────────────────────
    describe('Escape priority', () => {
        const cancelGestureMock = vi.mocked(cancelActiveTimelineGesture);

        afterEach(() => {
            document.body.replaceChildren();
            document.documentElement.removeAttribute('data-drag-gesture-active');
        });

        it('closes on a plain Escape', () => {
            const onClose = vi.fn();
            render(<VirtualKeyboard onClose={onClose} />);
            fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('still closes on Escape beside a persistent listbox such as the sample library', () => {
            const onClose = vi.fn();
            render(<VirtualKeyboard onClose={onClose} />);
            const library = document.createElement('div');
            library.setAttribute('role', 'listbox');
            document.body.append(library);
            fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('closes on Escape while only a tooltip popper is open', () => {
            const onClose = vi.fn();
            render(<VirtualKeyboard onClose={onClose} />);
            const popper = document.createElement('div');
            popper.setAttribute('data-radix-popper-content-wrapper', '');
            const tooltip = document.createElement('div');
            tooltip.setAttribute('role', 'tooltip');
            popper.append(tooltip);
            document.body.append(popper);
            const notPrevented = fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
            expect(notPrevented).toBe(false);
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('leaves Escape alone while a select listbox popper is open', () => {
            const onClose = vi.fn();
            render(<VirtualKeyboard onClose={onClose} />);
            const popper = document.createElement('div');
            popper.setAttribute('data-radix-popper-content-wrapper', '');
            const listbox = document.createElement('div');
            listbox.setAttribute('role', 'listbox');
            popper.append(listbox);
            document.body.append(popper);
            expect(fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' })).toBe(true);
            expect(onClose).not.toHaveBeenCalled();
        });

        it.each(['dialog', 'alertdialog', 'menu'])(
            'leaves Escape alone while a %s is open elsewhere in the document',
            (role) => {
                const onClose = vi.fn();
                render(<VirtualKeyboard onClose={onClose} />);
                const surface = document.createElement('div');
                surface.setAttribute('role', role);
                document.body.append(surface);
                const notPrevented = fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
                expect(notPrevented).toBe(true);
                expect(onClose).not.toHaveBeenCalled();
            }
        );

        it('lets an open context menu close itself instead of the keyboard', () => {
            const onClose = vi.fn();
            render(<VirtualKeyboard onClose={onClose} />);
            const menu = document.createElement('div');
            menu.setAttribute('role', 'menu');
            document.body.append(menu);
            // useContextMenuDismiss listens on document, below the keyboard's window capture.
            const closeMenu = vi.fn();
            document.addEventListener('keydown', closeMenu);
            try {
                fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
            } finally {
                document.removeEventListener('keydown', closeMenu);
            }
            expect(closeMenu).toHaveBeenCalledTimes(1);
            expect(onClose).not.toHaveBeenCalled();
        });

        it('still closes when the keyboard itself is hosted inside a dialog surface', () => {
            const onClose = vi.fn();
            const host = document.createElement('div');
            host.setAttribute('role', 'dialog');
            document.body.append(host);
            render(<VirtualKeyboard onClose={onClose} />, { container: host });
            fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('leaves Escape to a mouse drag so the drag cancels instead of the keyboard', () => {
            const onClose = vi.fn();
            render(<VirtualKeyboard onClose={onClose} />);
            const endDrag = beginDragGesture();
            try {
                const dragCancel = vi.fn();
                window.addEventListener('keydown', dragCancel);
                try {
                    fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
                } finally {
                    window.removeEventListener('keydown', dragCancel);
                }
                expect(dragCancel).toHaveBeenCalledTimes(1);
                expect(onClose).not.toHaveBeenCalled();
            } finally {
                endDrag();
            }
        });

        it('cancels an active timeline gesture instead of closing', () => {
            const onClose = vi.fn();
            cancelGestureMock.mockReturnValueOnce(true);
            render(<VirtualKeyboard onClose={onClose} />);
            const notPrevented = fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
            expect(notPrevented).toBe(false);
            expect(cancelGestureMock).toHaveBeenCalledTimes(1);
            expect(onClose).not.toHaveBeenCalled();
        });
    });

    // ── AltGr, engine resume, Cmd release ─────────────────────────────────────────
    describe('modifier and engine edge cases', () => {
        const onMock = vi.mocked(triggerLiveNoteOn);
        const offMock = vi.mocked(triggerLiveNoteOff);
        const resumeMock = vi.mocked(resumeEngine);

        it('consumes AltGr characters reported as Ctrl+Alt instead of passing them as a chord', () => {
            render(<VirtualKeyboard />);
            const notPrevented = fireEvent.keyDown(document.body, {
                code: 'Digit8',
                key: '[',
                ctrlKey: true,
                altKey: true,
            });
            expect(notPrevented).toBe(false);
        });

        it('consumes a key reported with the AltGraph modifier state', () => {
            render(<VirtualKeyboard />);
            const notPrevented = fireEvent.keyDown(document.body, {
                code: 'Digit8',
                key: '[',
                modifierAltGraph: true,
            });
            expect(notPrevented).toBe(false);
        });

        it('still passes a plain Ctrl chord through', () => {
            render(<VirtualKeyboard />);
            expect(fireEvent.keyDown(document.body, { code: 'KeyS', key: 's', ctrlKey: true })).toBe(true);
        });

        it('resumes the audio engine when a computer key starts a note', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(document.body, { code: 'KeyM', key: 'm' });
            expect(resumeMock).not.toHaveBeenCalled();

            fireEvent.keyDown(document.body, { code: 'KeyA' });
            expect(resumeMock).toHaveBeenCalledTimes(1);
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
        });

        it('logs a failed engine resume without blocking the note', async () => {
            const error = new Error('resume failed');
            resumeMock.mockRejectedValueOnce(error);
            render(<VirtualKeyboard />);
            fireEvent.keyDown(document.body, { code: 'KeyA' });
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
            await waitFor(() => {
                expect(loggerWarn).toHaveBeenCalledWith('[Audio] Virtual keyboard engine resume failed:', error);
            });
        });

        it('releases keyboard-held notes when Cmd is released after the note key was', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(document.body, { code: 'KeyA' }); // C4 = 60
            fireEvent.keyDown(document.body, { code: 'KeyS' }); // D4 = 62
            // macOS drops keyup for keys released while Cmd is down.
            fireEvent.keyDown(document.body, { code: 'MetaLeft', key: 'Meta', metaKey: true });
            expect(offMock).not.toHaveBeenCalled();

            fireEvent.keyUp(document.body, { code: 'MetaLeft', key: 'Meta' });

            const released = offMock.mock.calls.map(([, note]) => note).sort((a, b) => a - b);
            expect(released).toEqual([60, 62]);
            expect(screen.getByLabelText('C4 (MIDI 60)')).toHaveAttribute('aria-pressed', 'false');
        });

        it('lets a key pressed again after the Cmd release start a fresh note', () => {
            render(<VirtualKeyboard />);
            fireEvent.keyDown(document.body, { code: 'KeyA' });
            fireEvent.keyUp(document.body, { code: 'MetaLeft', key: 'Meta' });
            onMock.mockClear();
            fireEvent.keyDown(document.body, { code: 'KeyA' });
            expect(onMock).toHaveBeenCalledWith(0, 60, 100);
        });

        it('leaves a mouse-held note sounding when Cmd is released', () => {
            render(<VirtualKeyboard />);
            fireEvent.pointerDown(screen.getByLabelText('C4 (MIDI 60)'), { pointerId: 1 });
            offMock.mockClear();
            fireEvent.keyUp(document.body, { code: 'MetaLeft', key: 'Meta' });
            expect(offMock).not.toHaveBeenCalled();
        });
    });
});
