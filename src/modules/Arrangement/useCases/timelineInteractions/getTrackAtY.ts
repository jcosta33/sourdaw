export function getTrackAtY(
    tracks: { height: number; id: string }[],
    contentY: number
): { index: number; id: string } | null {
    let offset = 0;
    for (let i = 0; i < tracks.length; i++) {
        const h = tracks[i]!.height ?? 64;
        if (contentY >= offset && contentY < offset + h) {
            return { index: i, id: tracks[i]!.id };
        }
        offset += h;
    }
    return null;
}
