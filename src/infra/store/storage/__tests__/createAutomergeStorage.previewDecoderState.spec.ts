import { from, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    createAutomergeStoragePreview,
    flushAutomergeStorageWrites,
} from '../createAutomergeStorage';

type RootDocument = Record<string, unknown>;
type Slot = { readonly label: string };

/** A stateful adapter: its decoder remembers the label it last decoded, like a decode mirror. */
function createStatefulAdapter(slotKey: string) {
    const decoder = { remembered: 'live-initial' };
    const storage = createAutomergeStorage<Slot>('root', slotKey, {
        decoderState: {
            capture: () => decoder.remembered,
            restore: (state: string) => {
                decoder.remembered = state;
            },
        },
        fromCrdt: (value) => {
            decoder.remembered = `decoded:${value.label}`;
            return value;
        },
    });
    return { decoder, storage };
}

function documentWith(slotKey: string, label: string): Doc<RootDocument> {
    return from<RootDocument>({ [slotKey]: { label } });
}

describe('createAutomergeStorage preview scope decoder state', () => {
    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    it('restores a stateful adapter after a preview read changes its decoder state', () => {
        const { decoder, storage } = createStatefulAdapter('decoder-state-restored');
        const preview = createAutomergeStoragePreview(new Map([['root', documentWith('decoder-state-restored', 'p')]]));

        const previewValue = preview.scope(() => storage.get());

        expect(previewValue).toEqual({ label: 'p' });
        expect(decoder.remembered).toBe('live-initial');
        preview.release();
    });

    it('restores a stateful adapter when the scoped callback throws', () => {
        const { decoder, storage } = createStatefulAdapter('decoder-state-thrown');
        const preview = createAutomergeStoragePreview(new Map([['root', documentWith('decoder-state-thrown', 'p')]]));

        expect(() =>
            preview.scope(() => {
                storage.get();
                expect(decoder.remembered).toBe('decoded:p');
                throw new Error('callback failed');
            })
        ).toThrow('callback failed');

        expect(decoder.remembered).toBe('live-initial');
        preview.release();
    });

    it('lets a later scope of the same preview continue from the state its earlier scope left', () => {
        const { decoder, storage } = createStatefulAdapter('decoder-state-continued');
        const preview = createAutomergeStoragePreview(
            new Map([['root', documentWith('decoder-state-continued', 'p')]])
        );

        preview.scope(() => storage.get());
        const stateSeenByLaterScope = preview.scope(() => decoder.remembered);

        expect(stateSeenByLaterScope).toBe('decoded:p');
        expect(decoder.remembered).toBe('live-initial');
        preview.release();
    });

    it('keeps a second preview from inheriting the first preview decoder state', () => {
        const { decoder, storage } = createStatefulAdapter('decoder-state-isolated');
        const first = createAutomergeStoragePreview(new Map([['root', documentWith('decoder-state-isolated', 'p1')]]));
        const second = createAutomergeStoragePreview(new Map([['root', documentWith('decoder-state-isolated', 'p2')]]));

        first.scope(() => storage.get());
        const stateSeenBySecond = second.scope(() => decoder.remembered);

        expect(stateSeenBySecond).toBe('live-initial');
        first.release();
        second.release();
    });

    it('swaps once for a nested scope of the same preview', () => {
        const { decoder, storage } = createStatefulAdapter('decoder-state-nested');
        const preview = createAutomergeStoragePreview(new Map([['root', documentWith('decoder-state-nested', 'p')]]));

        preview.scope(() => {
            storage.get();
            preview.scope(() => storage.get());
            expect(decoder.remembered).toBe('decoded:p');
        });

        expect(decoder.remembered).toBe('live-initial');
        preview.release();
    });

    it('leaves live decoding unchanged by a preview that ran before it', () => {
        const { decoder, storage } = createStatefulAdapter('decoder-state-live-decode');
        configureAutomergeStoragePort({
            getDoc: () => documentWith('decoder-state-live-decode', 'live'),
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: () => undefined,
        });
        const preview = createAutomergeStoragePreview(
            new Map([['root', documentWith('decoder-state-live-decode', 'p')]])
        );
        preview.scope(() => storage.get());
        preview.release();

        storage.hydrate?.();

        expect(decoder.remembered).toBe('decoded:live');
    });
});
