import { createExpectedValueHandler } from '#/utils/createExpectedValueHandler';

import { setClipFade } from '../../useCases/clipEditing/setClipFade';
import { isMidiClip } from '../isMidiClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { readPlannedClip } from './readPlannedClip';

type Fades = { fadeInBeats: number; fadeOutBeats: number };

function requestedFades(fadeInBeats: number, fadeOutBeats: number): Fades {
    return { fadeInBeats: Math.max(0, fadeInBeats), fadeOutBeats: Math.max(0, fadeOutBeats) };
}

export const handleSetClipFade = createExpectedValueHandler<'setClipFade', Fades, Partial<Fades>>({
    // Proven by the `canReportConflict` registry honesty spec; undo step-over (#2881) relies on it.
    canReportConflict: true,
    label: () => 'Set clip fade',
    requested: (action) => requestedFades(action.payload.fadeInBeats, action.payload.fadeOutBeats),
    // Either expected fade alone guards its own side.
    expected: (action) => {
        const { expectedFadeInBeats, expectedFadeOutBeats } = action.payload;
        if (expectedFadeInBeats === undefined && expectedFadeOutBeats === undefined) {
            return undefined;
        }
        return { fadeInBeats: expectedFadeInBeats, fadeOutBeats: expectedFadeOutBeats };
    },
    matches: (current, expected) =>
        (expected.fadeInBeats === undefined || current.fadeInBeats === expected.fadeInBeats) &&
        (expected.fadeOutBeats === undefined || current.fadeOutBeats === expected.fadeOutBeats),
    sameValue: (a, b) => a.fadeInBeats === b.fadeInBeats && a.fadeOutBeats === b.fadeOutBeats,
    read: (action, context) => {
        const clip = readPlannedClip(action.payload.clipId, context);
        return clip && { fadeInBeats: clip.fadeInBeats, fadeOutBeats: clip.fadeOutBeats };
    },
    withExpected: (action, value, expected) => ({
        type: 'setClipFade',
        payload: {
            clipId: action.payload.clipId,
            fadeInBeats: value.fadeInBeats,
            fadeOutBeats: value.fadeOutBeats,
            expectedFadeInBeats: expected.fadeInBeats,
            expectedFadeOutBeats: expected.fadeOutBeats,
        },
    }),
    // MIDI playback reads no fades, so a MIDI clip is refused rather than stored.
    refuse: (action) => (isMidiClip(action.payload.clipId) ? { status: 'no-write' } : null),
    write: (action) =>
        toHandlerExecutionResult(
            setClipFade(action.payload.clipId, action.payload.fadeInBeats, action.payload.fadeOutBeats)
        ),
});
