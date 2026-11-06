import { act, render, screen, fireEvent, type RenderResult } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { levelToSendPosition, sendPositionToLevel } from '#/utils/audioLevelLaw';

import { SendsSection } from '../SendsSection';

import type { Track } from '../../../../models/TrackViewTypes';

const mocks = vi.hoisted(() => ({
    previewSend: vi.fn(),
    engineRemoveSend: vi.fn(),
    executeAppAction: vi.fn(),
    tracks: [] as Track[],
}));

// Only the engine preview and the dispatch are doubled; the action builders and
// the destination filter under test are the real ones.
vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    setSend: mocks.previewSend,
    removeSend: mocks.engineRemoveSend,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../../../hooks/useTracks', () => ({
    useTracks: () => ({ tracks: mocks.tracks, selectedTrackId: null }),
}));

const baseTrack: Track = {
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
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
    height: 80,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
};

const makeBus = (overrides: Partial<Track> = {}): Track => ({
    ...baseTrack,
    id: 'bus-1',
    kind: 'bus',
    name: 'Bus',
    ...overrides,
});

// A level commit reads the send the project holds, so the edited track is put
// in the project exactly as it is rendered.
const renderInProject = (track: Track): RenderResult => {
    trackStore.set({ tracks: [track, ...mocks.tracks], selectedTrackId: null, ghostClips: [] });
    return render(<SendsSection track={track} />);
};

