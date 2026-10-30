type Clip = Readonly<{ id: string; type: string; audioBufferId?: string }>;
type Track = Readonly<{ id: string; clips: readonly Clip[] }>;

export function resolveElasticEditorTarget(
    editor: Readonly<{ openClipId: string | null }>,
    selection: Readonly<{ selectedClipId: string | null }>,
    arrangement: Readonly<{ tracks: readonly Track[] }>
) {
    const clipId = editor.openClipId ?? selection.selectedClipId;
    for (const track of arrangement.tracks) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return { clipId, trackId: track.id, clip };
        }
    }
    return { clipId, trackId: null, clip: null };
}
