import { automationStore } from '../../stores/automationStore';

/**
 * Reset a local property override on an automation clip (H2).
 * The property will revert to the value defined in the parent/pooled clip.
 */
export function resetOverride(laneId: string, objectId: string, property: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    automationStore.set({
        ...state,
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            return {
                ...lane,
                objects: lane.objects.map((obj) => {
                    if (obj.id !== objectId) {
                        return obj;
                    }
                    const nextOverrides = { ...obj.overrides };
                    delete nextOverrides[property];
                    return { ...obj, overrides: nextOverrides };
                }),
            };
        }),
    });
}
