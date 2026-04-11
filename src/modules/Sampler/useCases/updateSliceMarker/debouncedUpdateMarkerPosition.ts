import { updateMarkerPosition } from '../../stores/sliceStore';

const pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedUpdateMarkerPosition(id: string, framePosition: number): void {
    const existing = pendingUpdates.get(id);
    if (existing !== undefined) {
        clearTimeout(existing);
    }

    pendingUpdates.set(
        id,
        setTimeout(() => {
            pendingUpdates.delete(id);
            updateMarkerPosition(id, framePosition);
        }, 50)
    );
}