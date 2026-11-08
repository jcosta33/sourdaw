import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AppAction, type HandlerMaterializationContext } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';
import { defaultTrackState, trackStore } from '../../stores/trackStore';
import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { planDefaultTrackName } from '../planDefaultTrackName';

function seedAudioTracks(names: string[]): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: names.map((name, index) =>
            createTrack({ id: `audio-${index + 1}`, name, kind: 'audio', color: '#123456', withoutDefaultDevice: true })
        ),
    });
}

function orderedContext(prior: AppAction[]): HandlerMaterializationContext {
    return {
        actions: [...prior, { type: 'addTrack', payload: { kind: 'audio' } }],
        actionIndex: prior.length,
    };
}

function captureAudioRestore() {
    seedAudioTracks(['Audio 4']);
    const payload = captureTrackRemovalSnapshot('audio-1');
    if (!payload) {
        throw new Error('Expected the actual owner to capture the seeded track');
    }
    seedAudioTracks([]);
    return payload;
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

    it.each(['removeTrack', 'discardCreatedTrack'] as const)(
        'projects creation, rename and %s by identity before planning the next addition',
        (type) => {
            seedAudioTracks(['Audio 1']);
            const context = orderedContext([
                { type: 'addTrack', payload: { id: 'created', name: 'Audio 7', kind: 'audio' } },
                { type: 'renameTrack', payload: { trackId: 'created', name: 'Audio 9' } },
                { type, payload: { trackId: 'created' } },
                { type: 'addTrack', payload: { id: 'keeper', kind: 'audio' } },
                { type: 'renameTrack', payload: { trackId: 'keeper', name: 'Drums' } },
            ]);
            const before = structuredClone(context);
            const tracks = structuredClone(trackStore.value);

            const planned = planDefaultTrackName('audio', context);

            expect(context).toEqual(before);
            expect(trackStore.value).toEqual(tracks);
            expect(planned).toBe('Audio 2');
        }
    );

    it('retains each raw anonymous addition without allocating or conflating identities', () => {
        seedAudioTracks(['Audio 1']);
        const context = orderedContext([
            { type: 'addTrack', payload: { kind: 'audio' } },
            { type: 'addTrack', payload: { kind: 'audio' } },
        ]);
        const before = structuredClone(context);

        expect(planDefaultTrackName('audio', context)).toBe('Audio 4');
        expect(context).toEqual(before);
    });

    it('keeps the identity and kind of a bus through a later rename', () => {
        seedAudioTracks(['Audio 1']);
        const context = orderedContext([
            { type: 'createBus', payload: { busId: 'bus', name: 'Bus 4' } },
            { type: 'renameTrack', payload: { trackId: 'bus', name: 'Bus 7' } },
        ]);

        expect(planDefaultTrackName('bus', context)).toBe('Bus 8');
        expect(planDefaultTrackName('audio', context)).toBe('Audio 2');
    });

    it('removes only the exact row, retaining the child that survives its parent', () => {
        const parent = createTrack({ id: 'parent', name: 'Audio 4', kind: 'audio', color: '#123456' });
        const child = createTrack({
            id: 'child',
            name: 'Audio 6',
            kind: 'audio',
            parentId: parent.id,
            color: '#123456',
        });
        trackStore.set({ ...defaultTrackState, tracks: [parent, child] });

        expect(
            planDefaultTrackName(
                'audio',
                prefixContext({ type: 'removeTrack', payload: { trackId: parent.id } }, 'raw')
            )
        ).toBe('Audio 7');
        expect(trackStore.value?.tracks).toEqual([parent, child]);
    });

    it.each(['removeTrack', 'discardCreatedTrack'] as const)('retains the protected master through %s', (type) => {
        const master = createTrack({ id: 'master', name: 'Master 4', kind: 'master', color: '#123456' });
        trackStore.set({ ...defaultTrackState, tracks: [master] });

        expect(planDefaultTrackName('master', prefixContext({ type, payload: { trackId: master.id } }, 'raw'))).toBe(
            'Master 5'
        );
    });

    it('reads the actual captured restore tuple rather than its event metadata, and retains its identity', () => {
        const payload = captureAudioRestore();
        const restore: AppAction = {
            type: 'restoreTrack',
            payload: { ...payload, trackName: 'MIDI 99', trackKind: 'midi' },
        };
        const before = structuredClone(restore);

        expect(planDefaultTrackName('audio', orderedContext([restore]))).toBe('Audio 5');
        expect(
            planDefaultTrackName(
                'audio',
                orderedContext([
                    restore,
                    { type: 'renameTrack', payload: { trackId: payload.trackId, name: 'Audio 6' } },
                ])
            )
        ).toBe('Audio 7');
        expect(restore).toEqual(before);
        expect(trackStore.value?.tracks).toEqual([]);
    });

    it.each([
        { label: 'absent name', corrupt: (snapshot: { id: string }) => ({ ...snapshot, name: undefined }) },
        { label: 'non-string name', corrupt: (snapshot: { id: string }) => ({ ...snapshot, name: 42 }) },
        { label: 'absent kind', corrupt: (snapshot: { id: string }) => ({ ...snapshot, kind: undefined }) },
        { label: 'unknown kind', corrupt: (snapshot: { id: string }) => ({ ...snapshot, kind: 'alien' }) },
        { label: 'different identity', corrupt: (snapshot: { id: string }) => ({ ...snapshot, id: 'other' }) },
    ])('refuses a captured restoration with $label before planning', ({ corrupt }) => {
        const payload = captureAudioRestore();
        const trackSnapshot = corrupt(payload.trackSnapshot);
        const action: AppAction = { type: 'restoreTrack', payload: { ...payload, trackSnapshot } };
        const before = structuredClone(action);

        expect(() => planDefaultTrackName('audio', orderedContext([action]))).toThrow(TypeError);
        expect(action).toEqual(before);
        expect(trackStore.value?.tracks).toEqual([]);
    });
});
