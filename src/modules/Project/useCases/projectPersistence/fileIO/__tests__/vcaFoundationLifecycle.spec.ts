import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { CURRENT_PROJECT_VERSION } from '../../../../models/ProjectData';
import { normalizeTrack } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import {
    defaultTransportState,
    tempoMapStore,
    timeSignatureMapStore,
    transportStore,
} from '#/modules/Transport/stores';

import { arrangementStore, defaultArrangementStoreState } from '../../../../stores/arrangementStore';
import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { hydrateArrangementStoreFromProjectData } from '../../helpers/hydrateArrangementStoreFromProjectData';
import { isHydratableProjectData } from '../../helpers/isHydratableProjectData';
import { migrateLegacyVcaGroups } from '../../helpers/migrateLegacyVcaGroups';
import { buildProjectData } from '../buildProjectData';
import { hydrateArrangementTracks } from '../hydrateArrangementTracks';
import { serializeArrangementTracks } from '../serializeArrangementTracks';

function vcaMemberTrack(id: string, vcaGroupId: string) {
    return normalizeTrack({ id, name: id, kind: 'audio', clips: [], vcaGroupId });
}

describe('VCA clip-foundation lifecycle preservation', () => {
    beforeEach(() => {
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        transportStore.set({ ...defaultTransportState });
        automationStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
        markerStore.set({ markers: [], sections: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
    });

    afterEach(() => {
        projectStore.set(structuredClone(defaultProjectStoreState));
        transportStore.set({ ...defaultTransportState });
        automationStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
        markerStore.set({ markers: [], sections: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
    });

    it('round-trips version-1 active-arrangement membership through serialization and hydration', () => {
        const serialized = serializeArrangementTracks([vcaMemberTrack('active-member', 'legacy-vca-active')]);
        const hydrated = hydrateArrangementTracks(serialized);

        expect(serialized).toHaveLength(1);
        expect(serialized[0]?.vcaGroupId).toBe('legacy-vca-active');
        expect(hydrated).toHaveLength(1);
        expect(hydrated[0]?.vcaGroupId).toBe('legacy-vca-active');
    });

    it('round-trips active and saved membership through the canonical project build and hydration owners', async () => {
        const activeTrack = vcaMemberTrack('active-member', 'legacy-vca-active');
        const savedTrack = vcaMemberTrack('saved-member', 'legacy-vca-saved');
        trackStore.set({ tracks: [activeTrack], selectedTrackId: activeTrack.id });
        arrangementStore.set({
            arrangements: [
                {
                    id: 'active-arrangement',
                    name: 'Active arrangement',
                    tracks: { tracks: [activeTrack], selectedTrackId: activeTrack.id },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
                {
                    id: 'saved-arrangement',
                    name: 'Saved arrangement',
                    tracks: { tracks: [savedTrack], selectedTrackId: savedTrack.id },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
            ],
            activeArrangementId: 'active-arrangement',
        });

        const built = await buildProjectData({ includeAudioBuffers: false });
        if (!built) {
            throw new Error('Expected the canonical project builder to produce version-1 data');
        }
        expect(built.data.version).toBe(CURRENT_PROJECT_VERSION);
        expect(built.data.arrangement.tracks[0]?.vcaGroupId).toBe('legacy-vca-active');
        expect(built.data.arrangements?.[1]?.tracks?.tracks[0]?.vcaGroupId).toBe('legacy-vca-saved');

        trackStore.set({ tracks: [], selectedTrackId: null });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
        hydrateArrangementStoreFromProjectData({ data: built.data, preserveSavedArrangements: true });

        expect(trackStore.value?.tracks[0]?.vcaGroupId).toBe('legacy-vca-active');
        expect(arrangementStore.value?.arrangements[1]?.tracks.tracks[0]?.vcaGroupId).toBe('legacy-vca-saved');
    });

    it('keeps the dormant legacy migration deterministic without mutating its input', () => {
        const input: Parameters<typeof migrateLegacyVcaGroups>[0] = {
            legacyGroups: [
                {
                    id: 'legacy-vca',
                    name: 'Legacy VCA',
                    gain: 0.75,
                    muted: false,
                    trackIds: ['active-member', 'saved-member'],
                },
            ],
            trackCollections: [
                {
                    collectionId: 'active',
                    selectedTrackId: 'active-member',
                    trackIds: ['active-member'],
                    legacyVcaGroupIdByTrackId: { 'active-member': 'legacy-vca' },
                },
                {
                    collectionId: 'saved',
                    selectedTrackId: 'saved-member',
                    trackIds: ['saved-member'],
                    legacyVcaGroupIdByTrackId: { 'saved-member': 'legacy-vca' },
                },
            ],
        };
        const original = structuredClone(input);

        const first = migrateLegacyVcaGroups(input);
        const second = migrateLegacyVcaGroups(input);

        expect(first).toEqual(second);
        expect(first).toEqual({
            status: 'ready',
            candidates: [
                {
                    id: 'legacy-vca',
                    legacyGroupId: 'legacy-vca',
                    kind: 'vca',
                    order: 0,
                    name: 'Legacy VCA',
                    color: '#CA8A04',
                    gain: 0.75,
                    muted: false,
                    soloed: false,
                    memberTrackIds: ['active-member', 'saved-member'],
                    clips: [],
                    devices: [],
                    sends: [],
                    midiFx: [],
                    inputId: null,
                    outputId: null,
                    meterEnabled: false,
                },
            ],
            collections: [
                {
                    collectionId: 'active',
                    selectedTrackId: 'active-member',
                    trackIds: ['active-member'],
                    assignments: [{ trackId: 'active-member', vcaTrackId: 'legacy-vca' }],
                    missingMembers: [{ legacyGroupId: 'legacy-vca', trackId: 'saved-member' }],
                },
                {
                    collectionId: 'saved',
                    selectedTrackId: 'saved-member',
                    trackIds: ['saved-member'],
                    assignments: [{ trackId: 'saved-member', vcaTrackId: 'legacy-vca' }],
                    missingMembers: [{ legacyGroupId: 'legacy-vca', trackId: 'active-member' }],
                },
            ],
        });
        expect(input).toEqual(original);
    });

    it('rejects otherwise-valid active and saved canonical VCA track payloads at hydration validation', async () => {
        const activeTrack = vcaMemberTrack('active-member', 'legacy-vca-active');
        const savedTrack = vcaMemberTrack('saved-member', 'legacy-vca-saved');
        trackStore.set({ tracks: [activeTrack], selectedTrackId: activeTrack.id });
        arrangementStore.set({
            arrangements: [
                {
                    id: 'active-arrangement',
                    name: 'Active arrangement',
                    tracks: { tracks: [activeTrack], selectedTrackId: activeTrack.id },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
                {
                    id: 'saved-arrangement',
                    name: 'Saved arrangement',
                    tracks: { tracks: [savedTrack], selectedTrackId: savedTrack.id },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
            ],
            activeArrangementId: 'active-arrangement',
        });
        const built = await buildProjectData({ includeAudioBuffers: false });
        if (!built) {
            throw new Error('Expected valid project data for hydration quarantine proof');
        }
        expect(isHydratableProjectData(built.data)).toBe(true);

        const activeVcaPayload = {
            ...built.data,
            arrangement: {
                tracks: built.data.arrangement.tracks.map((track) => ({ ...track, kind: 'vca' })),
            },
        };
        const savedVcaPayload = {
            ...built.data,
            arrangements: built.data.arrangements?.map((snapshot) => {
                if (snapshot.id !== 'saved-arrangement' || !snapshot.tracks) {
                    return snapshot;
                }
                return {
                    ...snapshot,
                    tracks: {
                        ...snapshot.tracks,
                        tracks: snapshot.tracks.tracks.map((track) => ({ ...track, kind: 'vca' })),
                    },
                };
            }),
        };

        expect(isHydratableProjectData(activeVcaPayload)).toBe(false);
        expect(isHydratableProjectData(savedVcaPayload)).toBe(false);
    });
});
