import { addClip } from './clip/addClip';
import { removeClip } from './clip/removeClip';
import { moveClip } from './clip/moveClip';
import { duplicateClip } from './clip/duplicateClip';
import { duplicateClipToNextBar } from './clip/duplicateClipToNextBar';
import { splitClip } from './clipEditing/splitClip';
import { trimClipStart } from './clipEditing/trimClipStart';
import { trimClipEnd } from './clipEditing/trimClipEnd';
import { setClipFade } from './clipEditing/setClipFade';
import { normalizeClip } from './clipEditing/normalizeClip';
import { reverseClip } from './clipEditing/reverseClip';
import { glueClips } from './clipEditing/glueClips';
import { nudgeClip } from './clipEditing/nudgeClip';
import { setClipGain } from './clipEditing/setClipGain';
import { setClipColor } from './clipEditing/setClipColor';
import { lockClip } from './clipEditing/lockClip';
import { crossfadeClips } from './clipEditing/crossfadeClips';
import { renameClip } from './clipEditing/renameClip';
import { muteClip } from './clipEditing/muteClip';
import { bounceSelection } from './freezeBounce/bounceOperations';
import { copySelectedClip } from './clipboard/copySelectedClip';
import { cutSelectedClip } from './clipboard/cutSelectedClip';
import { pasteClip } from './clipboard/pasteClip';
import { setClipLoop, setClipLoopLength } from './clipLoop';
import { audioToMidi, detectTempo, detectKey } from '#/modules/AudioAnalysis';
import {
    arpeggiate,
    type ArpPattern,
    type ArpRate,
    midiStore,
} from '#/modules/MIDI';
import { getTrackStoreState } from './getTrackStoreState';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { deleteTime, insertTime, duplicateTimeRange } from './timeOperations';
import { stripSilence } from './stripSilence';
import { rippleDeleteClips, planRippleDelete } from '#/modules/Workspace';

type NormalizationMode = 'peak' | 'rms' | 'lufs';

type RestoreClipAction = {
    type: 'restoreClip';
    payload: {
        clipId: string;
        trackId: string;
        clipSnapshot: unknown;
        ripplePlan: { removedClips: unknown[]; shiftedClips: unknown[] } | null;
        midiNotesSnapshot: unknown | null;
        midiCcSnapshot: unknown | null;
        midiPitchBendSnapshot: unknown | null;
    };
};

type ClipInverseAction = RestoreClipAction;

type ClipAction =
    | {
          type: 'addClip';
          payload: {
              trackId: string;
              startBeat: number;
              endBeat: number;
              name: string;
              type: 'audio' | 'midi';
              audioBufferId?: string;
          };
      }
    | { type: 'moveClip'; payload: { clipId: string; trackId: string; startBeat: number } }
    | { type: 'duplicateClip'; payload: { clipId: string } }
    | { type: 'duplicateClipToNextBar'; payload: { clipId: string } }
    | { type: 'removeClip'; payload: { clipId: string } }
    | { type: 'renameClip'; payload: { clipId: string; name: string } }
    | { type: 'splitClip'; payload: { clipId: string; beat: number } }
    | { type: 'trimClipStart'; payload: { clipId: string; newStartBeat: number } }
    | { type: 'trimClipEnd'; payload: { clipId: string; newEndBeat: number } }
    | { type: 'setClipFade'; payload: { clipId: string; fadeInBeats: number; fadeOutBeats: number } }
    | { type: 'copyClip'; payload?: undefined }
    | { type: 'cutClip'; payload?: undefined }
    | { type: 'pasteClip'; payload?: undefined }
    | { type: 'normalizeClip'; payload: { clipId: string; mode?: NormalizationMode; targetDb?: number } }
    | { type: 'reverseClip'; payload: { clipId: string } }
    | { type: 'glueClips'; payload: { clipIds: string[] } }
    | { type: 'nudgeClip'; payload: { clipId: string; beats: number } }
    | { type: 'crossfadeClips'; payload: { clipAId: string; clipBId: string; durationBeats: number } }
    | { type: 'setClipGain'; payload: { clipId: string; gain: number } }
    | { type: 'setClipColor'; payload: { clipId: string; color: string } }
    | { type: 'lockClip'; payload: { clipId: string; locked: boolean } }
    | { type: 'setClipLoop'; payload: { clipId: string; enabled: boolean } }
    | { type: 'setClipLoopLength'; payload: { clipId: string; loopLength: number } }
    | { type: 'consolidateSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'bounceSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'muteClip'; payload: { clipId: string; muted: boolean } }
    | { type: 'audioToMidi'; payload: { clipId: string; trackId?: string; sensitivity?: number; mode?: string } }
    | { type: 'deleteTime'; payload: { startBeat: number; endBeat: number } }
    | { type: 'insertTime'; payload: { atBeat: number; durationBeats: number } }
    | { type: 'duplicateTimeRange'; payload: { startBeat: number; endBeat: number } }
    | { type: 'stripSilence'; payload: { clipId: string; threshold?: number; minDuration?: number } }
    | { type: 'detectTempo'; payload: { clipId: string } }
    | { type: 'detectKey'; payload: { clipId: string } }
    | { type: 'arpeggiate'; payload: { clipId: string; pattern?: string; rate?: number; octaves?: number; gate?: number } };

