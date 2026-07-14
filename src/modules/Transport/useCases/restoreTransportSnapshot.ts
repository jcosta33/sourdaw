import { sanitize_transport_snapshot, transportStore } from '../stores/transportStore';

export function restoreTransportSnapshot(snapshot: unknown): void {
    transportStore.set(sanitize_transport_snapshot(snapshot));
}
