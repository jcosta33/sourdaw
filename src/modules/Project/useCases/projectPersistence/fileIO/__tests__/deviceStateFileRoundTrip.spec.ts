import { describe, expect, it } from 'vitest';

import { sanitizeTrackSnapshot, type Track } from '#/modules/Arrangement/stores';

import { CURRENT_PROJECT_VERSION, type ProjectData } from '../../../../models/ProjectData';
import { isHydratableProjectData } from '../../helpers/isHydratableProjectData';
import { hydrateArrangementTracks } from '../hydrateArrangementTracks';
import { serializeArrangementTracks } from '../serializeArrangementTracks';

/**
 * `Device.deviceState` is the slot a built-in device's non-numeric state rides in,
 * and Toaster, Levain and Crumbs all put their instrument identity there. It is
 * already proven to survive the document projection
 * (`trackStoreDeviceState.spec.ts`), which is the tab-reload path.
 *
 * This is the other half — the `.sourdaw` file path — and it is the reason those
 * three modules need no slot projection of their own: the chunk travels inside
 * `arrangement.tracks`, which the `tracks` slot and the file already both carry.
 * A regression here would be silent, because the export writes the field either
 * way and only the reopen would come back wrong.
 */
function trackWithChunk(): Track {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Cellos',
                kind: 'midi',
                clips: [],
                devices: [
                    {
                        id: 'device-1',
                        name: 'Levain',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: { masterGain: 0.8 },
                        deviceState: { version: 1, data: { instrumentId: 'cello', enabled: true, depth: 0.25 } },
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks[0]!;
}

function projectFileWith(tracks: Track[]): ProjectData['arrangement'] {
    return { tracks: serializeArrangementTracks(tracks) };
}

describe('device state through the project file', () => {
    it('carries a device-state chunk from the live store back into the live store', () => {
        const onDisk: unknown = JSON.parse(
            JSON.stringify({
                version: CURRENT_PROJECT_VERSION,
                meta: {
                    // Required by isHydratableProjectData; this fixture
                    // predates that hardening.
                    projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
                    name: 'Round trip',
                    createdAt: 0,
                    updatedAt: 0,
                    keyRoot: 0,
                    scaleName: 'major',
                    tuning: { name: '12-TET', frequencies: [440] },
                },
                arrangement: projectFileWith([trackWithChunk()]),
            })
        );

        // The import validator is all-or-nothing, so a chunk it rejected would take
        // the whole project with it rather than just the device.
        if (!isHydratableProjectData(onDisk)) {
            throw new Error('a project carrying a device-state chunk was rejected by the import validator');
        }

        const restored = sanitizeTrackSnapshot({
            tracks: hydrateArrangementTracks(onDisk.arrangement.tracks),
            selectedTrackId: null,
        });

        expect(restored.tracks[0]?.devices[0]?.deviceState).toEqual({
            version: 1,
            data: { instrumentId: 'cello', enabled: true, depth: 0.25 },
        });
    });

    it('leaves a device that never wrote a chunk without one', () => {
        // Presence pin: the assertion above must be reading a chunk the fixture put
        // there, not one the hydrator invents for every device.
        const bare = sanitizeTrackSnapshot({
            tracks: [
                {
                    id: 'track-1',
                    name: 'Cellos',
                    kind: 'midi',
                    clips: [],
                    devices: [
                        {
                            id: 'device-1',
                            name: 'Levain',
                            type: 'levain',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                },
            ],
            selectedTrackId: null,
        }).tracks;

        const restored = sanitizeTrackSnapshot({
            tracks: hydrateArrangementTracks(serializeArrangementTracks(bare)),
            selectedTrackId: null,
        });

        expect(restored.tracks[0]?.devices[0]?.deviceState).toBeUndefined();
    });
});
