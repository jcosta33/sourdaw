import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';

import { type RestoreStoredControllersInput } from './restoreStoredControllers';

type TrackClips = Parameters<typeof resolveClipsWithComping>[1];

type ResolveStoredControllerClipsInput = {
    trackId: string;
    clips: TrackClips;
    notesByClipId: Readonly<Record<string, unknown>>;
    ccByClipId: Readonly<Record<string, RestoreStoredControllersInput['clips'][number]['controlChanges']>>;
};

/**
 * The clips of a track whose stored controllers play, wherever they sit against a
 * scheduler window: the carry a relocation restores is the last value any of them left,
 * as continuous playback holds it. They are the clips the window scheduler would play
 * by its own rules (a muted clip, a clip with no note record, and the parts of a clip
 * a comp region replaces do not play), in the order it posts them, so a clip's
 * controllers are heard from the same fragments in a restore as in the window.
 */
export function resolveStoredControllerClips({
    trackId,
    clips,
    notesByClipId,
    ccByClipId,
}: ResolveStoredControllerClipsInput): RestoreStoredControllersInput['clips'] {
    const midiClips = clips.filter((clip) => !clip.muted && clip.type === 'midi');
    return resolveClipsWithComping(trackId, midiClips).flatMap((clip) => {
        const controlChanges = ccByClipId[clip.id];
        if (clip.muted || clip.type !== 'midi' || !notesByClipId[clip.id] || !controlChanges) {
            return [];
        }
        return [{ clip, controlChanges }];
    });
}