describe('SendsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.tracks = [];
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('renders nothing when the project has no buses', () => {
        const { container } = render(<SendsSection track={baseTrack} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders one send row per bus, labeled with the bus name and current send level', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' }), makeBus({ id: 'bus-2', name: 'Delay' })];
        const track: Track = { ...baseTrack, sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] };

        render(<SendsSection track={track} />);

        expect(screen.getByText('Reverb')).toBeInTheDocument();
        expect(screen.getByText('Delay')).toBeInTheDocument();
        // FX-7: the control is linear in dB, not in amplitude. A stored level of
        // 0.5 is -6.02 dB, which sits near the top of a -60 dB travel (~90),
        // not at the midpoint the old linear law put it at.
        expect(screen.getByRole('slider', { name: 'Send to Reverb' })).toHaveAttribute('aria-valuenow', '90');
        // No matching send entry for bus-2 -> defaults to 0.
        expect(screen.getByRole('slider', { name: 'Send to Delay' })).toHaveAttribute('aria-valuenow', '0');
    });

    it('previews a typed slider edit on the engine and commits exactly one setSend guarded by the starting send', async () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const track: Track = { ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.2, preFader: false }] };

        renderInProject(track);

        const slider = screen.getByRole('slider', { name: 'Send to Reverb' });
        fireEvent.doubleClick(slider);
        // Stored 0.2 is -13.98 dB, which reads as position 77 on the dB travel.
        const input = screen.getByDisplayValue('77');
        fireEvent.change(input, { target: { value: '65' } });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        // Position 65 of a -60 dB travel is -21 dB, i.e. a gain of 0.0891 — the
        // old linear law would have stored 0.65 for the same control position.
        expect(mocks.previewSend).toHaveBeenCalledOnce();
        expect(mocks.previewSend.mock.calls[0]![2]).toBeCloseTo(0.0891, 4);
        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        const action = mocks.executeAppAction.mock.calls[0]![0];
        expect(action).toMatchObject({
            type: 'setSend',
            payload: { trackId: 'track-9', busId: 'bus-1', expectedLevel: 0.2, expectedPreFader: false },
        });
        expect(action.payload.level).toBeCloseTo(0.0891, 4);
    });

    it('commits addSend when the track has no send to that bus yet', async () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];

        renderInProject({ ...baseTrack, id: 'track-9' });

        const slider = screen.getByRole('slider', { name: 'Send to Reverb' });
        fireEvent.doubleClick(slider);
        const input = screen.getByDisplayValue('0');
        fireEvent.change(input, { target: { value: '65' } });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction.mock.calls[0]![0]).toMatchObject({
            type: 'addSend',
            payload: { trackId: 'track-9', busId: 'bus-1' },
        });
    });

    it('removes the previewed send from the engine when the first send to a bus is refused', async () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        mocks.executeAppAction.mockRejectedValueOnce(new Error('conflict'));

        renderInProject({ ...baseTrack, id: 'track-9' });

        fireEvent.doubleClick(screen.getByRole('slider', { name: 'Send to Reverb' }));
        fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '65' } });
        await act(async () => {
            fireEvent.keyDown(screen.getByDisplayValue('65'), { key: 'Enter' });
        });

        expect(mocks.engineRemoveSend).toHaveBeenCalledWith('track-9', 'bus-1');
    });

    it('settles a pointer drag the browser cancels as one commit at the level it was left', async () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        renderInProject({ ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.2, preFader: false }] });
        const root = screen.getByRole('slider', { name: 'Send to Reverb' }).closest('[data-slot="slider"]');
        if (!(root instanceof HTMLElement)) {
            throw new Error('Missing Slider root');
        }
        // jsdom has no pointer capture; hold it as a browser does, so a cancel
        // releases it and Radix sees the later pointerup without capture.
        let captured = false;
        Object.defineProperties(root, {
            setPointerCapture: { configurable: true, value: () => (captured = true) },
            releasePointerCapture: { configurable: true, value: () => (captured = false) },
            hasPointerCapture: { configurable: true, value: () => captured },
        });
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 0,
            bottom: 20,
            left: 0,
            right: 100,
            width: 100,
            height: 20,
            toJSON: () => ({}),
        });

        fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 40, clientY: 10 });
        fireEvent.pointerMove(root, { pointerId: 1, clientX: 50, clientY: 10 });
        expect(mocks.previewSend).toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        await act(async () => {
            fireEvent.pointerCancel(root, { pointerId: 1 });
            captured = false;
            fireEvent.lostPointerCapture(root, { pointerId: 1 });
            // A pointerup the slider still sees afterwards must not commit the gesture twice.
            fireEvent.pointerUp(root, { pointerId: 1 });
        });

        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        const action = mocks.executeAppAction.mock.calls[0]![0];
        expect(action).toMatchObject({ type: 'setSend', payload: { trackId: 'track-9', expectedLevel: 0.2 } });
        expect(action.payload.level).toBeCloseTo(mocks.previewSend.mock.lastCall![2], 6);
    });

    it('settles a drag on the track it began on when the strip switches track mid-drag', async () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const view = renderInProject({
            ...baseTrack,
            id: 'track-9',
            sends: [{ busId: 'bus-1', level: 0.2, preFader: false }],
        });
        const root = screen.getByRole('slider', { name: 'Send to Reverb' }).closest('[data-slot="slider"]');
        if (!(root instanceof HTMLElement)) {
            throw new Error('Missing Slider root');
        }
        Object.defineProperties(root, {
            setPointerCapture: { configurable: true, value: vi.fn() },
            hasPointerCapture: { configurable: true, value: () => true },
        });
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 0,
            bottom: 20,
            left: 0,
            right: 100,
            width: 100,
            height: 20,
            toJSON: () => ({}),
        });

        fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 40, clientY: 10 });
        const previewedLevel = mocks.previewSend.mock.lastCall![2];
        await act(async () => {
            view.rerender(
                <SendsSection
                    track={{ ...baseTrack, id: 'track-10', sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] }}
                />
            );
        });

        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        const action = mocks.executeAppAction.mock.calls[0]![0];
        expect(action).toMatchObject({ type: 'setSend', payload: { trackId: 'track-9', expectedLevel: 0.2 } });
        expect(action.payload.level).toBeCloseTo(previewedLevel, 6);
        // The next track shows its own level, not the one left on the last.
        expect(screen.getByRole('slider', { name: 'Send to Reverb' })).toHaveAttribute(
            'aria-valuenow',
            String(Math.round(levelToSendPosition(0.5)))
        );
    });

    it('writes nothing for a drag that comes back to the level it started on, and then follows the project', async () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        // A level on the slider's own grid, so coming back to its position is coming back to it exactly.
        const startLevel = sendPositionToLevel(77);
        const track: Track = {
            ...baseTrack,
            id: 'track-9',
            sends: [{ busId: 'bus-1', level: startLevel, preFader: false }],
        };
        const view = renderInProject(track);
        const root = screen.getByRole('slider', { name: 'Send to Reverb' }).closest('[data-slot="slider"]');
        if (!(root instanceof HTMLElement)) {
            throw new Error('Missing Slider root');
        }
        let captured = false;
        Object.defineProperties(root, {
            setPointerCapture: { configurable: true, value: () => (captured = true) },
            releasePointerCapture: { configurable: true, value: () => (captured = false) },
            hasPointerCapture: { configurable: true, value: () => captured },
        });
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 0,
            bottom: 20,
            left: 0,
            right: 100,
            width: 100,
            height: 20,
            toJSON: () => ({}),
        });

        fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 40, clientY: 10 });
        fireEvent.pointerMove(root, { pointerId: 1, clientX: 77, clientY: 10 });
        expect(mocks.previewSend.mock.lastCall![2]).toBe(startLevel);
        await act(async () => {
            fireEvent.pointerUp(root, { pointerId: 1 });
            fireEvent.lostPointerCapture(root, { pointerId: 1 });
        });
        expect(mocks.executeAppAction).not.toHaveBeenCalled();

        // Undo or automation moves the send afterwards: the row shows it, not the level it was left on.
        await act(async () => {
            view.rerender(
                <SendsSection track={{ ...track, sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] }} />
            );
        });
        expect(screen.getByRole('slider', { name: 'Send to Reverb' })).toHaveAttribute(
            'aria-valuenow',
            String(Math.round(levelToSendPosition(0.5)))
        );
    });

    it('commits a keyboard step on the send slider as one setSend at the stepped level', async () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        renderInProject({ ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.2, preFader: false }] });
        const thumb = screen.getByRole('slider', { name: 'Send to Reverb' });

        await act(async () => {
            fireEvent.keyDown(thumb, { key: 'ArrowRight' });
        });

        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        const action = mocks.executeAppAction.mock.calls[0]![0];
        expect(action).toMatchObject({ type: 'setSend', payload: { trackId: 'track-9', expectedLevel: 0.2 } });
        expect(action.payload.level).toBeCloseTo(mocks.previewSend.mock.lastCall![2], 6);
    });

    it('commits a second keyboard step taken before the first lands, guarded on the level the first wrote', async () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const track: Track = { ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.2, preFader: false }] };
        renderInProject(track);
        let landFirst: () => void = () => undefined;
        mocks.executeAppAction.mockImplementationOnce(
            (action: { payload: { level: number } }) =>
                new Promise<void>((resolve) => {
                    landFirst = () => {
                        trackStore.set({
                            tracks: [
                                { ...track, sends: [{ busId: 'bus-1', level: action.payload.level, preFader: false }] },
                                ...mocks.tracks,
                            ],
                            selectedTrackId: null,
                            ghostClips: [],
                        });
                        resolve();
                    };
                })
        );
        let landSecond: () => void = () => undefined;
        mocks.executeAppAction.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    landSecond = resolve;
                })
        );
        const thumb = screen.getByRole('slider', { name: 'Send to Reverb' });

        await act(async () => {
            fireEvent.keyDown(thumb, { key: 'ArrowRight' });
        });
        await act(async () => {
            fireEvent.keyDown(thumb, { key: 'ArrowRight' });
        });
        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        await act(async () => {
            landFirst();
        });

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        const [first, second] = mocks.executeAppAction.mock.calls.map(([action]) => action);
        expect(second).toMatchObject({ type: 'setSend', payload: { expectedLevel: first.payload.level } });
        expect(second.payload.level).toBeGreaterThan(first.payload.level);
        // The first step settling leaves the slider on the step still landing.
        expect(thumb).toHaveAttribute('aria-valuenow', String(Math.round(levelToSendPosition(second.payload.level))));
        await act(async () => {
            landSecond();
        });
    });

    it('shows POST for a post-fader send and toggles it to pre-fader on click', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const track: Track = { ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] };

        render(<SendsSection track={track} />);

        const toggle = screen.getByRole('button', { name: 'Toggle send to Reverb pre-fader' });
        expect(toggle).toHaveTextContent('POST');

        fireEvent.click(toggle);

        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'setSend',
            payload: {
                trackId: 'track-9',
                busId: 'bus-1',
                level: 0.5,
                preFader: true,
                expectedLevel: 0.5,
                expectedPreFader: false,
            },
        });
    });

    it('shows PRE for a pre-fader send and toggles it to post-fader on click', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const track: Track = { ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.5, preFader: true }] };

        render(<SendsSection track={track} />);

        const toggle = screen.getByRole('button', { name: 'Toggle send to Reverb post-fader' });
        expect(toggle).toHaveTextContent('PRE');

        fireEvent.click(toggle);

        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'setSend',
            payload: {
                trackId: 'track-9',
                busId: 'bus-1',
                level: 0.5,
                preFader: false,
                expectedLevel: 0.5,
                expectedPreFader: true,
            },
        });
    });

    it('offers neither the track itself nor a bus that would close a routing loop', () => {
        const edited = makeBus({ id: 'bus-self', name: 'Self' });
        mocks.tracks = [
            edited,
            makeBus({ id: 'bus-ok', name: 'Fine' }),
            // Routes its output into the edited track, so a send there is a cycle.
            makeBus({ id: 'bus-loop', name: 'Loop', outputId: 'bus-self' }),
        ];

        render(<SendsSection track={edited} />);

        expect(screen.getByRole('slider', { name: 'Send to Fine' })).toBeInTheDocument();
        expect(screen.queryByRole('slider', { name: 'Send to Self' })).not.toBeInTheDocument();
        expect(screen.queryByRole('slider', { name: 'Send to Loop' })).not.toBeInTheDocument();
    });

    it('keeps listing a bus the track already sends to so the send can be lowered', () => {
        const edited = makeBus({
            id: 'bus-self',
            name: 'Self',
            sends: [{ busId: 'bus-loop', level: 0.5, preFader: false }],
        });
        mocks.tracks = [edited, makeBus({ id: 'bus-loop', name: 'Loop', outputId: 'bus-self' })];

        render(<SendsSection track={edited} />);

        expect(screen.getByRole('slider', { name: 'Send to Loop' })).toBeInTheDocument();
    });
});
