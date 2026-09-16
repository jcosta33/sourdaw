/**
 * What a topology batch's strip reports do to the session's record of what the
 * engine's chains hold (#3575).
 *
 * A topology batch tears every strip down inside its own fence, so the reports
 * are the whole record rather than an addition to it. The pedals its brand-new
 * bodies come up without ride the batch itself, which is pinned where that
 * batch is built (`nativeLiveGraphSession.spec.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { replaceNativeChains } from '../replaceNativeChains';

describe('replaceNativeChains', () => {
    afterEach(() => {
        nativeLiveGraphSession.nativeChainByStripId = new Map();
    });

    it('takes the reports as the whole record of what the chains hold', () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['comp']]]);

        replaceNativeChains([{ kind: 'track', id: 'audio-2', deviceIds: ['eq'] }]);

        expect([...nativeLiveGraphSession.nativeChainByStripId]).toEqual([['audio-2', ['eq']]]);
    });

    it('empties the record when the batch reported no strip at all', () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['comp']]]);

        replaceNativeChains([]);

        expect([...nativeLiveGraphSession.nativeChainByStripId]).toEqual([]);
    });
});
