import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AppAction, type HandlerMaterializationContext } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';
import { defaultTrackState, trackStore } from '../../stores/trackStore';
import { planDefaultTrackName } from '../planDefaultTrackName';

function seedAudioTracks(names: string[]): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: names.map((name, index) =>
            createTrack({ id: `audio-${index + 1}`, name, kind: 'audio', withoutDefaultDevice: true })
        ),
    });
}

function prefixContext(prior: AppAction, route: 'raw' | 'prepared'): HandlerMaterializationContext {
    const context: HandlerMaterializationContext = {
        actions: [prior, { type: 'addTrack', payload: { id: 'next-audio', kind: 'audio' } }],
        actionIndex: 1,
    };
    if (route === 'prepared') {
        return { ...context, preparedPrefix: [prior] };
    }
    return context;
}

describe('default track names after the ordered action prefix', () => {
    let previous: typeof trackStore.value;

    beforeEach(() => {
        previous = trackStore.value;
    });

    afterEach(() => {
        trackStore.set(previous);
    });

    it.each(['raw', 'prepared'] as const)('reuses the highest removed suffix through a %s prefix', (route) => {
        seedAudioTracks(['Audio 1', 'Audio 2']);
        const context = prefixContext({ type: 'removeTrack', payload: { trackId: 'audio-2' } }, route);

        const planned = planDefaultTrackName('audio', context);
        expect(trackStore.value?.tracks.map(({ id, name }) => ({ id, name }))).toEqual([
            { id: 'audio-1', name: 'Audio 1' },
            { id: 'audio-2', name: 'Audio 2' },
        ]);
        expect(planned).toBe('Audio 2');
    });

    it.each(['raw', 'prepared'] as const)('stops counting a renamed default through a %s prefix', (route) => {
        seedAudioTracks(['Audio 1']);
        const context = prefixContext({ type: 'renameTrack', payload: { trackId: 'audio-1', name: 'Drums' } }, route);

        const planned = planDefaultTrackName('audio', context);
        expect(trackStore.value?.tracks[0]).toMatchObject({ id: 'audio-1', name: 'Audio 1' });
        expect(planned).toBe('Audio 1');
    });

    it('continues above the highest surviving suffix rather than filling a lower gap', () => {
        seedAudioTracks(['Audio 1', 'Audio 3', 'Drums']);

        expect(planDefaultTrackName('audio')).toBe('Audio 4');
    });

    it('uses the canonical prepared prefix instead of renaming its raw nameless addition', () => {
        seedAudioTracks(['Audio 1', 'Audio 2']);
        const raw: AppAction = { type: 'addTrack', payload: { id: 'prepared-audio', kind: 'audio' } };
        const prepared: AppAction = { ...raw, payload: { ...raw.payload, name: 'Audio 7' } };

        expect(planDefaultTrackName('audio', { ...prefixContext(raw, 'raw'), preparedPrefix: [prepared] })).toBe(
            'Audio 8'
        );
    });
});
