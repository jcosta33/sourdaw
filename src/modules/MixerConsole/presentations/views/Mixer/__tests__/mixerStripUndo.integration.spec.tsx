import { type ReactElement } from 'react';

import { render, screen, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { setTrackGain as engineSetTrackGain } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    isRecordingAutomation,
    setAutomationRecordingDependencies,
    stopAutomationRecording,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
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
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
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
vi.mock('#/modules/AudioEngine/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/AudioEngine/useCases')>(
        '#/modules/AudioEngine/useCases'
    );

    return {
        ...actual,
        updateDeviceParam: vi.fn(),
        getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
        getRuntimeGraphRevision: vi.fn(() => 0),
        initializeTrackStripFromSnapshot: vi.fn(() => ({
            acceptance: 'accepted' as const,
            application: 'applied' as const,
            correlation: { appRevision: 0, projectRevision: 'project-revision-1' },
            runtimeRevision: 1,
        })),
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
    };
});
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
    // Spreading the real AudioEngine/useCases barrel below pulls in its own
    // engine internals (TrackNode -> wasmDeviceRegistry), which import this
    // barrel at module scope to build its Faust device matcher. None of this
    // spec's devices are Faust modules, so the matcher only has to resolve.
    isFaustModule: vi.fn(() => false),
    isFaustInstrumentModule: vi.fn(() => false),
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

/**
 * Stands in for `actionHistoryStore`, which is an Automerge slot of the *root*
 * document — shared with every peer, capped at 200 entries, evicting oldest
 * first. Recording what reaches it is how the tests below can tell a local undo
 * entry apart from a claim on a collaborator's history panel.
 */
const sharedHistoryLabels: string[] = [];
const recordingActionHistoryMetadataPort = {
    record: (metadata: { label: string }) => {
        sharedHistoryLabels.push(metadata.label);
        return [];
    },
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

const GAIN_LANE_ID = 'lane-gain-strip-track';

/**
 * Arm a real automation recording session for the strip's gain: a lane to write
 * into, a rolling transport, and the latency-compensation seam the recorder
 * reads. `getCompensationDelay` is zero so a recorded beat is the playhead beat
 * and the assertions can name exact beats.
 */
function armGainAutomation(mode: 'write' | 'touch'): void {
    setAutomationRecordingDependencies({
        getAudioContext: () => ({ baseLatency: 0, outputLatency: 0 }) as unknown as AudioContext,
        getCompensationDelay: () => 0,
    });
    automationStore.set({
        lanes: [
            {
                id: GAIN_LANE_ID,
                trackId: TRACK_ID,
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [],
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 1,
            },
        ],
    });
    trackStore.set({
        ...trackStore.value!,
        tracks: (trackStore.value?.tracks ?? []).map((track) =>
            track.id === TRACK_ID ? { ...track, automationMode: mode } : track
        ),
    });
    transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 0 });
}

function movePlayheadTo(beat: number): void {
    transportStore.set({ ...transportStore.value!, playheadPosition: beat });
}

function recordedGainPoints(): Array<{ beat: number; value: number }> {
    const lane = automationStore.value?.lanes.find((candidate) => candidate.id === GAIN_LANE_ID);
    return (lane?.points ?? []).map((point) => ({ beat: point.beat, value: point.value }));
}

/**
 * A V-shaped ride: down to the floor and back up. A straight ramp would collapse
 * to its two endpoints under `simplifyGesturePoints`' RDP pass and could not
 * tell a recorded gesture apart from a recorded endpoint, which is the whole
 * question here. The vertex survives thinning, so its presence is the proof the
 * ride itself was recorded.
 */
