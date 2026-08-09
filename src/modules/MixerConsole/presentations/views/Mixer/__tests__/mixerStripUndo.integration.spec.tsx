import { type ReactElement } from 'react';

import { render, screen, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { setTrackGain as engineSetTrackGain } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { useTracks } from '../../../hooks/useTracks';
import { ExpandedChannelStrip } from '../ExpandedChannelStrip';

/**
 * The mixer strip's own writes must reach the project the same way every other
 * surface's do.
 *
 * Deleting a track from the strip called the bare `removeTrack` use case, which
 * captures nothing, so the track and everything on it left the project
 * unrecoverably — while the identical delete from the timeline context menu or
 * the track list was one undo press away. Riding the fader wrote project truth
 * once per pointer sample and produced no history at all.
 *
 * The observables here are the project and the rendered strip, never a spy on a
 * use case: delete, press undo, and the strip is back on screen carrying its
 * clip and its device. #1550 is the reason the render is asserted as well as the
 * store — a guard that only read `trackStore` would pass even if the strip drew
 * stale state.
 *
 * Everything under the pointer is real: the Arrangement handler map,
 * `executeAppAction`, a real Automerge document, the real undo stack, the real
 * `Fader`. Only the audio-engine seam, the confirm dialog and the routing/event
 * fan-out are stubbed, and the engine seam is stubbed so it can be *counted* —
 * it is what proves the audio followed the fader mid-drag.
 */

vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: vi.fn() }));
vi.mock('#/utils/UI/useContextMenuDismiss', () => ({ useContextMenuDismiss: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getTrackAnalyser: vi.fn(() => null),
    getMasterAnalyser: vi.fn(() => null),
    getTrackPeakLevel: vi.fn(() => 0),
    getMasterPeakLevel: vi.fn(() => 0),
    removeTrackStrip: vi.fn(),
    ensureTrackStrip: vi.fn(),
    addDeviceToStrip: vi.fn(),
    updateDeviceBypass: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(() => null),
    setTrackOutput: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSolo: vi.fn(),
    setTrackSoloGate: vi.fn(),
    // `LevelMeter` constructs one per strip on first render; it is never read by
    // any assertion here, it only has to be constructible.
    VUMeter: class {
        update(): number {
            return 0;
        }
        getPeakHold(): number {
            return 0;
        }
        reset(): void {}
    },
}));
vi.mock('#/modules/Routing/useCases', () => ({
    getAllSidechainRoutes: vi.fn(() => []),
    wireSidechainRoutes: vi.fn(),
    setSend: vi.fn(),
    // Returns the finalizer the restore handler pushes straight into its
    // post-commit effect list, so it has to be callable.
    restoreSidechainRoutes: vi.fn(() => () => undefined),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    activateExternalPlugin: vi.fn(() => Promise.resolve()),
}));
/**
 * The remove/restore handlers publish `track.removed` / `track.added` through
 * the DI event bus, which only `bootstrap.ts` wires. The bus contract is a
 * use-case-private type, so it is reached through `Parameters<>` rather than a
 * re-export.
 */
