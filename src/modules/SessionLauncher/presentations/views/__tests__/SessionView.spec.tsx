import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { sessionLaunchStore } from '../../../stores/sessionLaunchStore';
import { SessionView } from '../SessionView';

import type { Clip, Track } from '../../../models/TrackViewTypes';

// Mock hooks. Track.clips is a Clip[] array (TrackViewTypes.ts:104) — the
// mock must use the real array shape, not an object map, so the view's
// array-indexed slot mapping is exercised the way it runs in production.
vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [
            { id: 'track-1', name: 'Audio 1', color: '#ff0000', clips: [{ id: 'clip-1' }] },
            { id: 'track-2', name: 'Midi 1', color: '#00ff00', clips: [] },
        ],
    })),
}));

const makeClip = (id: string): Clip => ({
    id,
    trackId: 'track-1',
    name: id,
    startBeat: 0,
    endBeat: 4,
    type: 'midi',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#ff0000',
    locked: false,
    muted: false,
});

const makeTrack = (overrides: Partial<Track> = {}): Track => ({
    id: 'track-1',
    name: 'Audio 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 1,
    pan: 0,
    color: '#ff0000',
    clips: [],
    devices: [],
    midiFx: [],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 64,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'main',
    alternatives: [],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    ...overrides,
});

