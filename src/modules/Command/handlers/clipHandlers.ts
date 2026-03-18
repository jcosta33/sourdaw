import { type ActionHandler } from '../models/ActionHandler';
import { type AppAction } from '../models/AppAction';
import {
    addClip,
    removeClip,
    moveClip,
    duplicateClip,
    duplicateClipToNextBar,
} from '#/modules/Track/useCases/clipUseCases';
import {
    splitClip,
    trimClipStart,
    trimClipEnd,
    setClipFade,
    normalizeClip,
    reverseClip,
    glueClips,
    nudgeClip,
    setClipGain,
    setClipColor,
    lockClip,
    crossfadeClips,
    renameClip,
    muteClip,
} from '#/modules/Track/useCases/clipEditingUseCases';
import { bounceSelection } from '#/modules/Track/useCases/freezeBounce';
import { copySelectedClip, cutSelectedClip, pasteClip } from '#/modules/Track/useCases/clipboardUseCases';
import { setClipLoop, setClipLoopLength } from '#/modules/Track/useCases/clipLoopUseCases';
import { audioToMidi } from '#/modules/AiRuntime/useCases/audioToMidi';
import { detectTempo } from '#/modules/AiRuntime/useCases/tempoDetection';
import { detectKey } from '#/modules/AiRuntime/useCases/keyDetection';
import { arpeggiate, type ArpPattern, type ArpRate } from '#/modules/Track/useCases/arpeggiator';
import { getTrackStoreState } from '#/modules/Track/useCases/trackQueries';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { deleteTime, insertTime, duplicateTimeRange } from '#/modules/Track/useCases/timeOperations';
import { stripSilence } from '#/modules/Track/useCases/stripSilence';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { updateTrack } from '#/modules/Track/repositories/trackRepository';
import { pushUndoEntry } from '../useCases/pushUndoEntry';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const clipHandlers = {
    addClip: {
        execute: (a) => {
            addClip(a.payload);
        },
        describe: (a) => ({ label: `Add clip "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addClip'>>,

    moveClip: {
        execute: (a) => {
            moveClip(a.payload.clipId, a.payload.trackId, a.payload.startBeat);
        },
        describe: () => ({ label: 'Move clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'moveClip'>>,

    duplicateClip: {
        execute: (a) => {
            duplicateClip(a.payload.clipId);
        },
        describe: () => ({ label: 'Duplicate clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'duplicateClip'>>,

    duplicateClipToNextBar: {
        execute: (a) => {
            duplicateClipToNextBar(a.payload.clipId);
        },
        describe: () => ({ label: 'Duplicate clip to next bar' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'duplicateClipToNextBar'>>,

    removeClip: {
        execute: (a) => {
            // Find the clip and its track before deletion
            const state = getTrackStoreState();
            let clipSnapshot: { id: string; trackId: string; name: string; startBeat: number; endBeat: number; type: string; [key: string]: unknown } | null = null;
            let trackId: string | null = null;

            if (state) {
                for (const track of state.tracks) {
                    const clip = track.clips.find((c) => c.id === a.payload.clipId);
                    if (clip) {
                        clipSnapshot = JSON.parse(JSON.stringify(clip));
                        trackId = track.id;
                        break;
                    }
                }
            }

            // Snapshot MIDI data for this clip
            const midiState = midiStore.value;
            const notesSnapshot = midiState?.notesByClipId[a.payload.clipId]
                ? JSON.parse(JSON.stringify(midiState.notesByClipId[a.payload.clipId]))
                : null;
            const ccSnapshot = midiState?.ccByClipId[a.payload.clipId]
                ? JSON.parse(JSON.stringify(midiState.ccByClipId[a.payload.clipId]))
                : null;
            const pbSnapshot = midiState?.pitchBendByClipId[a.payload.clipId]
                ? JSON.parse(JSON.stringify(midiState.pitchBendByClipId[a.payload.clipId]))
                : null;

            // Execute the removal
            removeClip(a.payload.clipId);

            // Push callback undo entry
            if (clipSnapshot && trackId) {
                const savedTrackId = trackId;
                const savedClip = clipSnapshot;
                pushUndoEntry(
                    'Remove clip',
                    () => {
                        // Undo: restore clip to its track
                        updateTrack(savedTrackId, (t) => ({ ...t, clips: [...t.clips, savedClip as never] }));
                        // Restore MIDI data
                        const currentMidi = midiStore.value;
                        if (currentMidi && (notesSnapshot || ccSnapshot || pbSnapshot)) {
                            midiStore.set({
                                notesByClipId: notesSnapshot
                                    ? { ...currentMidi.notesByClipId, [a.payload.clipId]: notesSnapshot }
                                    : currentMidi.notesByClipId,
                                ccByClipId: ccSnapshot
                                    ? { ...currentMidi.ccByClipId, [a.payload.clipId]: ccSnapshot }
                                    : currentMidi.ccByClipId,
                                pitchBendByClipId: pbSnapshot
                                    ? { ...currentMidi.pitchBendByClipId, [a.payload.clipId]: pbSnapshot }
                                    : currentMidi.pitchBendByClipId,
                            });
                        }
                    },
                    () => {
                        // Redo: remove again
                        removeClip(a.payload.clipId);
                    }
                );
            }
        },
        describe: () => ({ label: 'Remove clip' }),
        undoable: false, // handler manages its own undo entry
    } satisfies ActionHandler<Extract<AppAction, 'removeClip'>>,

    renameClip: {
        execute: (a) => {
            renameClip(a.payload.clipId, a.payload.name);
        },
        describe: (a) => ({ label: `Rename clip to "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'renameClip'>>,

    splitClip: {
        execute: (a) => {
            splitClip(a.payload.clipId, a.payload.beat);
        },
        describe: () => ({ label: 'Split clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'splitClip'>>,

    trimClipStart: {
        execute: (a) => {
            trimClipStart(a.payload.clipId, a.payload.newStartBeat);
        },
        describe: () => ({ label: 'Trim clip start' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'trimClipStart'>>,

    trimClipEnd: {
        execute: (a) => {
            trimClipEnd(a.payload.clipId, a.payload.newEndBeat);
        },
        describe: () => ({ label: 'Trim clip end' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'trimClipEnd'>>,

    setClipFade: {
        execute: (a) => {
            setClipFade(a.payload.clipId, a.payload.fadeInBeats, a.payload.fadeOutBeats);
        },
        describe: () => ({ label: 'Set clip fade' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipFade'>>,

    copyClip: {
        execute: () => {
            copySelectedClip();
        },
        describe: () => ({ label: 'Copy clip' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'copyClip'>>,

    cutClip: {
        execute: () => {
            cutSelectedClip();
        },
        describe: () => ({ label: 'Cut clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'cutClip'>>,

    pasteClip: {
        execute: () => {
            pasteClip();
        },
        describe: () => ({ label: 'Paste clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'pasteClip'>>,

    normalizeClip: {
        execute: (a) => {
            normalizeClip(a.payload.clipId, a.payload.mode, a.payload.targetDb);
        },
        describe: (a) => ({ label: `Normalize clip (${a.payload.mode ?? 'peak'})` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'normalizeClip'>>,

    reverseClip: {
        execute: (a) => {
            reverseClip(a.payload.clipId);
        },
        describe: () => ({ label: 'Reverse clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'reverseClip'>>,

    glueClips: {
        execute: (a) => {
            glueClips(a.payload.clipIds);
        },
        describe: () => ({ label: 'Glue clips' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'glueClips'>>,

    nudgeClip: {
        execute: (a) => {
            nudgeClip(a.payload.clipId, a.payload.beats);
        },
        describe: (a) => ({ label: `Nudge clip ${a.payload.beats > 0 ? 'right' : 'left'}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'nudgeClip'>>,

    crossfadeClips: {
        execute: (a) => {
            crossfadeClips(a.payload.clipAId, a.payload.clipBId, a.payload.durationBeats);
        },
        describe: () => ({ label: 'Crossfade clips' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'crossfadeClips'>>,

    setClipGain: {
        execute: (a) => {
            setClipGain(a.payload.clipId, a.payload.gain);
        },
        describe: () => ({ label: 'Set clip gain' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipGain'>>,

    setClipColor: {
        execute: (a) => {
            setClipColor(a.payload.clipId, a.payload.color);
        },
        describe: () => ({ label: 'Set clip color' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipColor'>>,

    lockClip: {
        execute: (a) => {
            lockClip(a.payload.clipId, a.payload.locked);
        },
        describe: (a) => ({ label: a.payload.locked ? 'Lock clip' : 'Unlock clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'lockClip'>>,

    setClipLoop: {
        execute: (a) => {
            setClipLoop(a.payload.clipId, a.payload.enabled);
        },
        describe: (a) => ({ label: a.payload.enabled ? 'Enable clip loop' : 'Disable clip loop' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipLoop'>>,

    setClipLoopLength: {
        execute: (a) => {
            setClipLoopLength(a.payload.clipId, a.payload.loopLength);
        },
        describe: () => ({ label: 'Set clip loop length' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipLoopLength'>>,

    consolidateSelection: {
        execute: async (a) => {
            await bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
        },
        describe: () => ({ label: 'Consolidate selection' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'consolidateSelection'>>,

    bounceSelection: {
        execute: (a) => {
            bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
        },
        describe: () => ({ label: 'Bounce selection to audio' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'bounceSelection'>>,

    muteClip: {
        execute: (a) => {
            muteClip(a.payload.clipId, a.payload.muted);
        },
        describe: (a) => ({ label: a.payload.muted ? 'Mute clip' : 'Unmute clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'muteClip'>>,

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
    } satisfies ActionHandler<Extract<AppAction, 'audioToMidi'>>,

    deleteTime: {
        execute: (a) => {
            deleteTime(a.payload.startBeat, a.payload.endBeat);
        },
        describe: () => ({ label: 'Delete time' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'deleteTime'>>,

    insertTime: {
        execute: (a) => {
            insertTime(a.payload.atBeat, a.payload.durationBeats);
        },
        describe: () => ({ label: 'Insert time' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'insertTime'>>,

    duplicateTimeRange: {
        execute: (a) => {
            duplicateTimeRange(a.payload.startBeat, a.payload.endBeat);
        },
        describe: () => ({ label: 'Duplicate time range' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'duplicateTimeRange'>>,

    stripSilence: {
        execute: (a) => {
            stripSilence(a.payload.clipId, a.payload.threshold, a.payload.minDuration);
        },
        describe: () => ({ label: 'Strip silence' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'stripSilence'>>,

    detectTempo: {
        execute: (a) => {
            const clip = getTrackStoreState()?.tracks.flatMap((t) => t.clips).find((c) => c.id === a.payload.clipId);
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
    } satisfies ActionHandler<Extract<AppAction, 'detectTempo'>>,

    detectKey: {
        execute: (a) => {
            const clip = getTrackStoreState()?.tracks.flatMap((t) => t.clips).find((c) => c.id === a.payload.clipId);
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
    } satisfies ActionHandler<Extract<AppAction, 'detectKey'>>,

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
    } satisfies ActionHandler<Extract<AppAction, 'arpeggiate'>>,
};