type ClipHandlerResult = {
    label: string;
    inverseAction?: ClipAction | ClipInverseAction | null;
};

type ClipHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => ClipHandlerResult;
    undoable: boolean;
};

type ClipHandlers = {
    [ActionType in ClipAction['type']]: ClipHandler<Extract<ClipAction, { type: ActionType }>>;
};

export const clipHandlers: ClipHandlers = {
    addClip: {
        execute: (a) => {
            addClip(a.payload);
        },
        describe: (a) => ({ label: `Add clip "${a.payload.name}"` }),
        undoable: true,
    },

    moveClip: {
        execute: (a) => {
            moveClip(a.payload.clipId, a.payload.trackId, a.payload.startBeat);
        },
        describe: () => ({ label: 'Move clip' }),
        undoable: true,
    },

    duplicateClip: {
        execute: (a) => {
            duplicateClip(a.payload.clipId);
        },
        describe: () => ({ label: 'Duplicate clip' }),
        undoable: true,
    },

    duplicateClipToNextBar: {
        execute: (a) => {
            duplicateClipToNextBar(a.payload.clipId);
        },
        describe: () => ({ label: 'Duplicate clip to next bar' }),
        undoable: true,
    },

    removeClip: {
        execute: (a) => {
            const state = getTrackStoreState();
            let trackId: string | null = null;
            if (state) {
                for (const track of state.tracks) {
                    if (track.clips.some((c) => c.id === a.payload.clipId)) {
                        trackId = track.id;
                        break;
                    }
                }
            }
            if (!trackId) {
                removeClip(a.payload.clipId);
                return;
            }
            const rippleResult = rippleDeleteClips(trackId, [a.payload.clipId]);
            if (!rippleResult) {
                removeClip(a.payload.clipId);
            }
        },
        describe: (a) => {
            // Pre-execute snapshot: clip + MIDI satellites + ripple plan. Used by
            // the `restoreClip` inverse action. Runs before execute, so all state
            // reads reflect pre-removal state.
            const state = getTrackStoreState();
            let clipSnapshot: unknown = null;
            let trackId: string | null = null;
            if (state) {
                for (const track of state.tracks) {
                    const clip = track.clips.find((c) => c.id === a.payload.clipId);
                    if (clip) {
                        clipSnapshot = structuredClone(clip);
                        trackId = track.id;
                        break;
                    }
                }
            }
            if (!clipSnapshot || !trackId) {
                return { label: 'Remove clip' };
            }

            const plan = planRippleDelete(trackId, [a.payload.clipId]);
            const ripplePlan = plan
                ? {
                      removedClips: structuredClone(plan.removedClips) as unknown[],
                      shiftedClips: structuredClone(plan.shiftedClips) as unknown[],
                  }
                : null;

            const midiState = midiStore.value;
            const notes = midiState?.notesByClipId[a.payload.clipId];
            const cc = midiState?.ccByClipId[a.payload.clipId];
            const pb = midiState?.pitchBendByClipId[a.payload.clipId];

            return {
                label: 'Remove clip',
                inverseAction: {
                    type: 'restoreClip',
                    payload: {
                        clipId: a.payload.clipId,
                        trackId,
                        clipSnapshot,
                        ripplePlan,
                        midiNotesSnapshot: notes ? structuredClone(notes) : null,
                        midiCcSnapshot: cc ? structuredClone(cc) : null,
                        midiPitchBendSnapshot: pb ? structuredClone(pb) : null,
                    },
                },
            };
        },
        undoable: true,
    },

    renameClip: {
        execute: (a) => {
            renameClip(a.payload.clipId, a.payload.name);
        },
        describe: (a) => ({ label: `Rename clip to "${a.payload.name}"` }),
        undoable: true,
    },

    splitClip: {
        execute: (a) => {
            splitClip(a.payload.clipId, a.payload.beat);
        },
        describe: () => ({ label: 'Split clip' }),
        undoable: true,
    },

    trimClipStart: {
        execute: (a) => {
            trimClipStart(a.payload.clipId, a.payload.newStartBeat);
        },
        describe: () => ({ label: 'Trim clip start' }),
        undoable: true,
    },

    trimClipEnd: {
        execute: (a) => {
            trimClipEnd(a.payload.clipId, a.payload.newEndBeat);
        },
        describe: () => ({ label: 'Trim clip end' }),
        undoable: true,
    },

    setClipFade: {
        execute: (a) => {
            setClipFade(a.payload.clipId, a.payload.fadeInBeats, a.payload.fadeOutBeats);
        },
        describe: () => ({ label: 'Set clip fade' }),
        undoable: true,
    },

    copyClip: {
        execute: () => {
            copySelectedClip();
        },
        describe: () => ({ label: 'Copy clip' }),
        undoable: false,
    },

    cutClip: {
        execute: () => {
            cutSelectedClip();
        },
        describe: () => ({ label: 'Cut clip' }),
        undoable: true,
    },

    pasteClip: {
        execute: () => {
            pasteClip();
        },
        describe: () => ({ label: 'Paste clip' }),
        undoable: true,
    },

    normalizeClip: {
        execute: (a) => {
            normalizeClip(a.payload.clipId, a.payload.mode, a.payload.targetDb);
        },
        describe: (a) => ({ label: `Normalize clip (${a.payload.mode ?? 'peak'})` }),
        undoable: true,
    },

    reverseClip: {
        execute: (a) => {
            reverseClip(a.payload.clipId);
        },
        describe: () => ({ label: 'Reverse clip' }),
        undoable: true,
    },

    glueClips: {
        execute: (a) => {
            glueClips(a.payload.clipIds);
        },
        describe: () => ({ label: 'Glue clips' }),
        undoable: true,
    },

    nudgeClip: {
        execute: (a) => {
            nudgeClip(a.payload.clipId, a.payload.beats);
        },
        describe: (a) => ({ label: `Nudge clip ${a.payload.beats > 0 ? 'right' : 'left'}` }),
        undoable: true,
    },

    crossfadeClips: {
        execute: (a) => {
            crossfadeClips(a.payload.clipAId, a.payload.clipBId, a.payload.durationBeats);
        },
        describe: () => ({ label: 'Crossfade clips' }),
        undoable: true,
    },

    setClipGain: {
        execute: (a) => {
            setClipGain(a.payload.clipId, a.payload.gain);
        },
        describe: () => ({ label: 'Set clip gain' }),
        undoable: true,
    },

    setClipColor: {
        execute: (a) => {
            setClipColor(a.payload.clipId, a.payload.color);
        },
        describe: () => ({ label: 'Set clip color' }),
        undoable: true,
    },

    lockClip: {
        execute: (a) => {
            lockClip(a.payload.clipId, a.payload.locked);
        },
        describe: (a) => ({ label: a.payload.locked ? 'Lock clip' : 'Unlock clip' }),
        undoable: true,
    },

    setClipLoop: {
        execute: (a) => {
            setClipLoop(a.payload.clipId, a.payload.enabled);
        },
        describe: (a) => ({ label: a.payload.enabled ? 'Enable clip loop' : 'Disable clip loop' }),
        undoable: true,
    },

    setClipLoopLength: {
        execute: (a) => {
            setClipLoopLength(a.payload.clipId, a.payload.loopLength);
        },
        describe: () => ({ label: 'Set clip loop length' }),
        undoable: true,
    },

    consolidateSelection: {
        execute: async (a) => {
            await bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
        },
        describe: () => ({ label: 'Consolidate selection' }),
        undoable: true,
    },

    bounceSelection: {
        execute: (a) => {
            bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
        },
        describe: () => ({ label: 'Bounce selection to audio' }),
        undoable: true,
    },

    muteClip: {
        execute: (a) => {
            muteClip(a.payload.clipId, a.payload.muted);
        },
        describe: (a) => ({ label: a.payload.muted ? 'Mute clip' : 'Unmute clip' }),
        undoable: true,
    },

    audioToMidi: {
        execute: (a) => {
            audioToMidi({
                clipId: a.payload.clipId,
                trackId: a.payload.trackId ?? '',
                sensitivity: a.payload.sensitivity,
                mode: (a.payload.mode as 'rhythm' | 'pitched') ?? 'rhythm',
            });
        },
        describe: () => ({ label: 'Convert audio to MIDI' }),
        undoable: true,
    },

    deleteTime: {
        execute: (a) => {
            deleteTime(a.payload.startBeat, a.payload.endBeat);
        },
        describe: () => ({ label: 'Delete time' }),
        undoable: true,
    },

    insertTime: {
        execute: (a) => {
            insertTime(a.payload.atBeat, a.payload.durationBeats);
        },
        describe: () => ({ label: 'Insert time' }),
        undoable: true,
    },

    duplicateTimeRange: {
        execute: (a) => {
            duplicateTimeRange(a.payload.startBeat, a.payload.endBeat);
        },
        describe: () => ({ label: 'Duplicate time range' }),
        undoable: true,
    },

    stripSilence: {
        execute: (a) => {
            stripSilence(a.payload.clipId, a.payload.threshold, a.payload.minDuration);
        },
        describe: () => ({ label: 'Strip silence' }),
        undoable: true,
    },

    detectTempo: {
        execute: (a) => {
            const clip = getTrackStoreState()
                ?.tracks.flatMap((t) => t.clips)
                .find((c) => c.id === a.payload.clipId);
            if (clip?.audioBufferId) {
                const bpm = detectTempo(clip.audioBufferId);
                if (bpm) {
                    notifyUser(`Detected tempo: ${bpm} BPM`);
                } else {
                    notifyUser('Could not detect tempo');
                }
            }
        },
        describe: () => ({ label: 'Detect tempo from audio' }),
        undoable: false,
    },

    detectKey: {
        execute: (a) => {
            const clip = getTrackStoreState()
                ?.tracks.flatMap((t) => t.clips)
                .find((c) => c.id === a.payload.clipId);
            if (clip?.audioBufferId) {
                const result = detectKey(clip.audioBufferId);
                if (result) {
                    const conf = Math.round(result.confidence * 100);
                    notifyUser(`Detected key: ${result.key} ${result.mode} (${conf}% confidence)`);
                } else {
                    notifyUser('Could not detect key');
                }
            }
        },
        describe: () => ({ label: 'Detect key from audio' }),
        undoable: false,
    },

    arpeggiate: {
        execute: (a) => {
            arpeggiate(
                a.payload.clipId,
                (a.payload.pattern as ArpPattern) ?? 'up',
                (a.payload.rate as ArpRate) ?? 16,
                a.payload.octaves ?? 1,
                a.payload.gate ?? 80
            );
        },
        describe: (a) => ({ label: `Arpeggiate (${a.payload.pattern ?? 'up'})` }),
        undoable: true,
    },
};
