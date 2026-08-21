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
import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
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
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
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
