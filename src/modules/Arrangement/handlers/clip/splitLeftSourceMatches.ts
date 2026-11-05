import { captureAudioSourceState } from '#/utils/audioSourceTime';
import { loopingMidiLengthEntry } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { isExactClipSnapshot as isClipSnapshot } from '../../stores/isExactClipSnapshot';

function preservedSplitFields(clip: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(clip).filter(([key]) => key !== 'name' && key !== 'endBeat' && key !== 'fadeOutBeats')
    );
}

function splitAudioSourceFieldsMatch(
    original: Record<string, unknown>,
    split: Record<string, unknown>,
    tempo: number
): boolean {
    if (
        original.rightClip !== null ||
        split.rightClip === null ||
        typeof original.trackId !== 'string' ||
        !isRecord(original.leftClip) ||
        typeof original.leftClip.id !== 'string' ||
        !isClipSnapshot(original.leftClip, original.leftClip.id, original.trackId) ||
        original.leftClip.type !== 'audio' ||
        !isRecord(split.leftClip)
    ) {
        return false;
    }
    const clip = original.leftClip;
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const source = captureAudioSourceState(clip, loop.loopLengthBeats, tempo);
    if (!source) {
        return false;
    }
    const promoted = {
        ...clip,
        ...source,
    };
    if (clip.loopEnabled) {
        promoted.loopLength = loop.loopLengthBeats;
        promoted.loopOriginBeat = clip.loopOriginBeat ?? clip.startBeat;
    }
    return valuesEqual(preservedSplitFields(promoted), preservedSplitFields(split.leftClip));
}

/**
 * A looping MIDI split writes the loop length the source played onto the
 * left fragment (`loopingMidiLengthEntry`), so a source that stored none
 * leaves a left carrying the derived length. Every other preserved field
 * stays exact; a non-looping or audio source derives no entry.
 */
function splitLeftMidiLoopLengthMatches(
    expected: Record<string, unknown>,
    replacement: Record<string, unknown>
): boolean {
    const whole = expected.rightClip === null ? expected : replacement;
    const split = expected.rightClip === null ? replacement : expected;
    if (
        split.rightClip === null ||
        typeof whole.trackId !== 'string' ||
        !isRecord(whole.leftClip) ||
        typeof whole.leftClip.id !== 'string' ||
        !isClipSnapshot(whole.leftClip, whole.leftClip.id, whole.trackId) ||
        !isRecord(split.leftClip)
    ) {
        return false;
    }
    const derived = { ...whole.leftClip, ...loopingMidiLengthEntry(whole.leftClip) };
    return valuesEqual(preservedSplitFields(derived), preservedSplitFields(split.leftClip));
}

/** Whether a split capture's two snapshots hold the same left source, up to what the split itself writes. */
export function splitLeftSourceMatches(
    expected: Record<string, unknown>,
    replacement: Record<string, unknown>
): boolean {
    const left = expected.leftClip;
    const otherLeft = replacement.leftClip;
    if (!isRecord(left) || !isRecord(otherLeft)) {
        return false;
    }
    // Historical splits changed only these fields; a looping MIDI split also
    // writes its derived loop length. New audio captures prove their
    // additional source promotion against the stored old governing tempo.
    if (expected.audioSourceTempoAtStart === undefined && replacement.audioSourceTempoAtStart === undefined) {
        return (
            valuesEqual(preservedSplitFields(left), preservedSplitFields(otherLeft)) ||
            splitLeftMidiLoopLengthMatches(expected, replacement)
        );
    }
    const tempo = expected.audioSourceTempoAtStart;
    if (
        typeof tempo !== 'number' ||
        !Number.isFinite(tempo) ||
        tempo <= 0 ||
        tempo !== replacement.audioSourceTempoAtStart
    ) {
        return false;
    }
    const original = expected.rightClip === null ? expected : replacement;
    const split = expected.rightClip === null ? replacement : expected;
    return splitAudioSourceFieldsMatch(original, split, tempo);
}
