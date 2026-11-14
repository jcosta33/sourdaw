import { type adjustmentLayerStore, type markerStore, type trackStore } from '#/modules/Arrangement/stores';
import { getHeldClips } from '#/modules/Arrangement/useCases';
import { type automationStore } from '#/modules/Automation/stores';
import { type chordTrackStore } from '#/modules/MIDI/stores';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type ProductionBriefScope } from '../../models/ProductionBrief';

export type ProductionBriefActionFootprint = {
    readonly actions: readonly AppAction[];
    readonly adjustmentLayers: typeof adjustmentLayerStore.value;
    readonly automation: typeof automationStore.value;
    readonly chordTrack: typeof chordTrackStore.value;
    readonly markers: typeof markerStore.value;
    readonly tracks: typeof trackStore.value;
    readonly timeSignatureNumerator: number;
    readonly rippleEditing: boolean;
};

export type ProductionBriefRangeScope = Extract<ProductionBriefScope, { kind: 'range' }>;

export type ProductionBriefAutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];

export type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

function collectActionStrings(value: unknown, values: Set<string>): void {
    if (typeof value === 'string') {
        values.add(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectActionStrings(item, values);
        }
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    for (const item of Object.values(value)) {
        collectActionStrings(item, values);
    }
}

function valueOverlapsRange(value: unknown, scope: ProductionBriefRangeScope): boolean {
    if (Array.isArray(value)) {
        return value.some((item) => valueOverlapsRange(item, scope));
    }
    if (!value || typeof value !== 'object') {
        return false;
    }
    const values = value as Record<string, unknown>;
    const startBeat = values.startBeat;
    const endBeat = values.endBeat;
    if (typeof startBeat === 'number' && typeof endBeat === 'number') {
        return startBeat < scope.endBeat && endBeat > scope.startBeat;
    }
    const beat = values.beat;
    if (typeof beat === 'number' && beat >= scope.startBeat && beat < scope.endBeat) {
        return true;
    }
    for (const [key, item] of Object.entries(values)) {
        if (key.endsWith('Beat') && typeof item === 'number' && item >= scope.startBeat && item < scope.endBeat) {
            return true;
        }
    }
    return Object.values(values).some((item) => valueOverlapsRange(item, scope));
}

function findClip(clipId: string, footprint: ProductionBriefActionFootprint) {
    for (const track of footprint.tracks?.tracks ?? []) {
        const clip = getHeldClips(track).find((candidate) => candidate.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return undefined;
}

function intervalOverlapsRange(startBeat: number, endBeat: number, scope: ProductionBriefRangeScope): boolean {
    return endBeat > startBeat && startBeat < scope.endBeat && endBeat > scope.startBeat;
}

function adjustmentLayerOverlapsRange(
    layer: { readonly regions: readonly { readonly startBeat: number; readonly endBeat: number }[] },
    scope: ProductionBriefRangeScope
): boolean {
    return (
        layer.regions.length === 0 ||
        layer.regions.some((region) => intervalOverlapsRange(region.startBeat, region.endBeat, scope))
    );
}

function lanePoints(lane: ProductionBriefAutomationLane) {
    const trimPoints = lane.trimPoints ?? [];
    const ghostPoints = lane.ghostPoints ?? [];
    return [...lane.points, ...trimPoints, ...ghostPoints];
}

function automationLaneOverlapsRange(lane: ProductionBriefAutomationLane, scope: ProductionBriefRangeScope): boolean {
    return (
        lanePoints(lane).some((point) => point.beat >= scope.startBeat && point.beat < scope.endBeat) ||
        lane.objects.some((object) => intervalOverlapsRange(object.startBeat, object.endBeat, scope))
    );
}

/** The default overlap behaviour every action keeps unless its record entry says more. */
export const footprintQueries = {
    collectActionStrings,
    valueOverlapsRange,
    findClip,
    intervalOverlapsRange,
    adjustmentLayerOverlapsRange,
    lanePoints,
    automationLaneOverlapsRange,
};
