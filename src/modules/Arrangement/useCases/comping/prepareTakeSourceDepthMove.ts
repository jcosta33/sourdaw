import { resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';
import { type TakeSourceDepthSnapshot } from '#/utils/handlerContract';

import { type Take } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

type TakeSourceDepthMove = {
    before: readonly TakeSourceDepthSnapshot[];
    after: readonly TakeSourceDepthSnapshot[];
    apply: () => void;
};

function capture(laneId: string, take: Take): TakeSourceDepthSnapshot {
    return {
        laneId,
        takeId: take.id,
        sourceOffsetSeconds: Object.hasOwn(take, 'sourceOffsetSeconds') ? (take.sourceOffsetSeconds ?? null) : null,
        sourceOffsetBeats: Object.hasOwn(take, 'sourceOffsetBeats') ? (take.sourceOffsetBeats ?? null) : null,
    };
}

function withSource(take: Take, source: TakeSourceDepthSnapshot): Take {
    const next: Take = {
        ...take,
        sourceOffsetSeconds: source.sourceOffsetSeconds ?? undefined,
        sourceOffsetBeats: source.sourceOffsetBeats ?? undefined,
    };
    if (source.sourceOffsetSeconds === null) {
        delete next.sourceOffsetSeconds;
    }
    if (source.sourceOffsetBeats === null) {
        delete next.sourceOffsetBeats;
    }
    return next;
}

function isArray(value: unknown): boolean {
    return Array.isArray(value);
}

function resolveRestoredTakeSources(
    before: readonly TakeSourceDepthSnapshot[],
    restore: readonly TakeSourceDepthSnapshot[]
): TakeSourceDepthSnapshot[] | null {
    if (!isArray(restore) || restore.length !== before.length) {
        return null;
    }
    const seen = new Set<string>();
    const after: TakeSourceDepthSnapshot[] = [];
    for (const source of restore) {
        if (!source || typeof source.laneId !== 'string' || typeof source.takeId !== 'string') {
            return null;
        }
        if (
            source.sourceOffsetSeconds !== null &&
            (!Number.isFinite(source.sourceOffsetSeconds) || source.sourceOffsetSeconds < 0)
        ) {
            return null;
        }
        if (
            source.sourceOffsetBeats !== null &&
            (!Number.isFinite(source.sourceOffsetBeats) || source.sourceOffsetBeats < 0)
        ) {
            return null;
        }
        if (!before.some((candidate) => candidate.laneId === source.laneId && candidate.takeId === source.takeId)) {
            return null;
        }
        const identity = `${source.laneId}:${source.takeId}`;
        if (seen.has(identity)) {
            return null;
        }
        seen.add(identity);
        after.push(source);
    }
    return after;
}

function resolveMaterializedTakeSources(
    before: readonly TakeSourceDepthSnapshot[],
    oldTempo: number,
    newTempo: number
): TakeSourceDepthSnapshot[] | null {
    const after: TakeSourceDepthSnapshot[] = [];
    for (const source of before) {
        const seconds = resolveAudioSourceOffsetSeconds(
            {
                audioOffsetSeconds: source.sourceOffsetSeconds ?? undefined,
                audioOffsetBeats: source.sourceOffsetBeats ?? undefined,
            },
            oldTempo
        );
        const beats = (seconds * newTempo) / 60;
        if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(beats) || beats < 0) {
            return null;
        }
        after.push({ ...source, sourceOffsetSeconds: seconds, sourceOffsetBeats: beats });
    }
    return after;
}

export function prepareTakeSourceDepthMove(input: {
    clipId: string;
    oldTempo: number;
    newTempo: number;
    restore?: readonly TakeSourceDepthSnapshot[];
}): TakeSourceDepthMove | null {
    const state = takeLaneStore.value;
    if (
        !state ||
        !Number.isFinite(input.oldTempo) ||
        input.oldTempo <= 0 ||
        !Number.isFinite(input.newTempo) ||
        input.newTempo <= 0
    ) {
        return null;
    }
    const before = state.lanes.flatMap((lane) =>
        lane.takes.filter((take) => take.clipId === input.clipId).map((take) => capture(lane.id, take))
    );
    let after: TakeSourceDepthSnapshot[] | null;
    if (input.restore) {
        after = resolveRestoredTakeSources(before, input.restore);
    } else {
        after = resolveMaterializedTakeSources(before, input.oldTempo, input.newTempo);
    }
    if (!after) {
        return null;
    }

    return {
        before,
        after,
        apply: () => {
            if (
                after.every((source, index) => {
                    const previous = before[index];
                    return (
                        previous?.laneId === source.laneId &&
                        previous.takeId === source.takeId &&
                        Object.is(previous.sourceOffsetSeconds, source.sourceOffsetSeconds) &&
                        Object.is(previous.sourceOffsetBeats, source.sourceOffsetBeats)
                    );
                })
            ) {
                return;
            }
            const byLane = new Map<string, Map<string, TakeSourceDepthSnapshot>>();
            for (const source of after) {
                const byTake = byLane.get(source.laneId) ?? new Map<string, TakeSourceDepthSnapshot>();
                byTake.set(source.takeId, source);
                byLane.set(source.laneId, byTake);
            }
            takeLaneStore.set({
                lanes: state.lanes.map((lane) => {
                    const byTake = byLane.get(lane.id);
                    if (!byTake) {
                        return lane;
                    }
                    return {
                        ...lane,
                        takes: lane.takes.map((take) => {
                            const source = byTake.get(take.id);
                            return source ? withSource(take, source) : take;
                        }),
                    };
                }),
            });
        },
    };
}
