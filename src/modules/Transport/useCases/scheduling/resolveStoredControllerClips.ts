import { resolvePlayedMidiClips } from './resolvePlayedMidiClips';
import { type RestoreStoredControllersInput } from './restoreStoredControllers';

type ResolveStoredControllerClipsInput = {
    trackId: string;
    clips: Parameters<typeof resolvePlayedMidiClips>[1];
    ccByClipId: Readonly<Record<string, RestoreStoredControllersInput['clips'][number]['controlChanges']>>;
};

/**
 * The clips of a track whose stored controllers play, wherever they sit against a
 * scheduler window: the carry a relocation restores is the last value any of them left,
 * as continuous playback holds it. They are the clips the window scheduler would play
 * by its own rules (a muted clip and the parts of a clip a comp region replaces do not
 * play; a clip with no note list plays no notes but still plays its controllers), in
 * the order it posts them, so a clip's controllers are heard from the same fragments in
 * a restore as in the window.
 */
export function resolveStoredControllerClips({
    trackId,
    clips,
    ccByClipId,
}: ResolveStoredControllerClipsInput): RestoreStoredControllersInput['clips'] {
    return resolvePlayedMidiClips(trackId, clips).flatMap((clip) => {
        const controlChanges = ccByClipId[clip.id];
        return controlChanges ? [{ clip, controlChanges }] : [];
    });
}
