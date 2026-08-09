import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { applySendAutomationRange } from '../../useCases/automation/applySendAutomationRange';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type AutomateSendRangeAction = Extract<AppAction, { type: 'automateSendRange' }>;
type MaterializedPayload = AutomateSendRangeAction['payload'] & {
    busName: string;
    sectionId: string;
    startBeat: number;
    endBeat: number;
    expectedSends: Array<{ trackId: string; level: number; preFader: boolean }>;
    expectedSection: { name: string; startBeat: number; endBeat: number };
};

function getMaterializedPayload(action: AutomateSendRangeAction): MaterializedPayload | null {
    const payload = action.payload;
    if (
        payload.busName === undefined ||
        payload.sectionId === undefined ||
        payload.startBeat === undefined ||
        payload.endBeat === undefined ||
        payload.expectedSends === undefined ||
        payload.expectedSection === undefined
    ) {
        return null;
    }
    return {
        ...payload,
        busName: payload.busName,
        sectionId: payload.sectionId,
        startBeat: payload.startBeat,
        endBeat: payload.endBeat,
        expectedSends: payload.expectedSends,
        expectedSection: payload.expectedSection,
    };
}

function currentStateMatches(payload: MaterializedPayload): boolean {
    const bus = trackStore.value?.tracks.find((track) => track.id === payload.busId);
    const section = markerStore.value?.sections.find((candidate) => candidate.id === payload.sectionId);
    if (
        bus?.kind !== 'bus' ||
        bus.name !== payload.busName ||
        !section ||
        section.name !== payload.expectedSection.name ||
        section.startBeat !== payload.expectedSection.startBeat ||
        section.endBeat !== payload.expectedSection.endBeat ||
        payload.sectionName !== payload.expectedSection.name ||
        payload.startBeat !== payload.expectedSection.startBeat ||
        payload.endBeat !== payload.expectedSection.endBeat
    ) {
        return false;
    }
    const state = getAutomationStoreState();
    for (const expected of payload.expectedSends) {
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === expected.trackId);
        const send = track?.sends.find((candidate) => candidate.busId === payload.busId);
        if (!send || send.level !== expected.level || send.preFader !== expected.preFader) {
            return false;
        }
        const laneId = `auto-send-${encodeURIComponent(expected.trackId)}-${encodeURIComponent(payload.busId)}`;
        if (
            state?.lanes.some(
                (lane) =>
                    lane.id === laneId ||
                    (!lane.clipId && lane.trackId === expected.trackId && lane.parameterId === `send:${payload.busId}`)
            )
        ) {
            return false;
        }
    }
    return (
        payload.trackIds.length === payload.expectedSends.length &&
        payload.trackIds.every((trackId, index) => trackId === payload.expectedSends[index]?.trackId)
    );
}

export const handleAutomateSendRange = createHandler<'automateSendRange'>({
    execute: (action) => {
        const payload = getMaterializedPayload(action);
        if (!payload || !currentStateMatches(payload)) {
            return { status: 'conflict' };
        }
        const written = applySendAutomationRange({
            busId: payload.busId,
            busName: payload.busName,
            startBeat: payload.startBeat,
            endBeat: payload.endBeat,
            reductionDb: payload.reductionDb,
            expectedSends: payload.expectedSends,
        });
        return written ? { status: 'written' } : { status: 'conflict' };
    },
    describe: (action) => {
        const payload = getMaterializedPayload(action);
        let label = 'Automate send range';
        if (payload) {
            label = `Lower ${String(payload.trackIds.length)} vocal sends to ${payload.busName} by ${String(payload.reductionDb)} dB in ${payload.sectionName} (${String(payload.startBeat)}–${String(payload.endBeat)})`;
        }
        if (!payload || !currentStateMatches(payload)) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: { type: 'removeSendAutomationRange', payload },
        };
    },
    undoable: true,
});
