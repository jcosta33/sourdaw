type SessionUndoWitnessStampProvider = () => void;

let provider: SessionUndoWitnessStampProvider | null = null;

/**
 * CRDT persistence calls this once it has force-flushed its own deferred
 * writes and before it serializes bytes for IndexedDB, so Command's
 * undo-session mirror gets re-witnessed against the document
 * state that's actually about to become durable. A port rather than a direct
 * `#/modules/Command/useCases` import: that barrel pulls in `executeAppAction`
 * and its own `#/modules/CrdtDocument/stores` dependency, so importing it
 * from this persistence-queue file would drag every test that reaches the
 * queue — most of which mock this module's own storage/repository layer in
 * isolation — into loading the real Command module graph too. Unset outside
 * production bootstrap, where it is harmless: nothing durable was missed,
 * because the next boot's witness comparison still matches.
 */
export const sessionUndoWitnessStampPort = {
    stamp(): void {
        provider?.();
    },
    setProvider(nextProvider: SessionUndoWitnessStampProvider | null): void {
        provider = nextProvider;
    },
};
