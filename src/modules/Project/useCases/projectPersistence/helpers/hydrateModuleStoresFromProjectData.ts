import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { normalizeTrack } from '#/modules/Arrangement/useCases';
import { type AutomationLane } from '#/modules/Automation/models/Automation';
import { automationStore } from '#/modules/Automation/stores';

import { type ProjectData } from '../../../models/ProjectData';

export function hydrateModuleStoresFromProjectData(data: ProjectData): void {
    if (data.arrangement?.tracks) {
        trackStore.set({
            tracks: data.arrangement.tracks.map(normalizeTrack),
            selectedTrackId: null,
        });
    }

    // 2. Automation
    if (data.automation) {
        automationStore.set({
            lanes: (data.automation.lanes || []).map((length) => ({
                ...length,
                enabled: length.enabled ?? true,
                visible: length.visible ?? true,
                collapsed: length.collapsed ?? false,
                virginTerritory: length.virginTerritory ?? true,
                minValue: length.minValue ?? 0,
                maxValue: length.maxValue ?? 1,
                objects: length.objects || [],
                points: length.points.map((param) => ({
                    ...param,
                    curve: param.curve as any,
                    tension: param.tension ?? 0,
                })),
            })) as AutomationLane[],
        });
    }

    // 3. Markers
    if (data.markers) {
        markerStore.set({
            markers: data.markers.map((message) => ({
                id: message.id,
                beat: message.beat,
                name: (message as any).name || (message as any).label || 'Untitled',
                color: message.color,
            })),
            sections: [],
        });
    }
}
