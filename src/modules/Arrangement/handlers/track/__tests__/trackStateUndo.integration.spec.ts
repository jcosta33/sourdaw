import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
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
import { defaultKneadState, kneadStore } from '#/modules/Knead/stores';
import { updateClipKneadState } from '#/modules/Knead/useCases';
import { LEGACY_MIDI_PROBABILITY_SEED, midiStore } from '#/modules/MIDI/stores';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { readClipSatelliteEntry, writeClipSatelliteEntry } from '../../../stores/clipSatelliteState';
import { clipSelectionStore, defaultClipSelectionState } from '../../../stores/clipSelectionStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

// `disableTrack` and the solo-safe path drive the live engine strip, which jsdom's
// stubbed AudioContext cannot build. The subject here is what project truth holds after
// undo, so the engine seam is stubbed rather than exercised.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getTrackAnalyser: vi.fn(() => null),
    getMasterAnalyser: vi.fn(() => null),
    removeTrackStrip: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSolo: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function track(trackId: string) {
    return trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
}

/** Mutate the store behind the command layer's back, standing in for a collaborator's
 *  edit — or the same user's later edit — landing between the forward action and undo. */
function divergeTrack(trackId: string, patch: Record<string, unknown>): void {
    const state = trackStore.value!;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((candidate) => (candidate.id === trackId ? { ...candidate, ...patch } : candidate)),
    });
}

async function run(action: AppAction) {
    return executeAppAction(action, { source: 'manual' });
}

