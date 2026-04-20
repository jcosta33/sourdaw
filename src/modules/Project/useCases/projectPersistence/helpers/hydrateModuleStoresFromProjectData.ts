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
            lanes: (data.automation.lanes || []).map((l) => ({
                ...l,
                enabled: l.enabled ?? true,
                visible: l.visible ?? true,
                collapsed: l.collapsed ?? false,
                virginTerritory: l.virginTerritory ?? true,
                minValue: l.minValue ?? 0,
                maxValue: l.maxValue ?? 1,
                objects: l.objects || [],
                points: l.points.map((p) => ({
                    ...p,
                    curve: p.curve as any,
                    tension: p.tension ?? 0,
                })),
            })) as AutomationLane[],
        });
    }

    // 3. Markers
    if (data.markers) {
        markerStore.set({
            markers: data.markers.map((m) => ({
                id: m.id,
                beat: m.beat,
                name: (m as any).name || (m as any).label || 'Untitled',
                color: m.color,
            })),
            sections: [],
        });
    }
}
