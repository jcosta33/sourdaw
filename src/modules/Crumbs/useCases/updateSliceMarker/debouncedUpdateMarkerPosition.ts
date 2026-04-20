import { updateMarkerPosition } from '../../stores/sliceStore';

const pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedUpdateMarkerPosition(instanceId: string, id: string, framePosition: number): void {
    const key = `${instanceId}:${id}`;
    const existing = pendingUpdates.get(key);
    if (existing !== undefined) {
        clearTimeout(existing);
    }

    pendingUpdates.set(
        key,
        setTimeout(() => {
            pendingUpdates.delete(key);
            updateMarkerPosition(instanceId, id, framePosition);
        }, 50)
    );
}
