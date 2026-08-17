import { commitNativePitchEdit } from '../../repositories/audioAnalysis/commit-native-pitch-edit';
import { readNativeAudioFile } from '../../repositories/audioAnalysis/read-native-audio-file';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { decodeAudioFileBuffer } from '../decodeAudioFileBuffer';

import { processPitchEditWasm } from './processPitchEditWasm';

import type { PitchContour } from './analyzePitchForClip';

type PitchEditSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

type CommitPitchEditInput = {
    inputAudioPath: string;
    outputAudioPath: string;
    outputAudioBufferId: string;
    audioBufferId?: string;
    segments: PitchEditSegment[];
    contour: PitchContour;
};

/** `renderedAudioBufferId` names the cache entry holding the rendered audio, for
 *  the caller to repoint the clip at — playback, export, project reload and the
 *  next analysis all resolve a clip through `audioBufferId`, and nothing resolves
 *  one through a file path in either realm. Both paths therefore have to land the
 *  render in the cache before they report success, which is why this is a plain
 *  `string`: a commit that produced no reachable buffer is a failed commit, not a
 *  quietly inert one. */
type CommitPitchEditOutput = Promise<{ renderedAudioBufferId: string }>;

export async function commitPitchEdit({
    inputAudioPath,
    outputAudioPath,
    outputAudioBufferId,
    audioBufferId,
    segments,
    contour,
}: CommitPitchEditInput): CommitPitchEditOutput {
    const didCommitNatively = await commitNativePitchEdit({
        inputAudioPath,
        outputAudioPath,
        segments,
        contour,
    });

    if (didCommitNatively) {
        // The native side rendered to disk, which is where the clip's file pointer
        // will go — but disk is not where anything reads audio from. Load the render
        // back through the engine's decoder and cache it under the same id the WASM
        // path uses, so both realms converge on one repoint. `audioBufferCache.set`
        // is write-through to IndexedDB, so this also survives save and reload.
        //
        // A read or decode failure propagates rather than degrading to an inert
        // commit: the action rolls back, the clip keeps its audio and the user keeps
        // the blobs and contour to retry from. Swallowing it would repoint the clip
        // at a file this realm cannot read, destroy the pitch edit, and leave the
        // old audio playing with nothing on screen to say so.
        const renderedFile = await readNativeAudioFile({ path: outputAudioPath });
        const renderedBuffer = await decodeAudioFileBuffer(renderedFile);
        audioBufferCache.set(outputAudioBufferId, renderedBuffer);

        return { renderedAudioBufferId: outputAudioBufferId };
    }

    if (!audioBufferId) {
        throw new Error('Could not get audio buffer for clip');
    }

    const buffer = audioBufferCache.get(audioBufferId) ?? null;
    if (!buffer) {
        throw new Error('Could not get audio buffer for clip');
    }

    processPitchEditWasm(buffer, segments, contour, outputAudioBufferId);
    return { renderedAudioBufferId: outputAudioBufferId };
}