const stubArrangementEventBus: Parameters<typeof setArrangementEventBus>[0] = {
    emit: () => Promise.resolve(),
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const TRACK_ID = 'strip-track';
const OTHER_TRACK_ID = 'strip-track-that-stays';
const CLIP_ID = 'clip-on-the-strip-track';
const DEVICE_NAME = 'Gluten Bus Comp';

function seedProject(): void {
    trackStore.set({
        tracks: [
            {
                id: TRACK_ID,
                name: 'Lead Vocal',
                kind: 'audio',
                muted: false,
                soloed: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                color: '#ff0000',
                clips: [
                    {
                        id: CLIP_ID,
                        trackId: TRACK_ID,
                        name: 'Take 3',
                        startBeat: 12,
                        endBeat: 20,
                        type: 'audio',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#ff0000',
                        locked: false,
                        muted: false,
                    },
                ],
                devices: [
                    {
                        id: 'device-on-the-strip-track',
                        name: DEVICE_NAME,
                        type: 'gluten',
                        bypassed: false,
                        parameterValues: { ratio: 4 },
                    },
                ],
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
            },
            {
                id: OTHER_TRACK_ID,
                name: 'Drums',
                kind: 'audio',
                muted: false,
                soloed: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                color: '#00ff00',
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
                activeAlternativeId: 'alt-2',
                alternatives: [{ id: 'alt-2', name: 'Alternative 1', clips: [] }],
                vcaGroupId: null,
                midiOutputTrackId: null,
                followChordTrack: false,
            },
        ],
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
}

/**
 * Stands in for `MixerPanel`'s strip row: subscribes to the track store exactly
 * as the panel does, so what the test sees on screen is what a re-render after
 * undo would actually put there.
 */
const MixerStripRow = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    return (
        <TooltipProvider>
            {tracks.map((track) => (
                <ExpandedChannelStrip
                    key={track.id}
                    track={track}
                    isSelected={track.id === selectedTrackId}
                    widthClass="w-24"
                />
            ))}
        </TooltipProvider>
    );
};

function trackIds(): string[] {
    return (trackStore.value?.tracks ?? []).map((track) => track.id);
}

function storedTrack(): { clips: unknown[]; devices: unknown[]; gain: number; pan: number } | undefined {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    if (!track) {
        return undefined;
    }
    return { clips: track.clips, devices: track.devices, gain: track.gain, pan: track.pan };
}

function undoLabels(): string[] {
    return (undoStore.value?.past ?? []).map((entry) => entry.label);
}

function strip(): HTMLElement {
    return screen.getByRole('group', { name: 'Lead Vocal channel' });
}

function openStripMenu(): void {
    fireEvent.contextMenu(strip(), { clientX: 0, clientY: 0 });
}

describe('mixer strip writes reach the project through the recorded path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('mixer strip undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setArrangementEventBus(stubArrangementEventBus);
        vi.mocked(confirmUser).mockResolvedValue(true);
        seedProject();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('puts the track back with its clip and its device when the strip delete is undone', async () => {
        render(<MixerStripRow />);

        openStripMenu();
        fireEvent.click(screen.getByText('Remove Channel'));

        await vi.waitFor(() => {
            expect(trackIds()).toEqual([OTHER_TRACK_ID]);
        });
        expect(screen.queryByRole('group', { name: 'Lead Vocal channel' })).toBeNull();

        await undo();

        // Order matters: a restore that appended a bare track would satisfy
        // "the id is back" while losing the strip's position in the console.
        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);
        expect(storedTrack()?.clips).toEqual([expect.objectContaining({ id: CLIP_ID, startBeat: 12, endBeat: 20 })]);
        expect(storedTrack()?.devices).toEqual([
            expect.objectContaining({ id: 'device-on-the-strip-track', name: DEVICE_NAME }),
        ]);

        // #1550: the strip has to *draw* the restored track, not merely have it
        // in the store. The device button is rendered from `track.devices`.
        await vi.waitFor(() => {
            expect(screen.getByRole('group', { name: 'Lead Vocal channel' })).toBeTruthy();
        });
        expect(screen.getByLabelText(`Remove ${DEVICE_NAME}`)).toBeTruthy();
    });

    it('tells the user what the strip delete costs instead of calling it permanent', async () => {
        render(<MixerStripRow />);

        openStripMenu();
        fireEvent.click(screen.getByText('Remove Channel'));

        await vi.waitFor(() => {
            expect(vi.mocked(confirmUser)).toHaveBeenCalled();
        });
        expect(vi.mocked(confirmUser).mock.calls[0]![0]).toEqual({
            title: 'Delete "Lead Vocal"?',
            message: 'The track, its clips and its devices are removed. Undo restores them.',
            confirmLabel: 'Delete',
            variant: 'danger',
        });
    });

    it('deletes nothing and records no history when the strip confirm is cancelled', async () => {
        vi.mocked(confirmUser).mockResolvedValue(false);
        render(<MixerStripRow />);

        openStripMenu();
        fireEvent.click(screen.getByText('Remove Channel'));

        await vi.waitFor(() => {
            expect(vi.mocked(confirmUser)).toHaveBeenCalled();
        });
        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);
        expect(undoLabels()).toEqual([]);

        await undo();
        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);
    });

    it('commits one history entry for a whole fader drag and follows the fader while it moves', async () => {
        render(<MixerStripRow />);

        const fader = screen.getByRole('slider', { name: 'Lead Vocal gain' });
        const cap = fader.querySelector('[data-role="fader-cap"]')!;

        // Downward, so every sample stays inside `clampFaderGain`'s [0, 1] —
        // a clamped sample would hide a lost intermediate value.
        fireEvent.pointerDown(cap, { button: 0, pointerId: 3, clientY: 50 });
        fireEvent.pointerMove(fader, { pointerId: 3, clientY: 60 });
        fireEvent.pointerMove(fader, { pointerId: 3, clientY: 70 });
        fireEvent.pointerMove(fader, { pointerId: 3, clientY: 80 });

        // Mid-gesture, before release: project truth is still where the gesture
        // started, and nothing is on the stack yet.
        expect(storedTrack()?.gain).toBeCloseTo(0.8, 5);
        expect(undoLabels()).toEqual([]);

        fireEvent.pointerUp(fader, { pointerId: 3 });

        await vi.waitFor(() => {
            expect(undoLabels()).toEqual(['Set track gain']);
        });

        // The audio followed under the thumb: one engine write per pointer
        // sample, each carrying that sample's value, not one write at the end.
        const engineGains = vi.mocked(engineSetTrackGain).mock.calls.map((call) => call[1]);
        expect(engineGains.length).toBeGreaterThanOrEqual(4);
        expect(engineGains[0]).toBeCloseTo(0.65, 5);
        expect(engineGains[1]).toBeCloseTo(0.5, 5);
        expect(engineGains[2]).toBeCloseTo(0.35, 5);

        // Project truth landed once, on the settled value.
        expect(storedTrack()?.gain).toBeCloseTo(0.35, 5);

        // And one press of undo returns the whole gesture to where it started,
        // not to the second-to-last pointer sample.
        await undo();
        expect(storedTrack()?.gain).toBeCloseTo(0.8, 5);
    });

    it('draws the pan gesture while it is in flight and commits it once', async () => {
        render(<MixerStripRow />);

        const knob = screen.getByRole('slider', { name: 'Lead Vocal pan' });

        fireEvent.pointerDown(knob, { button: 0, pointerId: 4, clientY: 100 });
        fireEvent.pointerMove(knob, { pointerId: 4, clientY: 90 });
        fireEvent.pointerMove(knob, { pointerId: 4, clientY: 80 });
        fireEvent.pointerMove(knob, { pointerId: 4, clientY: 70 });

        // The readout under the knob is the user's only view of where the
        // gesture is. Project truth deliberately has not moved yet, so a strip
        // that drew project truth would still say "C" here — the same class of
        // stale display as #1550, arrived at from the other side.
        expect(storedTrack()?.pan).toBe(0);
        expect(within(strip()).getByText('R20')).toBeTruthy();

        fireEvent.pointerUp(knob, { pointerId: 4 });

        await vi.waitFor(() => {
            expect(undoLabels()).toEqual(['Set track pan']);
        });
        expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.pan).toBe(20);

        await undo();
        expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.pan).toBe(0);
        expect(within(strip()).getByText('C')).toBeTruthy();
    });

    it('records a strip mute and gives it back on undo', async () => {
        render(<MixerStripRow />);

        fireEvent.click(screen.getByTestId(`channel-mute-${TRACK_ID}`));

        await vi.waitFor(() => {
            expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.muted).toBe(true);
        });
        expect(undoLabels()).toEqual(['Mute track']);

        await undo();
        expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.muted).toBe(false);
    });

    it('records a strip colour change and gives it back on undo', async () => {
        render(<MixerStripRow />);

        openStripMenu();
        const swatches = screen.getAllByLabelText('Set color');
        fireEvent.click(swatches[1]!);

        await vi.waitFor(() => {
            expect(undoLabels()).toEqual(['Set track color']);
        });

        await undo();
        expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.color).toBe('#ff0000');
    });
});
