import { controlRoomStore, getNextCueId, type CueMix } from '#/modules/AudioEngine/stores/controlRoom';

export function createCueMix(name: string): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    const cue: CueMix = {
        id: getNextCueId(),
        name,
        trackLevels: {},
        masterLevel: 0.8,
        panOverride: {},
    };

    controlRoomStore.set({
        ...state,
        cueMixes: [...state.cueMixes, cue],
        activeCueId: state.activeCueId ?? cue.id,
    });
}
