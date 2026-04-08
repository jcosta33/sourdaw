import { inject } from '#/infra/di/inject';
import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { removeClip } from '#/modules/Arrangement/useCases/clip/removeClip';
import { moveClip } from '#/modules/Arrangement/useCases/clip/moveClip';
import { duplicateClip } from '#/modules/Arrangement/useCases/clip/duplicateClip';
import { duplicateClipToNextBar } from '#/modules/Arrangement/useCases/clip/duplicateClipToNextBar';
import { splitClip } from '#/modules/Arrangement/useCases/clipEditing/splitClip';
import { trimClipStart } from '#/modules/Arrangement/useCases/clipEditing/trimClipStart';
import { trimClipEnd } from '#/modules/Arrangement/useCases/clipEditing/trimClipEnd';
import { setClipFade } from '#/modules/Arrangement/useCases/clipEditing/setClipFade';
import { normalizeClip } from '#/modules/Arrangement/useCases/clipEditing/normalizeClip';
import { reverseClip } from '#/modules/Arrangement/useCases/clipEditing/reverseClip';
import { glueClips } from '#/modules/Arrangement/useCases/clipEditing/glueClips';
import { nudgeClip } from '#/modules/Arrangement/useCases/clipEditing/nudgeClip';
import { setClipGain } from '#/modules/Arrangement/useCases/clipEditing/setClipGain';
import { setClipColor } from '#/modules/Arrangement/useCases/clipEditing/setClipColor';
import { lockClip } from '#/modules/Arrangement/useCases/clipEditing/lockClip';
import { crossfadeClips } from '#/modules/Arrangement/useCases/clipEditing/crossfadeClips';
import { renameClip } from '#/modules/Arrangement/useCases/clipEditing/renameClip';
import { muteClip } from '#/modules/Arrangement/useCases/clipEditing/muteClip';
import { bounceSelection } from '#/modules/Arrangement/useCases/freezeBounce/bounceOperations';
import { copySelectedClip } from '#/modules/Arrangement/useCases/clipboard/copySelectedClip';
import { cutSelectedClip } from '#/modules/Arrangement/useCases/clipboard/cutSelectedClip';
import { pasteClip } from '#/modules/Arrangement/useCases/clipboard/pasteClip';
import { setClipLoop, setClipLoopLength } from '#/modules/Arrangement/useCases/clipLoop';
import { audioToMidi } from '#/modules/AudioAnalysis/useCases/audioToMidi';
import { detectTempo } from '#/modules/AudioAnalysis/useCases/tempoDetection';
import { detectKey } from '#/modules/AudioAnalysis/useCases/keyDetection';
import { arpeggiate, type ArpPattern, type ArpRate } from '#/modules/MIDI/useCases/arpeggiator';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { deleteTime, insertTime, duplicateTimeRange } from '#/modules/Arrangement/useCases/timeOperations';
import { stripSilence } from '#/modules/Arrangement/useCases/stripSilence';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { rippleDeleteClips, planRippleDelete } from '#/modules/Workspace/useCases/rippleEditing';

type ExtractAction<A extends AppAction, T extends string> = A extends { type: T } ? A : never;
type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeAddClip = inject({ addClip })(
    ({ addClip }) =>
        function executeAddClip(a: ExtractAction<AppAction, 'addClip'>): void {
            addClip(a.payload);
        }
);

export const executeMoveClip = inject({ moveClip })(
    ({ moveClip }) =>
        function executeMoveClip(a: ExtractAction<AppAction, 'moveClip'>): void {
            moveClip(a.payload.clipId, a.payload.trackId, a.payload.startBeat);
        }
);

export const executeDuplicateClip = inject({ duplicateClip })(
    ({ duplicateClip }) =>
        function executeDuplicateClip(a: ExtractAction<AppAction, 'duplicateClip'>): void {
            duplicateClip(a.payload.clipId);
        }
);

export const executeDuplicateClipToNextBar = inject({ duplicateClipToNextBar })(
    ({ duplicateClipToNextBar }) =>
        function executeDuplicateClipToNextBar(a: ExtractAction<AppAction, 'duplicateClipToNextBar'>): void {
            duplicateClipToNextBar(a.payload.clipId);
        }
);

export const executeRemoveClip = inject({ getTrackStoreState, rippleDeleteClips, removeClip })(
    ({ getTrackStoreState, rippleDeleteClips, removeClip }) =>
        function executeRemoveClip(a: ExtractAction<AppAction, 'removeClip'>): void {
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
        }
);

