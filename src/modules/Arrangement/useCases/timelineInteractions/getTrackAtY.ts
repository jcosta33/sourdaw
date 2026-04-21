export function getTrackAtY(
    tracks: { height: number; id: string }[],
    contentY: number
): { index: number; id: string } | null {
    let offset = 0;
    for (let index = 0; index < tracks.length; index++) {
        const h = tracks[index]!.height ?? 64;
        if (contentY >= offset && contentY < offset + h) {
            return { index: index, id: tracks[index]!.id };
        }
        offset += h;
    }
    return null;
}
