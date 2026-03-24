import { controlRoomStore } from '#/modules/AudioEngine/stores/controlRoom';

export function setCueTrackLevel(cueId: string, trackId: string, level: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        cueMixes: state.cueMixes.map((c) =>
            c.id === cueId
                ? { ...c, trackLevels: { ...c.trackLevels, [trackId]: level } }
                : c
        ),
    });
}
