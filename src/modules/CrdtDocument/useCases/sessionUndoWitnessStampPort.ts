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
 * isolation — into loading the real Command module graph too. Reading it
 * before `registerCorePorts()` in `src/app/bootstrap.ts` fills it throws: a
 * stamp that was skipped would leave the next boot's witness comparison to
 * discard an undo history that was in fact durable.
 */
export const sessionUndoWitnessStampPort = {
    stamp(): void {
        if (provider === null) {
            throw new Error(
                'sessionUndoWitnessStampPort.stamp: no provider is registered; call sessionUndoWitnessStampPort.setProvider() from registerCorePorts() in src/app/bootstrap.ts'
            );
        }
        provider();
    },
    setProvider(nextProvider: SessionUndoWitnessStampProvider): void {
        provider = nextProvider;
    },
};
