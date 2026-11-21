type Clip = Readonly<{ id: string; type: string; audioBufferId?: string }>;
type Track<TClip extends Clip> = Readonly<{ id: string; clips: readonly TClip[] }>;

export function resolveElasticEditorTarget<TClip extends Clip>(
    editor: Readonly<{ openClipId: string | null }>,
    selection: Readonly<{ selectedClipId: string | null }> | null | undefined,
    arrangement: Readonly<{ tracks: readonly Track<TClip>[] }> | null | undefined
) {
    const clipId = editor.openClipId ?? selection?.selectedClipId ?? null;
    for (const track of arrangement?.tracks ?? []) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return { clipId, trackId: track.id, clip };
        }
    }
    return { clipId, trackId: null, clip: null };
}
