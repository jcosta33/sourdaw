import { init, save } from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { processLoad } from '../crdtWorker';

describe('crdtWorker processLoad', () => {
    it('rejects an orphan incremental before compaction', () => {
        const root = save(init<Record<string, unknown>>('aaaaaaaaaaaaaaaa'));
        const bundle = new Map([
            ['root', root],
            ['orphan-child:incremental:1-0', new Uint8Array([1, 2, 3])],
        ]);

        expect(() => processLoad(bundle)).toThrow('missing base document');
    });
});
