import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { DEFAULT_TEMPO_BPM, readBeatAtSamples, readSecondsAtBeat, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip, type Track } from '../../models/Track';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { trackStore } from '../../stores/trackStore';
import { collectTracksClipBufferIds } from '../timeOperations/collectTracksClipBufferIds';

import { commitMixerAutomation, type CommittedMixerAutomation } from './commitMixerAutomation';
import { detectSilentBake } from './detectSilentBake';
import { renderTrackOffline, type RenderScheduleTally } from './renderOffline';
import { resolveBouncedClipEndBeat } from './resolveBouncedClipEndBeat';

/** Fader position of a track whose mixer moves now live in its bounced samples. */
const COMMITTED_FADER_GAIN = 1;
/** Pan position of a track whose mixer moves now live in its bounced samples. */
const COMMITTED_PAN = 0;

/**
 * Re-enters an open storage transaction. Structural twin of the type in
 * `createAutomergeStorage`, which keeps the shape unexported; passing a scope
 * into an async use case is the same contract `executeAppActionBatch` uses.
 */
export type BounceTransactionScope = <Result>(callback: () => Result) => Result;

export type BounceOptions = {
    includeInserts: boolean;
    includeSends: boolean;
    includeAutomation: boolean;
    normalization: 'off' | 'protection' | 'full';
    tailHandling: 'auto' | 'manual' | 'off';
    destination: 'new-track' | 'replace';
    /**
     * Whether this bounce files its own callback undo entry. Defaults to `true`, because a
     * bounce invoked on its own is the whole of what the user did and nothing else records
     * it. A caller that already owns one atomic undo unit covering the whole command — the
     * `consolidateAllTracks` handler, which bounces every eligible track behind a single
     * `restoreTrackClipStates` inverse — passes `false`: a nested entry there would sit
     * *below* the command's own entry holding a snapshot taken part-way through the loop,
     * so undoing past the command would re-apply the bounces it just reverted.
     */
    recordUndoEntry?: boolean;
    /**
     * Re-entry into the dispatching command's storage transaction. The
     * `consolidateAllTracks` handler supplies one it captured before its first
     * `await`, because its per-track loop has already crossed that `await` by
     * the second iteration — a capture inside `bounceTrack` would then find no
     * ambient transaction and silently degrade to an unscoped write. Callers
     * that invoke `bounceTrack` synchronously inside their handler's `execute`
     * omit it and let the capture below take the ambient transaction.
     */
    transactionScope?: BounceTransactionScope;
    /**
     * Receives the filing callback for this bounce's undo entry instead of the
     * entry being filed here. The dispatched handlers pass one that files from
     * the execution result's `afterCommit`/`afterAmbiguousCommit`, because
     * while `execute` runs the write merely pends in the dispatching
     * transaction — an entry filed here would survive a commit-time abort that
     * rolls the write back, leaving a phantom history step whose redo
     * resurrects the bounce outside any transaction. A caller outside a
     * command dispatch omits it and the entry files immediately.
     */
    deferUndoEntry?: (file: () => void) => void;
};