export const executeRenameClip = inject({ renameClip })(
    ({ renameClip }) =>
        function executeRenameClip(a: ExtractAction<AppAction, 'renameClip'>): void {
            renameClip(a.payload.clipId, a.payload.name);
        }
);

export const executeSplitClip = inject({ splitClip })(
    ({ splitClip }) =>
        function executeSplitClip(a: ExtractAction<AppAction, 'splitClip'>): void {
            splitClip(a.payload.clipId, a.payload.beat);
        }
);

export const executeTrimClipStart = inject({ trimClipStart })(
    ({ trimClipStart }) =>
        function executeTrimClipStart(a: ExtractAction<AppAction, 'trimClipStart'>): void {
            trimClipStart(a.payload.clipId, a.payload.newStartBeat);
        }
);

export const executeTrimClipEnd = inject({ trimClipEnd })(
    ({ trimClipEnd }) =>
        function executeTrimClipEnd(a: ExtractAction<AppAction, 'trimClipEnd'>): void {
            trimClipEnd(a.payload.clipId, a.payload.newEndBeat);
        }
);

export const executeSetClipFade = inject({ setClipFade })(
    ({ setClipFade }) =>
        function executeSetClipFade(a: ExtractAction<AppAction, 'setClipFade'>): void {
            setClipFade(a.payload.clipId, a.payload.fadeInBeats, a.payload.fadeOutBeats);
        }
);

export const executeCopyClip = inject({ copySelectedClip })(
    ({ copySelectedClip }) =>
        function executeCopyClip(): void {
            copySelectedClip();
        }
);

export const executeCutClip = inject({ cutSelectedClip })(
    ({ cutSelectedClip }) =>
        function executeCutClip(): void {
            cutSelectedClip();
        }
);

export const executePasteClip = inject({ pasteClip })(
    ({ pasteClip }) =>
        function executePasteClip(): void {
            pasteClip();
        }
);

export const executeNormalizeClip = inject({ normalizeClip })(
    ({ normalizeClip }) =>
        function executeNormalizeClip(a: ExtractAction<AppAction, 'normalizeClip'>): void {
            normalizeClip(a.payload.clipId, a.payload.mode, a.payload.targetDb);
        }
);

export const executeReverseClip = inject({ reverseClip })(
    ({ reverseClip }) =>
        function executeReverseClip(a: ExtractAction<AppAction, 'reverseClip'>): void {
            reverseClip(a.payload.clipId);
        }
);

export const executeGlueClips = inject({ glueClips })(
    ({ glueClips }) =>
        function executeGlueClips(a: ExtractAction<AppAction, 'glueClips'>): void {
            glueClips(a.payload.clipIds);
        }
);

export const executeNudgeClip = inject({ nudgeClip })(
    ({ nudgeClip }) =>
        function executeNudgeClip(a: ExtractAction<AppAction, 'nudgeClip'>): void {
            nudgeClip(a.payload.clipId, a.payload.beats);
        }
);

export const executeCrossfadeClips = inject({ crossfadeClips })(
    ({ crossfadeClips }) =>
        function executeCrossfadeClips(a: ExtractAction<AppAction, 'crossfadeClips'>): void {
            crossfadeClips(a.payload.clipAId, a.payload.clipBId, a.payload.durationBeats);
        }
);

export const executeSetClipGain = inject({ setClipGain })(
    ({ setClipGain }) =>
        function executeSetClipGain(a: ExtractAction<AppAction, 'setClipGain'>): void {
            setClipGain(a.payload.clipId, a.payload.gain);
        }
);

export const executeSetClipColor = inject({ setClipColor })(
    ({ setClipColor }) =>
        function executeSetClipColor(a: ExtractAction<AppAction, 'setClipColor'>): void {
            setClipColor(a.payload.clipId, a.payload.color);
        }
);

export const executeLockClip = inject({ lockClip })(
    ({ lockClip }) =>
        function executeLockClip(a: ExtractAction<AppAction, 'lockClip'>): void {
            lockClip(a.payload.clipId, a.payload.locked);
        }
);

export const executeSetClipLoop = inject({ setClipLoop })(
    ({ setClipLoop }) =>
        function executeSetClipLoop(a: ExtractAction<AppAction, 'setClipLoop'>): void {
            setClipLoop(a.payload.clipId, a.payload.enabled);
        }
);