function rideFaderInAVee(fader: HTMLElement): void {
    const cap = fader.querySelector('[data-role="fader-cap"]')!;
    fireEvent.pointerDown(cap, { button: 0, pointerId: 5, clientY: 50 });
    const samples: Array<[number, number]> = [
        [1, 60],
        [2, 70],
        [3, 80],
        [4, 70],
        [5, 60],
    ];
    for (const [beat, clientY] of samples) {
        movePlayheadTo(beat);
        fireEvent.pointerMove(fader, { pointerId: 5, clientY });
    }
    movePlayheadTo(6);
    fireEvent.pointerUp(fader, { pointerId: 5 });
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
        setActionHistoryMetadataPort(recordingActionHistoryMetadataPort);
        sharedHistoryLabels.length = 0;
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
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
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
        // started, nothing is on the stack yet, and the strip's dB readout has
        // nonetheless followed the thumb down to -18.0.
        expect(storedTrack()?.gain).toBeCloseTo(0.8, 5);
        expect(undoLabels()).toEqual([]);
        expect(within(strip()).getByText('-18.0 dB')).toBeTruthy();
        // The fader itself, not only the readout beside it: `aria-valuenow` is
        // what a screen reader is told the control is currently set to.
        expect(Number(fader.getAttribute('aria-valuenow'))).toBeCloseTo(0.35, 5);

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
        // The knob itself, not only the label beneath it: `aria-valuenow` is
        // what a screen reader is told the control is currently set to.
        expect(knob.getAttribute('aria-valuenow')).toBe('20');

        fireEvent.pointerUp(knob, { pointerId: 4 });

        await vi.waitFor(() => {
            expect(undoLabels()).toEqual(['Set track pan']);
        });
        expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.pan).toBe(20);

        await undo();
        expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.pan).toBe(0);
        expect(within(strip()).getByText('C')).toBeTruthy();
    });

    /**
     * A fader ride *is* the automation, not a value that happens to land at the
     * end of one. Every DAW that records mixer moves records the ride and then
     * offers to thin it — Pro Tools writes "a series of very small steps" and
     * ships Degree of Thinning; Live warns about envelopes with many
     * breakpoints "e.g., after recording automation" and ships Simplify
     * Envelope; REAPER ships point reduction; Logic records "any controller
     * movements" as nodes. This repo already agrees:
     * `flushPendingPoints.ts` thins on flush precisely so "a full-rate
     * fader/MIDI ride does not persist raw into project truth".
     *
     * Splitting the gesture from its commit must not throw the gesture away.
     */
    it('records the shape of a fader ride in touch mode, not just where it stopped', async () => {
        armGainAutomation('touch');
        render(<MixerStripRow />);

        rideFaderInAVee(screen.getByRole('slider', { name: 'Lead Vocal gain' }));

        await vi.waitFor(() => {
            expect(undoLabels()).toEqual(['Set track gain']);
        });

        const points = recordedGainPoints();
        // The vertex is the ride. A lane holding only the release value cannot
        // contain it, and RDP keeps it because it is the turn.
        const vertex = points.find((point) => point.beat === 3);
        expect(vertex?.value).toBeCloseTo(0.35, 5);
        // The ride spans the beats it was performed over rather than collapsing
        // onto the release beat.
        expect(points.filter((point) => point.beat >= 1 && point.beat <= 5).length).toBeGreaterThanOrEqual(3);
    });

    it('records the shape of a fader ride in write mode, not just where it stopped', async () => {
        armGainAutomation('write');
        render(<MixerStripRow />);

        rideFaderInAVee(screen.getByRole('slider', { name: 'Lead Vocal gain' }));

        await vi.waitFor(() => {
            expect(undoLabels()).toEqual(['Set track gain']);
        });
        // Write mode holds its pass in the recording buffer until the transport
        // stops — that is where its flush lives, not on release.
        stopAutomationRecording();

        const points = recordedGainPoints();
        const vertex = points.find((point) => point.beat === 3);
        expect(vertex?.value).toBeCloseTo(0.35, 5);
        expect(points.filter((point) => point.beat >= 1 && point.beat <= 5).length).toBeGreaterThanOrEqual(3);
    });

    /**
     * `releaseGainAutomation` fires synchronously on pointerup while the commit
     * that follows it is a dispatch — so a commit that records automation lands
     * *after* the release and re-arms the lane. `releaseTouchAutomation.ts`
     * exists to stop exactly that: a lane left armed keeps being skipped by
     * `applyAutomation` and the engine drifts off the curve until transport
     * stop.
     */
    it('leaves touch automation released after the gain commit has settled', async () => {
        armGainAutomation('touch');
        render(<MixerStripRow />);

        rideFaderInAVee(screen.getByRole('slider', { name: 'Lead Vocal gain' }));

        await vi.waitFor(() => {
            expect(undoLabels()).toEqual(['Set track gain']);
        });

        expect(isRecordingAutomation(TRACK_ID, 'gain')).toBe(false);
    });

    /**
     * The commit is asynchronous, so handing the display back to project truth
     * at dispatch time shows the pre-gesture value until the write lands — the
     * fader visibly snaps back for a frame at the end of every move.
     */
    it('does not snap the fader back to its pre-gesture value while the commit is in flight', async () => {
        render(<MixerStripRow />);

        const fader = screen.getByRole('slider', { name: 'Lead Vocal gain' });
        const cap = fader.querySelector('[data-role="fader-cap"]')!;
        fireEvent.pointerDown(cap, { button: 0, pointerId: 6, clientY: 50 });
        fireEvent.pointerMove(fader, { pointerId: 6, clientY: 70 });
        expect(Number(fader.getAttribute('aria-valuenow'))).toBeCloseTo(0.5, 5);

        fireEvent.pointerUp(fader, { pointerId: 6 });

        // Read before awaiting anything: this is the frame the user sees between
        // releasing the fader and the write landing.
        expect(storedTrack()?.gain).toBeCloseTo(0.8, 5);
        expect(Number(fader.getAttribute('aria-valuenow'))).toBeCloseTo(0.5, 5);
        expect(within(strip()).getByText('-12.0 dB')).toBeTruthy();

        await vi.waitFor(() => {
            expect(storedTrack()?.gain).toBeCloseTo(0.5, 5);
        });
        expect(Number(fader.getAttribute('aria-valuenow'))).toBeCloseTo(0.5, 5);
    });

    /**
     * A hand on the M button during a mix is a performance, not an edit, and
     * `actionHistoryStore` is not a local scratchpad — it is an Automerge slot
     * of the *root* document, shared with every peer, capped at 200 and evicting
     * oldest first. A mixing pass measured at 7 entries, 6 of them toggles,
     * therefore spends a collaborator's 50-entry panel in about seven passes and
     * pushes their structural entries toward eviction, which revokes their
     * replay capability for the ones that vanish.
     *
     * So the toggle is dispatched with `skipUndo`: the write still runs inside
     * the Automerge transaction, so it syncs, persists and merges exactly as
     * before — only the history claim is declined.
     */
    it('mutes through the transaction without spending a shared history entry', async () => {
        render(<MixerStripRow />);

        fireEvent.click(screen.getByTestId(`channel-mute-${TRACK_ID}`));

        await vi.waitFor(() => {
            expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.muted).toBe(true);
        });
        expect(undoLabels()).toEqual([]);
        expect(sharedHistoryLabels).toEqual([]);

        // The button reflects it, so the toggle is not merely unrecorded — it
        // landed everywhere a peer would see it.
        expect(within(strip()).getByRole('button', { name: 'Unmute' })).toBeTruthy();
    });

    it('solos and solo-safes through the transaction without spending a shared history entry', async () => {
        render(<MixerStripRow />);

        fireEvent.click(screen.getByTestId(`channel-solo-${TRACK_ID}`), { metaKey: true });
        await vi.waitFor(() => {
            expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.soloed).toBe(true);
        });

        openStripMenu();
        fireEvent.click(screen.getByText('Solo Safe'));
        await vi.waitFor(() => {
            expect(trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID)?.soloSafe).toBe(true);
        });

        expect(undoLabels()).toEqual([]);
        expect(sharedHistoryLabels).toEqual([]);
    });

    /**
     * The handlers stay `undoable: true`. Declining the entry is the *surface's*
     * decision, so a mute the assistant or the command list issues is still an
     * edit and still reversible — which is the half of this that a blanket
     * `undoable: false` on the handler would have thrown away.
     */
    it('still records a mute issued as an ordinary action rather than as a performance', async () => {
        await executeAppAction({
            type: 'muteTrack',
            payload: { trackId: TRACK_ID, muted: true, expectedMuted: false },
        });

        expect(undoLabels()).toEqual(['Mute track']);
        expect(sharedHistoryLabels).toEqual(['Mute track']);

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
