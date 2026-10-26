import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';

type TrackClips = Parameters<typeof resolveClipsWithComping>[1];

/**
 * The MIDI clips of a track the window scheduler would play, wherever they sit against a window,
 * in the order it posts them: a muted clip and the parts of a clip a comp region replaces do not
 * play. The one rule the stored controllers and the stored channel bend share.
 */
export function resolvePlayedMidiClips(trackId: string, clips: TrackClips) {
    const midiClips = clips.filter((clip) => !clip.muted && clip.type === 'midi');
    return resolveClipsWithComping(trackId, midiClips).flatMap((clip) =>
        clip.muted || clip.type !== 'midi' ? [] : [clip]
    );
}