describe('SessionView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the real store between tests so click handlers that write
        // through sessionLaunchStore.set start from a clean slate.
        sessionLaunchStore.set({ activeSlots: {} });
    });

    it('should render tracks as columns', () => {
        render(<SessionView />);
        expect(screen.getByText('Audio 1')).toBeInTheDocument();
        expect(screen.getByText('Midi 1')).toBeInTheDocument();
    });

    it('should show "Session" title', () => {
        render(<SessionView />);
        expect(screen.getByText('Session')).toBeInTheDocument();
    });

    it('should launch a clip slot when clicked', () => {
        render(<SessionView />);
        const slot = screen.getByLabelText('Audio 1 scene 1 - clip loaded');
        act(() => {
            fireEvent.click(slot);
        });
        expect(sessionLaunchStore.value?.activeSlots['track-1']).toBe(0);
    });

    it('should launch all tracks in a scene when scene button is clicked', () => {
        render(<SessionView />);
        const sceneButton = screen.getByLabelText('Launch scene 1');
        act(() => {
            fireEvent.click(sceneButton);
        });
        expect(sessionLaunchStore.value?.activeSlots).toEqual({ 'track-1': 0, 'track-2': 0 });
    });

    it('should show empty state when no tracks exist', async () => {
        const { useTracks } = await import('../../hooks/useTracks');
        vi.mocked(useTracks).mockReturnValue({ tracks: [], selectedTrackId: null });

        render(<SessionView />);
        expect(screen.getByText('No session tracks yet')).toBeInTheDocument();
    });

    describe('keyboard accessibility (F8)', () => {
        beforeEach(async () => {
            // A prior test in this file overrides useTracks with mockReturnValue,
            // which (unlike vi.clearAllMocks) survives across tests — restore the
            // default fixture explicitly so these tests do not depend on file order.
            const { useTracks } = await import('../../hooks/useTracks');
            vi.mocked(useTracks).mockReturnValue({
                tracks: [
                    makeTrack({ id: 'track-1', name: 'Audio 1', color: '#ff0000', clips: [makeClip('clip-1')] }),
                    makeTrack({ id: 'track-2', name: 'Midi 1', color: '#00ff00', clips: [] }),
                ],
                selectedTrackId: null,
            });
        });

        it('exposes a loaded clip slot as a real button reachable by keyboard/screen reader', () => {
            // Regression for F8: the cell was a <div role="gridcell" onClick>
            // with no tabIndex or key handler, so it never surfaced as a
            // "button" in the accessibility tree and was unreachable by Tab.
            render(<SessionView />);
            expect(screen.getByRole('button', { name: 'Audio 1 scene 1 - clip loaded' })).toBeInTheDocument();
        });

        it('disables the empty-slot button so it is skipped by keyboard navigation', () => {
            render(<SessionView />);
            expect(screen.getByRole('button', { name: 'Audio 1 scene 2 - empty' })).toBeDisabled();
        });

        it('still launches the clip slot via toggleSessionSlot when activated as a button', () => {
            render(<SessionView />);
            const slot = screen.getByRole('button', { name: 'Audio 1 scene 1 - clip loaded' });
            act(() => {
                fireEvent.click(slot);
            });
            expect(sessionLaunchStore.value?.activeSlots['track-1']).toBe(0);
        });
    });

    it('maps each clip to its scene slot by array position from a Clip[] array', async () => {
        // Regression for the Object.values(track.clips) no-op cast: clips is a
        // Clip[] array, so clip[0] occupies scene 1 and clip[1] occupies scene
        // 2. The previous code spread the array through Object.values + a fake
        // {id:string} cast; here we assert the array is read positionally so a
        // multi-clip track lights the correct, contiguous slots.
        const { useTracks } = await import('../../hooks/useTracks');
        vi.mocked(useTracks).mockReturnValue({
            tracks: [
                makeTrack({
                    id: 'track-1',
                    name: 'Audio 1',
                    color: '#ff0000',
                    clips: [makeClip('clip-a'), makeClip('clip-b')],
                }),
            ],
            selectedTrackId: null,
        });

        render(<SessionView />);
        // Scenes 1 and 2 hold the two clips...
        expect(screen.getByLabelText('Audio 1 scene 1 - clip loaded')).toBeInTheDocument();
        expect(screen.getByLabelText('Audio 1 scene 2 - clip loaded')).toBeInTheDocument();
        // ...and the remaining scenes are empty.
        expect(screen.getByLabelText('Audio 1 scene 3 - empty')).toBeInTheDocument();
    });

    describe('render-output structure pin (#2518)', () => {
        // Pins the DOM the grid/slot rendering paths produce, so the restore
        // of the renderIife_* outline residue to ordinary named JSX helpers
        // changes no rendered output: this test passes identically before and
        // after that restore, and any structural drift (classes, icons, badge
        // styling, state branches) fails it.
        beforeEach(async () => {
            const { useTracks } = await import('../../hooks/useTracks');
            vi.mocked(useTracks).mockReturnValue({
                tracks: [
                    makeTrack({
                        id: 'track-1',
                        name: 'Audio 1',
                        color: '#ff0000',
                        clips: [makeClip('clip-a'), makeClip('clip-b')],
                    }),
                    makeTrack({ id: 'track-2', name: 'Midi 1', color: '#00ff00', clips: [] }),
                ],
                selectedTrackId: null,
            });
        });

        it('renders the scene rail: a Scene header plus one launch button per scene', () => {
            render(<SessionView />);
            expect(screen.getByText('Scene')).toBeInTheDocument();
            for (let scene = 1; scene <= 8; scene++) {
                expect(screen.getByLabelText(`Launch scene ${scene}`)).toBeInTheDocument();
            }
        });

        it('styles the active slot with the play-state background, play icon, and active badge', () => {
            sessionLaunchStore.set({ activeSlots: { 'track-1': 0 } });
            render(<SessionView />);

            const activeSlot = screen.getByRole('button', { name: 'Audio 1 scene 1 - clip loaded' });
            expect(activeSlot.className).toContain('bg-[var(--color-state-play)]/20');

            const playIcon = activeSlot.querySelector('svg.lucide-play');
            expect(playIcon?.getAttribute('class')).toContain('fill-[var(--color-state-play)]');

            const badge = within(activeSlot).getByText('Clip');
            expect(badge.className).toContain('bg-[var(--color-state-play)]/30');
            expect(badge.className).toContain('text-[var(--color-state-play)]');
            // No inline background-color on the active badge: the color
            // override yields undefined and React omits the property.
            expect(badge.style.backgroundColor).toBe('');
        });

        it('styles the loaded inactive slot with the inset background, no play icon, and a muted badge carrying the track color', () => {
            render(<SessionView />);

            const inactiveSlot = screen.getByRole('button', { name: 'Audio 1 scene 2 - clip loaded' });
            expect(inactiveSlot.className).toContain('bg-surface-inset');
            expect(inactiveSlot.querySelector('svg.lucide-play')).toBeNull();

            const badge = within(inactiveSlot).getByText('Clip');
            expect(badge.className).toContain('bg-muted/30');
            expect(badge.className).toContain('text-muted-foreground');
            // The view computes `${track.color}20` (#ff000020); jsdom's
            // CSSOM serializes that alpha-hex as rgba.
            expect(badge.style.backgroundColor).toBe('rgba(255, 0, 0, 0.125)');
        });

        it('styles the empty slot with the faint hover background and a plus icon', () => {
            render(<SessionView />);

            const emptySlot = screen.getByRole('button', { name: 'Audio 1 scene 3 - empty' });
            expect(emptySlot.className).toContain('hover:bg-white/[0.03]');
            expect(emptySlot.querySelector('svg.lucide-plus')).not.toBeNull();
        });
    });
});