describe('track-state guarded undo integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('track state undo integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-1', name: 'Vocals', kind: 'audio' }),
                TrackDummy.create({ id: 'track-2', name: 'Synth', kind: 'midi' }),
                TrackDummy.create({ id: 'track-3', name: 'Pad', kind: 'midi' }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        clipSelectionStore.set(defaultClipSelectionState);
        // The guard reads both of these now, so a note or a retune left behind by one
        // case would decide the next one's conflict.
        midiStore.set({
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        kneadStore.set({ ...defaultKneadState });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    // The whole-track clip-collection rewrites — cut, paste, flatten, consolidate —
    // share one guarded inverse, `restoreTrackClipStates`. What makes them worth an
    // integration test rather than a handler unit test is that the state they destroy
    // does not live on the clip: a clip's gain envelope hangs off clip identity in a
    // separate store, and flatten overwrites seven track-level fields besides `clips`.
    // A handler test that stubs those stores cannot observe either loss.
    describe('clip-collection rewrites', () => {
        const gainEnvelope = {
            clipId: 'clip-1',
            points: [
                { id: 'gain-1', beatOffset: 0, gainDb: -12 },
                { id: 'gain-2', beatOffset: 2, gainDb: 0 },
            ],
            enabled: true,
        };

        function seedClipWithEnvelope() {
            const clip = ClipDummy.create({ id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4 });
            const state = trackStore.value!;
            trackStore.set({
                ...state,
                tracks: state.tracks.map((candidate) =>
                    candidate.id === 'track-1' ? { ...candidate, clips: [clip] } : candidate
                ),
            });
            writeClipSatelliteEntry({ clipId: 'clip-1', gainEnvelope, warpState: null });
            clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: 'clip-1' });
            return clip;
        }

        it('cut: gives back the clip and the gain envelope drawn on it', async () => {
            const clip = seedClipWithEnvelope();
            expect(readClipSatelliteEntry('clip-1').gainEnvelope).toMatchObject({ enabled: true });

            await run({ type: 'cutClip' });
            expect(track('track-1')?.clips).toEqual([]);
            // `removeClip` runs `removeClipSatelliteData`, so the envelope is gone too.
            expect(readClipSatelliteEntry('clip-1').gainEnvelope).toBeNull();

            await undo();
            expect(track('track-1')?.clips).toEqual([clip]);
            // The decisive assertion: an inverse carrying only `clips` gives the clip
            // back with a flat envelope, silently discarding the automation the musician
            // drew on it.
            expect(readClipSatelliteEntry('clip-1').gainEnvelope).toMatchObject({
                clipId: 'clip-1',
                enabled: true,
                points: [
                    { beatOffset: 0, gainDb: -12 },
                    { beatOffset: 2, gainDb: 0 },
                ],
            });

            await redo();
            expect(track('track-1')?.clips).toEqual([]);
        });

        it('cut: conflicts rather than overwriting a clip added to the track after the cut', async () => {
            seedClipWithEnvelope();
            await run({ type: 'cutClip' });

            const later = ClipDummy.create({ id: 'clip-later', trackId: 'track-1' });
            divergeTrack('track-1', { clips: [later] });

            await undo();

            // Restoring here would delete a clip the undo entry knows nothing about.
            expect(track('track-1')?.clips).toEqual([later]);
        });

        it('cut: conflicts rather than clobbering a device chain added to the track after the cut', async () => {
            seedClipWithEnvelope();
            await run({ type: 'cutClip' });

            const collaboratorDevices = [
                { id: 'device-late', type: 'reverb', name: 'Reverb', bypassed: false, parameterValues: { mix: 0.4 } },
            ];
            divergeTrack('track-1', { devices: collaboratorDevices });

            await undo();

            // The decisive assertion: `cutClip` never touched `devices`, but its snapshot
            // carries them and the restore writes them back unconditionally. A guard that
            // reads only the clip id sequence authorises that write, and the plugin a
            // collaborator added after the cut disappears with no conflict reported.
            expect(track('track-1')?.devices).toEqual(collaboratorDevices);
            // Nothing is written at all — the whole batch is refused, so the cut clip
            // stays cut rather than half-restoring the track.
            expect(track('track-1')?.clips).toEqual([]);
            expect(readClipSatelliteEntry('clip-1').gainEnvelope).toBeNull();
        });

        it('cut: conflicts rather than reinstating a superseded device-state payload', async () => {
            const device = {
                id: 'device-toaster',
                type: 'toaster',
                name: 'Toaster',
                bypassed: false,
                parameterValues: {},
                deviceState: { version: 1, data: { kitId: 'kit-808', pads: ['kick', 'snare'] } },
            };
            divergeTrack('track-1', { devices: [device] });
            seedClipWithEnvelope();
            await run({ type: 'cutClip' });

            // `setDeviceState` — the only writer of this slot — is `undoable: false`, so
            // swapping the kit after the cut files no undo entry of its own to protect it.
            divergeTrack('track-1', {
                devices: [{ ...device, deviceState: { version: 1, data: { kitId: 'kit-909', pads: ['kick'] } } }],
            });

            await undo();

            // The decisive assertion: `deviceState` is authored project truth that nothing
            // recomputes, and the restore replaces `devices` wholesale. A guard blind to it
            // reinstates the old kit here; the session store keeps the track sounding right,
            // so the loss only surfaces on the next project open.
            expect(track('track-1')?.devices[0]?.deviceState).toEqual({
                version: 1,
                data: { kitId: 'kit-909', pads: ['kick'] },
            });
            expect(track('track-1')?.clips).toEqual([]);
        });

        /** Seed a second clip on `track-1` so the cut has a sibling to spare. */
        function seedSiblingClip() {
            const sibling = ClipDummy.create({ id: 'clip-sibling', trackId: 'track-1', startBeat: 8, endBeat: 12 });
            const state = trackStore.value!;
            trackStore.set({
                ...state,
                tracks: state.tracks.map((candidate) =>
                    candidate.id === 'track-1' ? { ...candidate, clips: [...candidate.clips, sibling] } : candidate
                ),
            });
            return sibling;
        }

        it('cut: conflicts rather than reverting a Knead retune on a clip that only shares the track', async () => {
            seedClipWithEnvelope();
            seedSiblingClip();
            kneadStore.set({ ...defaultKneadState });
            await run({ type: 'cutClip' });
            // Only the selected clip goes; the sibling is untouched by the cut, and its
            // id keeps the same position in what is left.
            expect(track('track-1')?.clips.map((clip) => clip.id)).toEqual(['clip-sibling']);

            // The reachable single-user case: retune a *different* clip on the same track
            // in the Knead editor. `updateClipKneadState` writes through
            // `updateClipInStore` without going through `executeAppAction`, so this files
            // no undo entry of its own — exactly the situation `deviceState` is in.
            updateClipKneadState('clip-sibling', (state) => ({ ...state, retuneSpeedMs: 4, humanizePercent: 90 }));
            const retuned = track('track-1')?.clips[0]?.kneadState;
            expect(retuned).toMatchObject({ retuneSpeedMs: 4, humanizePercent: 90 });

            await undo();

            // The decisive assertion: the cut's snapshot carries the sibling clip as it
            // stood *before* the retune, and the restore replaces the whole clip array.
            // A guard that compares only the clip id sequence sees no change — the
            // sibling's id is in the same position on both sides — authorises the write,
            // and the retune is gone with no conflict reported.
            expect(track('track-1')?.clips[0]?.kneadState).toMatchObject({
                retuneSpeedMs: 4,
                humanizePercent: 90,
            });
            // Nothing is written at all, so the cut clip stays cut.
            expect(track('track-1')?.clips.map((clip) => clip.id)).toEqual(['clip-sibling']);
            expect(readClipSatelliteEntry('clip-1').gainEnvelope).toBeNull();
        });

        it('cut: conflicts rather than reverting a MIDI note edit on a clip that only shares the track', async () => {
            seedClipWithEnvelope();
            seedSiblingClip();
            midiStore.set({
                probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
                ccByClipId: {},
                pitchBendByClipId: {},
                notesByClipId: {
                    'clip-sibling': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                },
            });

            await run({ type: 'cutClip' });

            // A note edit on the sibling — an ordinary piano-roll drag, on a clip the cut
            // never touched.
            midiStore.set({
                ...midiStore.value!,
                notesByClipId: {
                    'clip-sibling': [{ id: 'note-1', pitch: 67, startBeat: 0, duration: 1, velocity: 100 }],
                },
            });

            await undo();

            // The decisive assertion: `captureTrackClipStates` snapshots MIDI for *every*
            // clip id on the track, and `restoreMidiClipData` replaces a clip's whole note
            // array. With no comparator over those snapshot keys the cut's undo reverts
            // the sibling's note to pitch 60 and reports the restore as written.
            expect(midiStore.value?.notesByClipId['clip-sibling']).toEqual([
                { id: 'note-1', pitch: 67, startBeat: 0, duration: 1, velocity: 100 },
            ]);
            expect(track('track-1')?.clips.map((clip) => clip.id)).toEqual(['clip-sibling']);
        });

        it('cut: conflicts rather than clobbering an edit inside a non-active alternative', async () => {
            seedClipWithEnvelope();
            await run({ type: 'cutClip' });

            // An alternative the user is not looking at: its clips never appear in
            // `track.clips`, so a clip-id-sequence guard is blind to every edit in it
            // while the restore replaces the whole `alternatives` array.
            const alternatives = [
                { id: 'alt-1', name: 'Alternative 1', clips: [] },
                {
                    id: 'alt-2',
                    name: 'Alternative 2',
                    clips: [ClipDummy.create({ id: 'clip-in-alt', trackId: 'track-1' })],
                },
            ];
            divergeTrack('track-1', { alternatives });

            await undo();

            expect(track('track-1')?.alternatives).toEqual(alternatives);
            expect(track('track-1')?.clips).toEqual([]);
        });

        it('flatten: gives back the device chain, the track kind and the frozen take', async () => {
            const clip = ClipDummy.create({ id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4 });
            const devices = [
                { id: 'device-1', type: 'instrument', name: 'Synth', params: {}, bypassed: false },
                { id: 'device-2', type: 'effect', name: 'Reverb', params: {}, bypassed: false },
            ];
            const freezeState = { status: 'frozen' as const, freezeId: 'freeze-1', frozenBufferId: 'buffer-1' };
            divergeTrack('track-1', {
                kind: 'midi',
                clips: [clip],
                devices,
                frozen: true,
                frozenBufferId: 'buffer-1',
                freezeState,
            });

            await run({ type: 'flattenTrack', payload: { trackId: 'track-1' } });
            expect(track('track-1')).toMatchObject({
                kind: 'audio',
                devices: [],
                frozen: false,
                freezeState: { status: 'unfrozen' },
            });
            expect(track('track-1')?.clips).toHaveLength(1);
            const flattenedClip = track('track-1')!.clips[0]!;

            await undo();
            // The decisive assertion: an inverse carrying only `clips` hands back the
            // MIDI clips on an audio track with no instrument, no plugins and the frozen
            // take gone — a state the musician never authored.
            expect(track('track-1')).toMatchObject({
                kind: 'midi',
                devices,
                frozen: true,
                frozenBufferId: 'buffer-1',
                freezeState,
            });
            expect(track('track-1')?.clips).toEqual([clip]);

            await redo();
            expect(track('track-1')).toMatchObject({ kind: 'audio', devices: [], frozen: false });
            expect(track('track-1')?.clips).toEqual([flattenedClip]);
        });
    });

    describe('disableTrack', () => {
        it('round-trips the original disabled state through undo and redo', async () => {
            expect(track('track-1')?.disabled).toBe(false);

            await run({ type: 'disableTrack', payload: { trackId: 'track-1', disabled: true } });
            expect(track('track-1')?.disabled).toBe(true);

            await undo();
            expect(track('track-1')?.disabled).toBe(false);

            await redo();
            expect(track('track-1')?.disabled).toBe(true);
        });

        it('leaves an already-disabled track untouched instead of recording an inverse that enables it', async () => {
            divergeTrack('track-1', { disabled: true });

            await run({ type: 'disableTrack', payload: { trackId: 'track-1', disabled: true } });
            expect(track('track-1')?.disabled).toBe(true);

            // The forward action changed nothing, so undo must not change anything
            // either. Negating the payload would have enabled the track here.
            await undo();
            expect(track('track-1')?.disabled).toBe(true);
        });

        // `disabled` holds two states, so an edit landing after the action can only move it
        // to the value undo was going to write anyway. That makes the guard's *conflict*
        // branch unreachable from the store for this action — `isNoop` absorbs the
        // divergence first — and leaves the no-op branch as the one worth pinning: undo
        // must recognise the work as already done rather than write over it.
        it('treats a disabled state already back at the pre-action value as nothing left to undo', async () => {
            await run({ type: 'disableTrack', payload: { trackId: 'track-1', disabled: true } });
            divergeTrack('track-1', { disabled: false });

            await undo();
            expect(track('track-1')?.disabled).toBe(false);

            // The entry is spent, not retried: redo must move the track forward again
            // rather than find an empty future.
            await redo();
            expect(track('track-1')?.disabled).toBe(true);
        });
    });

    describe('MIDI output routing', () => {
        it('round-trips a previously unrouted track through undo and redo', async () => {
            await run({ type: 'setMidiOutput', payload: { trackId: 'track-2', destinationTrackId: 'track-3' } });
            expect(track('track-2')?.midiOutputTrackId).toBe('track-3');

            await undo();
            expect(track('track-2')?.midiOutputTrackId).toBeNull();

            await redo();
            expect(track('track-2')?.midiOutputTrackId).toBe('track-3');
        });

        it('restores the exact prior destination when one was already routed', async () => {
            divergeTrack('track-2', { midiOutputTrackId: 'track-1' });

            await run({ type: 'setMidiOutput', payload: { trackId: 'track-2', destinationTrackId: 'track-3' } });
            expect(track('track-2')?.midiOutputTrackId).toBe('track-3');

            await undo();
            expect(track('track-2')?.midiOutputTrackId).toBe('track-1');
        });

        it('round-trips a cleared route through undo and redo', async () => {
            divergeTrack('track-2', { midiOutputTrackId: 'track-3' });

            await run({ type: 'clearMidiOutput', payload: { trackId: 'track-2' } });
            expect(track('track-2')?.midiOutputTrackId).toBeNull();

            await undo();
            expect(track('track-2')?.midiOutputTrackId).toBe('track-3');

            await redo();
            expect(track('track-2')?.midiOutputTrackId).toBeNull();
        });

        it('conflicts rather than overwriting a route changed after the set', async () => {
            await run({ type: 'setMidiOutput', payload: { trackId: 'track-2', destinationTrackId: 'track-3' } });
            divergeTrack('track-2', { midiOutputTrackId: 'track-1' });

            await undo();

            expect(track('track-2')?.midiOutputTrackId).toBe('track-1');
        });

        it('conflicts rather than overwriting a route set again after the clear', async () => {
            divergeTrack('track-2', { midiOutputTrackId: 'track-3' });
            await run({ type: 'clearMidiOutput', payload: { trackId: 'track-2' } });
            divergeTrack('track-2', { midiOutputTrackId: 'track-1' });

            await undo();

            expect(track('track-2')?.midiOutputTrackId).toBe('track-1');
        });
    });

    describe('setTrackInput', () => {
        it('round-trips the original input through undo and redo', async () => {
            divergeTrack('track-1', { inputId: 'input-a' });

            await run({ type: 'setTrackInput', payload: { trackId: 'track-1', inputId: 'input-b' } });
            expect(track('track-1')?.inputId).toBe('input-b');

            await undo();
            expect(track('track-1')?.inputId).toBe('input-a');

            await redo();
            expect(track('track-1')?.inputId).toBe('input-b');
        });

        it('conflicts rather than overwriting an input changed after the action', async () => {
            await run({ type: 'setTrackInput', payload: { trackId: 'track-1', inputId: 'input-b' } });
            divergeTrack('track-1', { inputId: 'input-c' });

            await undo();

            expect(track('track-1')?.inputId).toBe('input-c');
        });
    });

    describe('toggleSoloSafe', () => {
        it('round-trips the original solo-safe state through undo and redo', async () => {
            expect(track('track-1')?.soloSafe).toBe(false);

            await run({ type: 'toggleSoloSafe', payload: { trackId: 'track-1' } });
            expect(track('track-1')?.soloSafe).toBe(true);

            await undo();
            expect(track('track-1')?.soloSafe).toBe(false);

            await redo();
            expect(track('track-1')?.soloSafe).toBe(true);
        });

        it('conflicts rather than flipping a solo-safe state changed after the toggle', async () => {
            await run({ type: 'toggleSoloSafe', payload: { trackId: 'track-1' } });
            divergeTrack('track-1', { soloSafe: false });

            await undo();

            // A second toggle would have flipped this back to `true`, undoing a change
            // the original action never made.
            expect(track('track-1')?.soloSafe).toBe(false);
        });
    });

    describe('unfreezeTrack', () => {
        const frozenState = {
            frozen: true,
            frozenBufferId: 'freeze-buffer-1',
            freezeState: {
                status: 'frozen' as const,
                freezeId: 'freeze-1',
                frozenBufferId: 'freeze-buffer-1',
                sourceContentHash: 'hash-1',
                compensationSeconds: 0.125,
                renderSettings: {
                    sampleRate: 48000,
                    bitDepth: 32,
                    channelCount: 2,
                    tailLengthSeconds: 1.5,
                    bakeVersion: 1,
                },
                renderedAt: 1700000000000,
            },
        };

        it('restores the exact prior take, not a re-render, through undo and redo', async () => {
            divergeTrack('track-1', frozenState);

            await run({ type: 'unfreezeTrack', payload: { trackId: 'track-1' } });
            expect(track('track-1')).toMatchObject({ frozen: false, freezeState: { status: 'unfrozen' } });

            await undo();
            // Every field the take carries comes back — a re-freeze would have minted a
            // new buffer id and lost the pinned compensation and render settings.
            expect(track('track-1')).toMatchObject(frozenState);

            await redo();
            expect(track('track-1')).toMatchObject({ frozen: false, freezeState: { status: 'unfrozen' } });
        });

        it('preserves a stale pre-unfreeze state rather than collapsing it to unfrozen', async () => {
            divergeTrack('track-1', {
                frozen: true,
                frozenBufferId: 'freeze-buffer-2',
                freezeState: { status: 'stale', freezeId: 'freeze-2', frozenBufferId: 'freeze-buffer-2' },
            });

            await run({ type: 'unfreezeTrack', payload: { trackId: 'track-1' } });
            await undo();

            expect(track('track-1')).toMatchObject({
                frozen: true,
                frozenBufferId: 'freeze-buffer-2',
                freezeState: { status: 'stale', freezeId: 'freeze-2' },
            });
        });

        it('records no undo entry for an already-unfrozen track', async () => {
            await run({ type: 'unfreezeTrack', payload: { trackId: 'track-1' } });
            divergeTrack('track-1', frozenState);

            // The forward action was a no-op, so there is nothing to undo; without the
            // handler reporting that, undo would have unfrozen the take just applied.
            await undo();

            expect(track('track-1')).toMatchObject({ frozen: true, freezeState: { status: 'frozen' } });
        });

        it('conflicts rather than overwriting a take re-frozen after the unfreeze', async () => {
            divergeTrack('track-1', frozenState);
            await run({ type: 'unfreezeTrack', payload: { trackId: 'track-1' } });
            divergeTrack('track-1', {
                frozen: true,
                frozenBufferId: 'freeze-buffer-9',
                freezeState: { status: 'frozen', freezeId: 'freeze-9', frozenBufferId: 'freeze-buffer-9' },
            });

            await undo();

            expect(track('track-1')).toMatchObject({
                frozenBufferId: 'freeze-buffer-9',
                freezeState: { freezeId: 'freeze-9' },
            });
        });
    });
});
