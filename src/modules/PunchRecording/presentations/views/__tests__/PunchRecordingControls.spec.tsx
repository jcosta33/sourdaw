import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '#/modules/Transport/stores';
import { setPunchIn, setPunchOut } from '#/modules/Transport/useCases';

import { definePunchRegion } from '../../../useCases/punchRecording/definePunchRegion';
import { setPostRoll } from '../../../useCases/punchRecording/setPostRoll';
import { setPreRoll } from '../../../useCases/punchRecording/setPreRoll';
import { togglePunchRecording } from '../../../useCases/punchRecording/togglePunchRecording';
import { PunchRecordingControls } from '../PunchRecordingControls';

import type { TransportState } from '#/modules/Transport/stores';
import type { BackgroundCapture, PunchRecordingState } from '../../../stores/punchRecordingStore';

// Mock the mutation use cases so we assert callback wiring without undo/CRDT coupling.
vi.mock('../../../useCases/punchRecording/togglePunchRecording', () => ({
    togglePunchRecording: vi.fn(),
}));
vi.mock('../../../useCases/punchRecording/definePunchRegion', () => ({
    definePunchRegion: vi.fn(),
}));
vi.mock('../../../useCases/punchRecording/setPreRoll', () => ({
    setPreRoll: vi.fn(),
}));
vi.mock('../../../useCases/punchRecording/setPostRoll', () => ({
    setPostRoll: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Transport/useCases')>('#/modules/Transport/useCases');
    return { ...actual, setPunchIn: vi.fn(), setPunchOut: vi.fn() };
});

// useStore returns the defaultValue arg when no real store is wired. We hijack it
// to return seeded punch + transport state so computed render values are real.
let punchState: PunchRecordingState;
let transportState: TransportState;
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => {
        // punchRecordingStore and transportStore are passed positionally; distinguish
        // by the shape of the default value.
        if (defaultValue && typeof defaultValue === 'object' && 'captures' in defaultValue) {
            return punchState;
        }
        return transportState;
    }),
}));

const capture = (overrides: Partial<BackgroundCapture> = {}): BackgroundCapture => ({
    id: 'cap-1',
    trackId: 'track-1',
    startBeat: 0,
    endBeat: 32,
    recording: false,
    punchRegions: [],
    ...overrides,
});

function renderUi(compact = false): void {
    render(<PunchRecordingControls compact={compact} />);
}

function openSettings(): void {
    fireEvent.click(screen.getByRole('button', { name: 'Punch recording settings' }));
}

describe('PunchRecordingControls', () => {
    beforeEach(() => {
        punchState = {
            captures: [],
            defaultPreRoll: 4,
            defaultPostRoll: 2,
            defaultCrossfade: 0.25,
            enabled: false,
        };
        transportState = { ...defaultTransportState, punchInBeat: 4, punchOutBeat: 16 };
        vi.clearAllMocks();
    });

    describe('background-capture latch', () => {
        it('reflects the disabled state in aria-label and aria-pressed', () => {
            renderUi();
            const latch = screen.getByRole('button', { name: 'Enable background capture' });
            expect(latch.getAttribute('aria-pressed')).toBe('false');
        });

        it('reflects the enabled state in aria-label and aria-pressed', () => {
            punchState.enabled = true;
            renderUi();
            const latch = screen.getByRole('button', { name: 'Disable background capture' });
            expect(latch.getAttribute('aria-pressed')).toBe('true');
        });

        it('calls togglePunchRecording when the latch is clicked', () => {
            renderUi();
            fireEvent.click(screen.getByRole('button', { name: 'Enable background capture' }));
            expect(togglePunchRecording).toHaveBeenCalledTimes(1);
        });
    });

    describe('number fields', () => {
        it('renders the In/Out/Pre/Post fields seeded from store values', () => {
            renderUi();
            expect(screen.getByLabelText('Punch-in beat')).toHaveValue(4);
            expect(screen.getByLabelText('Punch-out beat')).toHaveValue(16);
            expect(screen.getByLabelText('Pre-roll in beats')).toHaveValue(4);
            expect(screen.getByLabelText('Post-roll in beats')).toHaveValue(2);
        });

        it('commits the In field to setPunchIn on blur', () => {
            renderUi();
            const input = screen.getByLabelText('Punch-in beat') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '8.5' } });
            fireEvent.blur(input);
            expect(setPunchIn).toHaveBeenCalledWith(8.5);
        });

        it('commits the Out field to setPunchOut on Enter', () => {
            renderUi();
            const input = screen.getByLabelText('Punch-out beat') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '24' } });
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(setPunchOut).toHaveBeenCalledWith(24);
        });

        it('clamps a below-min value to the min (0) on commit for the In field', () => {
            renderUi();
            const input = screen.getByLabelText('Punch-in beat') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '-10' } });
            fireEvent.blur(input);
            expect(setPunchIn).toHaveBeenCalledWith(0);
        });

        it('falls back to the min when the value is non-numeric', () => {
            renderUi();
            const input = screen.getByLabelText('Punch-in beat') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'abc' } });
            fireEvent.blur(input);
            expect(setPunchIn).toHaveBeenCalledWith(0);
        });

        it('commits the Pre field to setPreRoll and Post to setPostRoll', () => {
            renderUi();
            const pre = screen.getByLabelText('Pre-roll in beats') as HTMLInputElement;
            fireEvent.change(pre, { target: { value: '8' } });
            fireEvent.blur(pre);
            expect(setPreRoll).toHaveBeenCalledWith(8);

            const post = screen.getByLabelText('Post-roll in beats') as HTMLInputElement;
            fireEvent.change(post, { target: { value: '3' } });
            fireEvent.blur(post);
            expect(setPostRoll).toHaveBeenCalledWith(3);
        });
    });

    describe('Mark region button', () => {
        it('is disabled when there is no active capture', () => {
            renderUi();
            const mark = screen.getByRole('button', { name: 'Mark punch region from current capture' });
            expect(mark).toBeDisabled();
        });

        it('is enabled when a capture is recording', () => {
            punchState.captures = [capture({ id: 'cap-1', recording: true })];
            renderUi();
            const mark = screen.getByRole('button', { name: 'Mark punch region from current capture' });
            expect(mark).not.toBeDisabled();
        });

        it('calls definePunchRegion with the active capture id and current punch beats', () => {
            punchState.captures = [capture({ id: 'cap-1', recording: true })];
            transportState = { ...defaultTransportState, punchInBeat: 4, punchOutBeat: 16 };
            renderUi();
            fireEvent.click(screen.getByRole('button', { name: 'Mark punch region from current capture' }));
            expect(definePunchRegion).toHaveBeenCalledWith('cap-1', 4, 16);
        });

        it('selects the recording capture over non-recording ones for the active capture', () => {
            punchState.captures = [
                capture({ id: 'cap-idle', recording: false }),
                capture({ id: 'cap-live', recording: true }),
            ];
            renderUi();
            fireEvent.click(screen.getByRole('button', { name: 'Mark punch region from current capture' }));
            expect(definePunchRegion).toHaveBeenCalledWith('cap-live', 4, 16);
        });
    });

    describe('compact layout', () => {
        it('hides punch fields until settings are opened', () => {
            renderUi(true);
            expect(screen.queryByTestId('punch-in-beat')).not.toBeInTheDocument();
            expect(
                screen.queryByRole('button', { name: 'Mark punch region from current capture' })
            ).not.toBeInTheDocument();
            openSettings();
            expect(screen.getByTestId('punch-in-beat')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Mark punch region from current capture' })).toBeInTheDocument();
        });
    });
});
