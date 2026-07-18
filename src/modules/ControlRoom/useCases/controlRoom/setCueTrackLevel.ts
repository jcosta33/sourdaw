import { controlRoomStore } from '../../stores/controlRoom';

export function setCueTrackLevel(cueId: string, trackId: string, level: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        cueMixes: state.cueMixes.map((context) =>
            context.id === cueId ? { ...context, trackLevels: { ...context.trackLevels, [trackId]: level } } : context
        ),
    });
}
