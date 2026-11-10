import { afterEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { trackStore, type Track } from '#/modules/Arrangement/stores';

import { getProjectContext } from '../getProjectContext';
import { groundApplicationRecipeBatch } from '../groundApplicationRecipeBatch';

import { createTrack } from './trackFixture';

registerDeviceEnginePorts();

const VOCAL_ID = 'track-vocal';
const BASS_ID = 'track-bass';

function setTracks(tracks: Track[]): void {
    trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
}

function ground(pairs: Parameters<typeof groundApplicationRecipeBatch>[0]['pairs']) {
    return groundApplicationRecipeBatch({
        origin: 'application-recipe-spec',
        pairs,
        context: getProjectContext(),
        projectRevision: 'revision-application-recipes',
        prompt: 'Apply the chosen recipes',
    });
}

function requireGrounded(result: ReturnType<typeof groundApplicationRecipeBatch>) {
    if (result.status !== 'grounded') {
        throw new Error(`Expected the batch to ground, got ${JSON.stringify(result)}`);
    }
    return result;
}

afterEach(() => {
    setTracks([]);
});

describe('groundApplicationRecipeBatch', () => {
    // vocal-bright inserts two devices and bass-warm one, so a slot sized from the wrong pair's
    // count, or a binding minted from a shared ordinal, cannot pass.
    it('grounds two recipes on two tracks with their own devices and one slot per track', () => {
        setTracks([createTrack({ id: VOCAL_ID, name: 'Lead Vocal' }), createTrack({ id: BASS_ID, name: 'Bass' })]);

        const result = requireGrounded(
            ground([
                { recipeId: 'vocal-bright', targetId: VOCAL_ID, role: 'vocal' },
                { recipeId: 'bass-warm', targetId: BASS_ID, role: 'bass' },
            ])
        );

        const added = result.grounded.actions.flatMap((action) =>
            action.type === 'addDevice' ? [action.payload] : []
        );
        expect(added.map((device) => device.trackId)).toEqual([VOCAL_ID, VOCAL_ID, BASS_ID]);
        expect(new Set(added.map((device) => device.deviceId)).size).toBe(3);
        const ownerOf = new Map(added.map((device) => [device.deviceId, device.trackId]));
        const writes = result.grounded.actions.flatMap((action) =>
            action.type === 'setDeviceParameter' ? [action.payload] : []
        );
        expect(writes.length).toBeGreaterThan(0);
        for (const write of writes) {
            expect([VOCAL_ID, BASS_ID]).toContain(write.expectedTrackId);
            expect(ownerOf.get(write.deviceId)).toBe(write.expectedTrackId);
        }
        expect(result.adoptedRecipes).toMatchObject([
            { recipeId: 'vocal-bright', targetId: VOCAL_ID },
            { recipeId: 'bass-warm', targetId: BASS_ID },
        ]);
        expect(result.creativeAuthority).toMatchObject({
            mode: 'edit',
            editDimensions: ['processing'],
            targets: [{ objectType: 'track', objectIds: [VOCAL_ID, BASS_ID] }],
            creationSlots: [
                { objectType: 'device', parentObjectId: VOCAL_ID, budget: 2 },
                { objectType: 'device', parentObjectId: BASS_ID, budget: 1 },
            ],
        });
    });

    // A vibe-run batch may carry two recipes for one track: vocal-bright inserts two devices and
    // vocal-warm one, so the track's one slot must hold all three, not the last pair's count.
    it('states one device slot per track sized by the sum of every expansion on it', () => {
        setTracks([createTrack({ id: VOCAL_ID, name: 'Lead Vocal' })]);

        const result = requireGrounded(
            ground([
                { recipeId: 'vocal-bright', targetId: VOCAL_ID, role: 'vocal' },
                { recipeId: 'vocal-warm', targetId: VOCAL_ID, role: 'vocal' },
            ])
        );

        const added = result.grounded.actions.flatMap((action) =>
            action.type === 'addDevice' ? [action.payload] : []
        );
        expect(added.map((device) => device.trackId)).toEqual([VOCAL_ID, VOCAL_ID, VOCAL_ID]);
        expect(new Set(added.map((device) => device.deviceId)).size).toBe(3);
        expect(result.compilations.map((compilation) => compilation.recipe.recipeId)).toEqual([
            'vocal-bright',
            'vocal-warm',
        ]);
        expect(result.creativeAuthority).toMatchObject({
            targets: [{ objectType: 'track', objectIds: [VOCAL_ID] }],
            creationSlots: [{ objectType: 'device', parentObjectId: VOCAL_ID, budget: 3 }],
        });
        expect(result.creativeAuthority.creationSlots).toHaveLength(1);
    });

    it('refuses the whole batch with the expander reason when one pair does not expand on its target', () => {
        setTracks([createTrack({ id: VOCAL_ID, name: 'Lead Vocal' }), createTrack({ id: BASS_ID, name: 'Bass' })]);
        const unexpandable = { recipeId: 'vocal-warm', targetId: BASS_ID, role: null };

        const result = ground([{ recipeId: 'vocal-warm', targetId: VOCAL_ID, role: 'vocal' }, unexpandable]);

        expect(result).toEqual({
            status: 'refused-expansion',
            pair: unexpandable,
            reason: `recipe "vocal-warm" is authored for vocal, but target "${BASS_ID}" resolves to bass.`,
        });
    });

    it.each([
        ['a bus', 'bus', 'recipe "vocal-warm" is authored for vocal, but target "track-scope" resolves to bus.'],
        [
            'the master',
            'master',
            'recipe "vocal-warm" is authored for vocal, but target "track-scope" resolves to master.',
        ],
        [
            'a folder',
            'folder',
            'recipe.expand refused target "track-scope": This target is a folder; it only changes the view and does not process its child tracks\' audio. Target those tracks or a bus instead.',
        ],
    ] as const)('refuses a recipe on %s as recipe.expand refuses it', (_label, kind, reason) => {
        setTracks([createTrack({ id: 'track-scope', name: 'Vocals', kind })]);
        const pair = { recipeId: 'vocal-warm', targetId: 'track-scope', role: null };

        expect(ground([pair])).toEqual({ status: 'refused-expansion', pair, reason });
    });
});
