import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { triggerLiveNoteOff, triggerLiveNoteOn } from '#/modules/AudioEngine/useCases';
import { setVirtualKeyboardOctave } from '#/modules/Workspace/useCases';

import { VirtualKeyboard } from '../VirtualKeyboard';

// Controllable workspace state so individual tests can drive octave/velocity.
const workspaceState = {
    virtualKeyboardOctave: 4,
    virtualKeyboardVelocity: 100,
};

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => workspaceState),
}));

// Mock the SAME barrel module-ids the component imports from
// (`#/modules/AudioEngine/useCases`, `#/modules/Workspace/useCases`) — not the deep
// per-file paths. A deep-path mock only intercepts the call when the barrel happens to
// resolve through the mocked file at load time, which is order-dependent: a sibling spec
// that evaluated the real barrel first leaves the re-export pointing at the real function
// and the mock never fires (intermittent green). Mocking the barrel module-id itself makes
// the interception independent of load order.
//
// The factory provides only the four exports the component consumes and does NOT spread
// importOriginal: evaluating the real AudioEngine/Workspace barrels drags in the audio
// engine / WASM init, which never settles under jsdom and hangs the run. The component is
// the only consumer of these barrels in this spec's module graph, so a minimal surface is
// sufficient and keeps the test deterministic.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    triggerLiveNoteOn: vi.fn(),
    triggerLiveNoteOff: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    setVirtualKeyboardOctave: vi.fn(),
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
    DawInlineHint: ({ children }: { children: React.ReactNode }) => (
        <span data-testid="daw-inline-hint">{children}</span>
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

vi.mock('#/components/ui/slider', () => ({
    Slider: ({ value, onValueChange, 'aria-label': ariaLabel }: any) => (
        <input
            type="range"
            value={value?.[0] || 0}
            onChange={(e) => onValueChange?.([Number(e.target.value)])}
            aria-label={ariaLabel}
            data-testid="velocity-slider"
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

        const panel = () => screen.getByRole('application');

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

        // Fix #6: a key event bubbling from the velocity slider must not fire a note.
        // key 'a' would otherwise match the mapping, so only the slider-origin guard stops it.
        it('ignores mapped keys that bubble up from the velocity slider', () => {
            render(<VirtualKeyboard />);
            const slider = screen.getByTestId('velocity-slider');
            fireEvent.keyDown(slider, { code: 'KeyA', key: 'a', bubbles: true });
            expect(onMock).not.toHaveBeenCalled();
        });
    });

    describe('mouse glide', () => {
        const onMock = vi.mocked(triggerLiveNoteOn);
        const offMock = vi.mocked(triggerLiveNoteOff);

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
    });

    // ── Stuck-note prevention on teardown / tab hide / focus loss ───────────────────
    //
    // A note held when the component unmounts, the tab is hidden, or the window loses focus
    // has no keyup/pointerup left to release it — without teardown cleanup it leaks a noteOn
    // (an audible hung note). These assert every held note is released, deterministically.
    describe('releases held notes on teardown', () => {
        const offMock = vi.mocked(triggerLiveNoteOff);

        const panel = () => screen.getByRole('application');

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
});
