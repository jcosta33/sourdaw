import { describe, expect, it } from 'vitest';

import { normalizeTrack } from '#/modules/Arrangement/useCases';

import { migrateLegacyVcaGroups } from '../../helpers/migrateLegacyVcaGroups';
import { hydrateArrangementTracks } from '../hydrateArrangementTracks';
import { serializeArrangementTracks } from '../serializeArrangementTracks';

function vcaMemberTrack(id: string, vcaGroupId: string) {
    return normalizeTrack({ id, name: id, kind: 'audio', clips: [], vcaGroupId });
}

describe('VCA clip-foundation lifecycle preservation', () => {
    it('round-trips version-1 active-arrangement membership through serialization and hydration', () => {
        const serialized = serializeArrangementTracks([vcaMemberTrack('active-member', 'legacy-vca-active')]);
        const hydrated = hydrateArrangementTracks(serialized);

        expect(serialized).toHaveLength(1);
        expect(serialized[0]?.vcaGroupId).toBe('legacy-vca-active');
        expect(hydrated).toHaveLength(1);
        expect(hydrated[0]?.vcaGroupId).toBe('legacy-vca-active');
    });

    it('round-trips version-1 saved-arrangement membership inside its collection envelope', () => {
        const savedArrangement = {
            id: 'saved-arrangement',
            name: 'Saved arrangement',
            tracks: {
                tracks: [vcaMemberTrack('saved-member', 'legacy-vca-saved')],
                selectedTrackId: 'saved-member',
            },
        };
        const serializedSavedArrangement = {
            ...savedArrangement,
            tracks: {
                ...savedArrangement.tracks,
                tracks: serializeArrangementTracks(savedArrangement.tracks.tracks),
            },
        };
        const hydratedSavedArrangement = {
            ...serializedSavedArrangement,
            tracks: {
                ...serializedSavedArrangement.tracks,
                tracks: hydrateArrangementTracks(serializedSavedArrangement.tracks.tracks),
            },
        };

        expect(serializedSavedArrangement).toMatchObject({
            id: 'saved-arrangement',
            tracks: { selectedTrackId: 'saved-member', tracks: [{ vcaGroupId: 'legacy-vca-saved' }] },
        });
        expect(hydratedSavedArrangement).toMatchObject({
            id: 'saved-arrangement',
            tracks: { selectedTrackId: 'saved-member', tracks: [{ vcaGroupId: 'legacy-vca-saved' }] },
        });
    });

    it('keeps the dormant legacy migration deterministic without mutating its input', () => {
        const input = {
            legacyGroups: [{ id: 'legacy-vca', name: 'Legacy VCA', gain: 0.75, muted: false, trackIds: ['member'] }],
            trackCollections: [
                {
                    collectionId: 'active',
                    selectedTrackId: 'member',
                    trackIds: ['member'],
                    legacyVcaGroupIdByTrackId: { member: 'legacy-vca' },
                },
                {
                    collectionId: 'saved',
                    selectedTrackId: null,
                    trackIds: ['member'],
                    legacyVcaGroupIdByTrackId: { member: 'legacy-vca' },
                },
            ],
        };
        const original = structuredClone(input);

        const first = migrateLegacyVcaGroups(input);
        const second = migrateLegacyVcaGroups(input);

        expect(first).toEqual(second);
        expect(first).toMatchObject({ status: 'ready' });
        expect(input).toEqual(original);
    });
});