export const executeSetClipLoopLength = inject({ setClipLoopLength })(
    ({ setClipLoopLength }) =>
        function executeSetClipLoopLength(a: ExtractAction<AppAction, 'setClipLoopLength'>): void {
            setClipLoopLength(a.payload.clipId, a.payload.loopLength);
        }
);

export const executeConsolidateSelection = inject({ bounceSelection })(
    ({ bounceSelection }) =>
        async function executeConsolidateSelection(a: ExtractAction<AppAction, 'consolidateSelection'>): Promise<void> {
            await bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
        }
);

export const executeBounceSelection = inject({ bounceSelection })(
    ({ bounceSelection }) =>
        function executeBounceSelection(a: ExtractAction<AppAction, 'bounceSelection'>): void {
            bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
        }
);

export const executeMuteClip = inject({ muteClip })(
    ({ muteClip }) =>
        function executeMuteClip(a: ExtractAction<AppAction, 'muteClip'>): void {
            muteClip(a.payload.clipId, a.payload.muted);
        }
);

export const executeAudioToMidi = inject({ audioToMidi })(
    ({ audioToMidi }) =>
        function executeAudioToMidi(a: ExtractAction<AppAction, 'audioToMidi'>): void {
            audioToMidi({
                clipId: a.payload.clipId,
                trackId: a.payload.trackId ?? '',
                sensitivity: a.payload.sensitivity,
                mode: (a.payload.mode as 'rhythm' | 'pitched') ?? 'rhythm',
            });
        }
);

export const executeDeleteTime = inject({ deleteTime })(
    ({ deleteTime }) =>
        function executeDeleteTime(a: ExtractAction<AppAction, 'deleteTime'>): void {
            deleteTime(a.payload.startBeat, a.payload.endBeat);
        }
);

export const executeInsertTime = inject({ insertTime })(
    ({ insertTime }) =>
        function executeInsertTime(a: ExtractAction<AppAction, 'insertTime'>): void {
            insertTime(a.payload.atBeat, a.payload.durationBeats);
        }
);

export const executeDuplicateTimeRange = inject({ duplicateTimeRange })(
    ({ duplicateTimeRange }) =>
        function executeDuplicateTimeRange(a: ExtractAction<AppAction, 'duplicateTimeRange'>): void {
            duplicateTimeRange(a.payload.startBeat, a.payload.endBeat);
        }
);

export const executeStripSilence = inject({ stripSilence })(
    ({ stripSilence }) =>
        function executeStripSilence(a: ExtractAction<AppAction, 'stripSilence'>): void {
            stripSilence(a.payload.clipId, a.payload.threshold, a.payload.minDuration);
        }
);

export const executeDetectTempo = inject({ getTrackStoreState, detectTempo, notifyUser })(
    ({ getTrackStoreState, detectTempo, notifyUser }) =>
        function executeDetectTempo(a: ExtractAction<AppAction, 'detectTempo'>): void {
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
        }
);

export const executeDetectKey = inject({ getTrackStoreState, detectKey, notifyUser })(
    ({ getTrackStoreState, detectKey, notifyUser }) =>
        function executeDetectKey(a: ExtractAction<AppAction, 'detectKey'>): void {
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
        }
);

export const executeArpeggiate = inject({ arpeggiate })(
    ({ arpeggiate }) =>
        function executeArpeggiate(a: ExtractAction<AppAction, 'arpeggiate'>): void {
            arpeggiate(
                a.payload.clipId,
                (a.payload.pattern as ArpPattern) ?? 'up',
                (a.payload.rate as ArpRate) ?? 16,
                a.payload.octaves ?? 1,
                a.payload.gate ?? 80
            );
        }
);