export async function bounceTrack(trackId: string, options: BounceOptions): Promise<boolean> {
    // Every write below the `await renderTrackOffline` lands after the action's
    // storage transaction has stopped being ambient, so without a capture they
    // commit on their own frame — a bounce that destroyed the source clips
    // survived an abort that should have discarded it, and a multi-track
    // consolidation persisted track by track instead of as one atomic change.
    // Captured here, while the transaction is still ambient; `await` outside,
    // write inside.
    const scope = options.transactionScope ?? captureAutomergeStorageTransactionScope();

    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track || track.clips.length === 0) {
        return false;
    }
    if (!getTrackEligibility(track.kind).acceptsBounce) {
        return false;
    }

    let startBeat = Infinity;
    let endBeat = -Infinity;
    for (const context of track.clips) {
        if (context.startBeat < startBeat) {
            startBeat = context.startBeat;
        }
        if (context.endBeat > endBeat) {
            endBeat = context.endBeat;
        }
    }

    // Add tail if requested
    let finalEndBeat = endBeat;
    if (options.tailHandling === 'manual') {
        const tempo = transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM;
        finalEndBeat += (5 * tempo) / 60; // 5 seconds fixed tail
    }

    let scheduleTally: RenderScheduleTally = { scheduledNotes: 0, scheduledBuffers: [], withheldDeviceTypes: [] };
    const renderedBuffer = await renderTrackOffline(track, startBeat, finalEndBeat, {
        onScheduled: (tally) => {
            scheduleTally = tally;
        },
        includeInserts: options.includeInserts,
        includeSends: options.includeSends,
        includeAutomation: options.includeAutomation,
        normalization: options.normalization,
        autoTail: options.tailHandling === 'auto',
    });

    if (!renderedBuffer) {
        return false;
    }

    // `destination: 'replace'` overwrites the track's clips and — when inserts
    // were included — its devices, which is the same unrecoverable write
    // flatten performs. `'new-track'` is recoverable but still writes a silent
    // clip that later enters exports, so both are refused.
    const silentBake = detectSilentBake({
        track,
        buffer: renderedBuffer,
        tally: scheduleTally,
        // Only an automation-including bounce seeds the strip from the track's
        // fader; without it `projectStripTrack` prints at a fixed neutral level
        // that is never zero.
        bakedFaderGain: options.includeAutomation ? track.gain : 1,
        // A bounce runs `targetMixer: 'bake'`, so a gain lane's absolute values
        // are written over the seeded fader — and lanes are painted linear
        // 0..1, making a lane held at the bottom exactly zero. That is
        // deliberate silence, and the guard cannot tell it from a defect
        // without modelling automation, so it stands down.
        bakesAutomation: options.includeAutomation,
        operation: 'Bounce',
    });
    if (silentBake.silentBake) {
        notifyUser(silentBake.message, 'error');
        return false;
    }

    const audioBufferId = `bounce-${trackId}-${Date.now()}`;
    cacheAudioBuffer({ buffer: renderedBuffer, bufferId: audioBufferId });

    // An auto-tail render captures and keeps the decay past the source clips,
    // so the clip must span the buffer's own duration mapped back through the
    // tempo map — writing the musical end would leave the tail cached but
    // unplayed. Manual tail already expresses its extension in beats, and tail
    // off renders exactly the musical span, so both keep `finalEndBeat`.
    let bouncedEndBeat = finalEndBeat;
    if (options.tailHandling === 'auto') {
        bouncedEndBeat = resolveBouncedClipEndBeat({
            startBeat,
            musicalEndBeat: endBeat,
            renderedBuffer,
            timelineSecondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
            projectSampleToBeat: readBeatAtSamples,
        });
    }

    const bouncedClip: Clip = {
        id: `bounced-clip-${crypto.randomUUID()}`,
        trackId: options.destination === 'replace' ? trackId : `track-bounce-${crypto.randomUUID()}`,
        name: `${track.name} (bounced)`,
        startBeat,
        endBeat: bouncedEndBeat,
        type: 'audio',
        audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    const freshState = trackStore.value;
    if (!freshState) {
        return false;
    }

    // Snapshot for undo
    const tracksBefore = structuredClone(freshState.tracks);

    // "Include Automation" bakes the target's fader and pan — and the moves of
    // its gain/pan automation lanes — into the samples (`projectStripTrack`
    // seeds the strip from them). The destination replays those samples through
    // a strip of its own, so per the bake's own law the committed state there
    // is the identity: the movements live in the audio now, and retaining the
    // source values would apply every mixer move a second time (source gain
    // 0.5 auditions as 0.25). The same reasoning retires the target's sends on
    // Replace when the bounce captured the returns — New Track already writes
    // `[]` — or the baked wet and the live send would both apply.
    //
    // The mixer commit is gated on this bounce owning its undo entry because
    // the one caller that suppresses it (consolidateAllTracks) inverts the
    // write through a track-clip-state restore that does not carry gain/pan;
    // committing there would write a level undo cannot put back. That path
    // keeps its previous behavior, and only a bounce whose undo covers the
    // write may retire automation lanes, restoring them on undo.
    const commitsMixer = options.includeAutomation && options.recordUndoEntry !== false;
    let committedMixerAutomation: CommittedMixerAutomation | null = null;

    if (options.destination === 'replace') {
        scope(() => {
            trackStore.set({
                ...freshState,
                tracks: freshState.tracks.map((time) => {
                    if (time.id !== trackId) {
                        return time;
                    }
                    return {
                        ...time,
                        clips: [bouncedClip],
                        devices: options.includeInserts ? [] : time.devices,
                        sends: options.includeSends ? [] : time.sends,
                        gain: commitsMixer ? COMMITTED_FADER_GAIN : time.gain,
                        pan: commitsMixer ? COMMITTED_PAN : time.pan,
                    };
                }),
            });
        });
        if (commitsMixer) {
            committedMixerAutomation = commitMixerAutomation(trackId);
        }
    } else {
        const altId = `alt-bounce-${crypto.randomUUID().slice(0, 8)}`;
        const newTrack: Track = {
            ...track,
            id: bouncedClip.trackId,
            name: `${track.name} (bounce)`,
            kind: 'audio',
            clips: [bouncedClip],
            devices: options.includeInserts ? [] : track.devices,
            sends: options.includeSends ? [] : track.sends,
            gain: commitsMixer ? COMMITTED_FADER_GAIN : track.gain,
            pan: commitsMixer ? COMMITTED_PAN : track.pan,
            frozen: false,
            freezeState: { status: 'unfrozen' },
            alternatives: [{ id: altId, name: 'Bounced', clips: [bouncedClip] }],
            activeAlternativeId: altId,
        };

        const insertIndex = freshState.tracks.findIndex((time) => time.id === trackId) + 1;
        const tracks = [...freshState.tracks];
        tracks.splice(insertIndex, 0, newTrack);
        scope(() => {
            trackStore.set({ ...freshState, tracks });
        });
    }

    if (options.recordUndoEntry === false) {
        return true;
    }

    // Register undo for the bounce operation. Filed through `deferUndoEntry`
    // when a dispatching command owns the outcome, so the entry exists only
    // once the write is durable — see `BounceOptions.deferUndoEntry`.
    const fileUndoEntry = () => {
        const tracksAfter = structuredClone(trackStore.value?.tracks ?? []);
        // Undo restores the pre-bounce tracks, redo the post-bounce ones; both
        // carry clips referencing audio buffers the history must keep alive.
        const restoresBufferIds = [
            ...new Set([...collectTracksClipBufferIds(tracksBefore), ...collectTracksClipBufferIds(tracksAfter)]),
        ];
        pushUndoEntry(
            'Bounce Track',
            () => {
                const state1 = trackStore.value;
                if (state1) {
                    trackStore.set({ ...state1, tracks: tracksBefore });
                }
                committedMixerAutomation?.restore();
            },
            () => {
                const state1 = trackStore.value;
                if (state1) {
                    trackStore.set({ ...state1, tracks: tracksAfter });
                }
                committedMixerAutomation?.retire();
            },
            { restoresBufferIds }
        );
    };
    if (options.deferUndoEntry) {
        options.deferUndoEntry(fileUndoEntry);
    } else {
        fileUndoEntry();
    }
    return true;
}
