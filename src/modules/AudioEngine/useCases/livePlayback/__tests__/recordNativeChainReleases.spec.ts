/**
 * What an unload's released strip reports do to the session's record of what
 * the engine's chains hold (#3793).
 *
 * Unlike `recordNativeChains`, an unload never creates a strip — it only ever
 * releases chain entries the session's own topology batch already built — so
 * a report naming a strip this session never built has nothing to narrow.
 */

import { describe, expect, it } from 'vitest';

import { type AudioGraphStripReport } from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { recordNativeChainReleases } from '../recordNativeChainReleases';

describe('recordNativeChainReleases', () => {
    it('narrows a held strip to the chain the release left it with', () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['comp', 'proq', 'limiter']]]);

        recordNativeChainReleases([{ id: 'audio-1', deviceIds: ['comp', 'limiter'] }]);

        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-1')).toEqual(['comp', 'limiter']);
    });

    it('ignores a report naming a strip this session never built', () => {
        const before = new Map([['audio-1', ['comp', 'limiter']]]);
        nativeLiveGraphSession.nativeChainByStripId = before;

        recordNativeChainReleases([{ id: 'audio-9', deviceIds: [] }]);

        expect(nativeLiveGraphSession.nativeChainByStripId).toBe(before);
        expect(nativeLiveGraphSession.nativeChainByStripId.size).toBe(1);
        expect(nativeLiveGraphSession.nativeChainByStripId.has('audio-9')).toBe(false);
    });

    it('does nothing with an empty report list', () => {
        const before = new Map([['audio-1', ['comp']]]);
        nativeLiveGraphSession.nativeChainByStripId = before;

        recordNativeChainReleases([]);

        expect(nativeLiveGraphSession.nativeChainByStripId).toBe(before);
    });

    it('narrows only the held strips among a mixed report list', () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([
            ['audio-1', ['comp', 'proq']],
            ['audio-2', ['eq']],
        ]);
        const reports: AudioGraphStripReport[] = [
            { kind: 'track', id: 'audio-1', deviceIds: ['comp'] },
            { kind: 'track', id: 'audio-9', deviceIds: ['ghost'] },
        ];

        recordNativeChainReleases(reports);

        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-1')).toEqual(['comp']);
        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-2')).toEqual(['eq']);
        expect(nativeLiveGraphSession.nativeChainByStripId.has('audio-9')).toBe(false);
    });
});
