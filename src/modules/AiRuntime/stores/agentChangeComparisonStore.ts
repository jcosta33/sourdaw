/**
 * The live A/B between a committed agent action group and the project without
 * it: side B is the project as the group left it, side A is the same project
 * with the group reverted, and the loudness readings are what lets the two be
 * judged on what changed rather than on which one came out louder.
 *
 * Runtime only, and deliberately unpersisted. Everything here describes a
 * comparison a musician is running right now — which side is sounding, how loud
 * each one measured, how much monitoring offset the match needs. None of it is
 * project truth, and a match restored into a later session would offset the
 * output against readings taken from a mix that has since moved.
 */

import { createStore } from '#/infra/store/createStore';

/** `A` is the project with the group reverted; `B` is the project as committed. */
export type AgentChangeComparisonSide = 'A' | 'B';

/** Where the loudness readings are coming from, or why there are none. */
export type AgentChangeComparisonMeasurement =
    | 'web-master'
    /** A native session is carrying the strips, so the Web Audio master tap hears nothing of them. */
    | 'unavailable-native-carrier'
    /** A stopped transport produces no programme to measure. */
    | 'unavailable-not-playing';

export type AgentChangeComparisonEndReason = 'user-ended' | 'project-changed' | 'group-reverted';

/** Short-term LUFS per side, `null` until that side has been measured. */
export type AgentChangeComparisonLoudness = { a: number | null; b: number | null };

export type AgentChangeComparisonSession = {
    groupId: string;
    side: AgentChangeComparisonSide;
    loudness: AgentChangeComparisonLoudness;
    /** `b - a`: the offset side A needs to sound at side B's level. */
    matchDb: number | null;
    /** Whether the fader ceiling clipped the requested match. */
    matchLimited: boolean;
    measurement: AgentChangeComparisonMeasurement;
    /** A revert or redo is in flight, so the project is between the two sides. */
    transitioning: boolean;
};

export type AgentChangeComparisonEnding = {
    groupId: string;
    side: AgentChangeComparisonSide;
    reason: AgentChangeComparisonEndReason;
};

export type AgentChangeComparisonState = {
    active: AgentChangeComparisonSession | null;
    lastEnded: AgentChangeComparisonEnding | null;
};

function createDefaultAgentChangeComparisonState(): AgentChangeComparisonState {
    return { active: null, lastEnded: null };
}

export const agentChangeComparisonStore = createStore<AgentChangeComparisonState>({
    initialData: createDefaultAgentChangeComparisonState(),
});

function writeSession(revise: (session: AgentChangeComparisonSession) => AgentChangeComparisonSession): void {
    const state = agentChangeComparisonStore.value;
    if (!state?.active) {
        return;
    }
    agentChangeComparisonStore.set({ ...state, active: revise(state.active) });
}

/** Open a comparison on side B: the committed project is the reference the other side is matched to. */
export function beginAgentChangeComparison(input: {
    groupId: string;
    measurement: AgentChangeComparisonMeasurement;
}): void {
    const state = agentChangeComparisonStore.value ?? createDefaultAgentChangeComparisonState();
    agentChangeComparisonStore.set({
        ...state,
        active: {
            groupId: input.groupId,
            side: 'B',
            loudness: { a: null, b: null },
            matchDb: null,
            matchLimited: false,
            measurement: input.measurement,
            transitioning: false,
        },
    });
}

export function markAgentChangeComparisonTransitioning(transitioning: boolean): void {
    writeSession((session) => ({ ...session, transitioning }));
}

/** The transition finished: this side is now the one sounding. */
export function settleAgentChangeComparisonSide(side: AgentChangeComparisonSide): void {
    writeSession((session) => ({ ...session, side, transitioning: false }));
}

export function recordAgentChangeComparisonMeasurement(measurement: AgentChangeComparisonMeasurement): void {
    const session = agentChangeComparisonStore.value?.active;
    // Restated on every sampler tick, so an unchanged reading must not wake
    // every subscriber ten times a second.
    if (!session || session.measurement === measurement) {
        return;
    }
    writeSession((current) => ({ ...current, measurement }));
}

function matchDbFor(loudness: AgentChangeComparisonLoudness): number | null {
    if (loudness.a === null || loudness.b === null) {
        return null;
    }
    return loudness.b - loudness.a;
}

export function recordAgentChangeComparisonLoudness(input: { side: AgentChangeComparisonSide; lufs: number }): void {
    writeSession((session) => {
        const loudness: AgentChangeComparisonLoudness =
            input.side === 'A' ? { ...session.loudness, a: input.lufs } : { ...session.loudness, b: input.lufs };
        return { ...session, loudness, matchDb: matchDbFor(loudness) };
    });
}

export function recordAgentChangeComparisonMatchLimited(matchLimited: boolean): void {
    writeSession((session) => ({ ...session, matchLimited }));
}

/** Close the comparison, leaving behind which group it was on, which side it ended on, and why. */
export function endAgentChangeComparison(reason: AgentChangeComparisonEndReason): void {
    const session = agentChangeComparisonStore.value?.active;
    if (!session) {
        return;
    }
    agentChangeComparisonStore.set({
        active: null,
        lastEnded: { groupId: session.groupId, side: session.side, reason },
    });
}
