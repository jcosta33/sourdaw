import { type TakeSourceDepthSnapshot } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';

export function takeSourceDepthsMatch(clipId: string, expected: readonly TakeSourceDepthSnapshot[]): boolean {
    const state = takeLaneStore.value;
    if (!state) {
        return expected.length === 0;
    }
    const live = state.lanes.flatMap((lane) =>
        lane.takes.filter((take) => take.clipId === clipId).map((take) => `${lane.id}:${take.id}`)
    );
    const expectedIds = expected.map((source) => `${source.laneId}:${source.takeId}`);
    if (
        live.length !== expected.length ||
        new Set(expectedIds).size !== expected.length ||
        expectedIds.some((id) => !live.includes(id))
    ) {
        return false;
    }
    return expected.every((source) => {
        if (!source || typeof source.laneId !== 'string' || typeof source.takeId !== 'string') {
            return false;
        }
        if (
            source.sourceOffsetSeconds !== null &&
            (typeof source.sourceOffsetSeconds !== 'number' ||
                !Number.isFinite(source.sourceOffsetSeconds) ||
                source.sourceOffsetSeconds < 0)
        ) {
            return false;
        }
        if (
            source.sourceOffsetBeats !== null &&
            (typeof source.sourceOffsetBeats !== 'number' ||
                !Number.isFinite(source.sourceOffsetBeats) ||
                source.sourceOffsetBeats < 0)
        ) {
            return false;
        }
        const take = state.lanes
            .find((lane) => lane.id === source.laneId)
            ?.takes.find((candidate) => candidate.id === source.takeId);
        if (!take) {
            return false;
        }
        const seconds = Object.hasOwn(take, 'sourceOffsetSeconds') ? (take.sourceOffsetSeconds ?? null) : null;
        const beats = Object.hasOwn(take, 'sourceOffsetBeats') ? (take.sourceOffsetBeats ?? null) : null;
        return Object.is(seconds, source.sourceOffsetSeconds) && Object.is(beats, source.sourceOffsetBeats);
    });
}