export const clipHandlers = {
    addClip: {
        execute: executeAddClip,
        describe: (a) => ({ label: `Add clip "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addClip'>>,

    moveClip: {
        execute: executeMoveClip,
        describe: () => ({ label: 'Move clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'moveClip'>>,

    duplicateClip: {
        execute: executeDuplicateClip,
        describe: () => ({ label: 'Duplicate clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'duplicateClip'>>,

    duplicateClipToNextBar: {
        execute: executeDuplicateClipToNextBar,
        describe: () => ({ label: 'Duplicate clip to next bar' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'duplicateClipToNextBar'>>,

    removeClip: {
        execute: executeRemoveClip,
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
    } satisfies ActionHandler<Extract<AppAction, 'removeClip'>>,

    renameClip: {
        execute: executeRenameClip,
        describe: (a) => ({ label: `Rename clip to "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'renameClip'>>,

    splitClip: {
        execute: executeSplitClip,
        describe: () => ({ label: 'Split clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'splitClip'>>,

    trimClipStart: {
        execute: executeTrimClipStart,
        describe: () => ({ label: 'Trim clip start' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'trimClipStart'>>,

    trimClipEnd: {
        execute: executeTrimClipEnd,
        describe: () => ({ label: 'Trim clip end' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'trimClipEnd'>>,

    setClipFade: {
        execute: executeSetClipFade,
        describe: () => ({ label: 'Set clip fade' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipFade'>>,

    copyClip: {
        execute: executeCopyClip,
        describe: () => ({ label: 'Copy clip' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'copyClip'>>,

    cutClip: {
        execute: executeCutClip,
        describe: () => ({ label: 'Cut clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'cutClip'>>,

    pasteClip: {
        execute: executePasteClip,
        describe: () => ({ label: 'Paste clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'pasteClip'>>,

    normalizeClip: {
        execute: executeNormalizeClip,
        describe: (a) => ({ label: `Normalize clip (${a.payload.mode ?? 'peak'})` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'normalizeClip'>>,

    reverseClip: {
        execute: executeReverseClip,
        describe: () => ({ label: 'Reverse clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'reverseClip'>>,

    glueClips: {
        execute: executeGlueClips,
        describe: () => ({ label: 'Glue clips' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'glueClips'>>,

    nudgeClip: {
        execute: executeNudgeClip,
        describe: (a) => ({ label: `Nudge clip ${a.payload.beats > 0 ? 'right' : 'left'}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'nudgeClip'>>,

    crossfadeClips: {
        execute: executeCrossfadeClips,
        describe: () => ({ label: 'Crossfade clips' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'crossfadeClips'>>,

    setClipGain: {
        execute: executeSetClipGain,
        describe: () => ({ label: 'Set clip gain' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipGain'>>,

    setClipColor: {
        execute: executeSetClipColor,
        describe: () => ({ label: 'Set clip color' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipColor'>>,

    lockClip: {
        execute: executeLockClip,
        describe: (a) => ({ label: a.payload.locked ? 'Lock clip' : 'Unlock clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'lockClip'>>,

    setClipLoop: {
        execute: executeSetClipLoop,
        describe: (a) => ({ label: a.payload.enabled ? 'Enable clip loop' : 'Disable clip loop' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipLoop'>>,

    setClipLoopLength: {
        execute: executeSetClipLoopLength,
        describe: () => ({ label: 'Set clip loop length' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipLoopLength'>>,

    consolidateSelection: {
        execute: executeConsolidateSelection,
        describe: () => ({ label: 'Consolidate selection' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'consolidateSelection'>>,

    bounceSelection: {
        execute: executeBounceSelection,
        describe: () => ({ label: 'Bounce selection to audio' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'bounceSelection'>>,

    muteClip: {
        execute: executeMuteClip,
        describe: (a) => ({ label: a.payload.muted ? 'Mute clip' : 'Unmute clip' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'muteClip'>>,

    audioToMidi: {
        execute: executeAudioToMidi,
        describe: () => ({ label: 'Convert audio to MIDI' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'audioToMidi'>>,

    deleteTime: {
        execute: executeDeleteTime,
        describe: () => ({ label: 'Delete time' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'deleteTime'>>,

    insertTime: {
        execute: executeInsertTime,
        describe: () => ({ label: 'Insert time' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'insertTime'>>,

    duplicateTimeRange: {
        execute: executeDuplicateTimeRange,
        describe: () => ({ label: 'Duplicate time range' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'duplicateTimeRange'>>,

    stripSilence: {
        execute: executeStripSilence,
        describe: () => ({ label: 'Strip silence' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'stripSilence'>>,

    detectTempo: {
        execute: executeDetectTempo,
        describe: () => ({ label: 'Detect tempo from audio' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'detectTempo'>>,

    detectKey: {
        execute: executeDetectKey,
        describe: () => ({ label: 'Detect key from audio' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'detectKey'>>,

    arpeggiate: {
        execute: executeArpeggiate,
        describe: (a) => ({ label: `Arpeggiate (${a.payload.pattern ?? 'up'})` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'arpeggiate'>>,
};
