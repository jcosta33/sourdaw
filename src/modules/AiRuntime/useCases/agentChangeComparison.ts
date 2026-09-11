/**
 * Audition a committed agent action group against the project without it.
 *
 * The comparison is two sides of one project rather than two renders: side B is
 * the project as the group left it, side A is the same project with the group's
 * undo entries reverted, and toggling between them is a revert and a redo of
 * that one group while playback keeps running. Only the newest undoable group
 * can be compared, because anything newer would be undone along with it.
 *
 * The trim is what makes the comparison worth running. A change that only
 * raised the level reads as an improvement to every listener, so side A is
 * offset by the difference between the two sides' short-term loudness before it
 * is judged — the convention Gluten's Match control and Proof's A/B gain offset
 * already follow for one device, applied here to a whole project edit. The
 * offset is monitoring only: nothing writes it into the document, and the
 * master fader keeps reading the position the musician left it at.
 */

import {
    computeMomentaryLUFS,
    getAudioSampleRate,
    getMasterAnalyser,
    hasLiveNativeGraphSession,
    setMasterComparisonTrimDb,
    ShortTermLUFS,
} from '#/modules/AudioEngine/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import { redo, revertActionGroup } from '#/modules/Command/useCases';
import { transportStore } from '#/modules/Transport/stores';

import {
    type AgentChangeComparisonEndReason,
    type AgentChangeComparisonMeasurement,
    type AgentChangeComparisonSession,
    type AgentChangeComparisonSide,
    type AgentChangeComparisonState,
    agentChangeComparisonStore,
    beginAgentChangeComparison,
    endAgentChangeComparison,
    markAgentChangeComparisonTransitioning,
    recordAgentChangeComparisonLoudness,
    recordAgentChangeComparisonMatchLimited,
    recordAgentChangeComparisonMeasurement,
    settleAgentChangeComparisonSide,
} from '../stores/agentChangeComparisonStore';
import { type AiActionGroup, aiActionHistoryStore } from '../stores/aiActionHistoryStore';

/** Why a group cannot be compared. */
export type AgentChangeComparisonRefusal =
    'group-not-found' | 'runtime-group' | 'reverted' | 'later-edits' | 'another-comparison-active';

export type AgentChangeComparisonAvailability =
    { available: true } | { available: false; reason: AgentChangeComparisonRefusal };

export type AgentChangeComparisonStart =
    { status: 'started' } | { status: 'refused'; reason: AgentChangeComparisonRefusal };

export type AgentChangeComparisonToggle =
    { status: AgentChangeComparisonSide } | { status: 'refused'; reason: 'inactive' | 'transitioning' };

/** How often the master tap is read. Ten readings a second is the rate the LUFS meter already runs at. */
const SAMPLE_INTERVAL_MS = 100;

/**
 * Ticks between the readings that reach the short-term accumulator. It holds
 * 400 ms blocks, so a reading pushed at every {@link SAMPLE_INTERVAL_MS} tick
 * would fill its three-second window with the last 800 ms of programme.
 */
const TICKS_PER_BLOCK = 4;

/**
 * Blocks one side contributes before its loudness is trusted. Eight 400 ms
 * blocks is the short-term window itself, so the first trusted reading is the
 * first full one.
 */
const BLOCKS_PER_SIDE = 8;

/** `ShortTermLUFS` floors here; a reading sitting on the floor measured silence, not a level. */
const SILENCE_LUFS = -70;

type LoudnessSampler = { readMomentaryLufs: () => number };

type ComparisonRuntime = {
    sampler: LoudnessSampler;
    ticker: ReturnType<typeof setInterval>;
    /** Reset whenever a side becomes current, so one side's window never carries the other's programme. */
    meter: ShortTermLUFS;
    blocksOnSide: number;
    ticksSinceBlock: number;
    unsubscribe: () => void;
};

let runtime: ComparisonRuntime | null = null;
let transitions: Promise<unknown> = Promise.resolve();

/**
 * One transition at a time. A revert and a redo that overlapped would interleave
 * their writes to a single undo stack, and the project would land on neither side.
 */
function serialise<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    const next = transitions.then(work, work);
    transitions = next.catch(() => undefined);
    return next;
}

function createMasterLoudnessSampler(): LoudnessSampler {
    // Held across ticks: the analyser's bin count does not change while one
    // comparison runs, and a fresh array per tick allocates ten times a second.
    let samples: Float32Array<ArrayBuffer> | null = null;
    return {
        readMomentaryLufs: () => {
            const analyser = getMasterAnalyser();
            if (!samples || samples.length !== analyser.frequencyBinCount) {
                samples = new Float32Array(analyser.frequencyBinCount);
            }
            analyser.getFloatTimeDomainData(samples);
            return computeMomentaryLUFS(samples, getAudioSampleRate());
        },
    };
}

function resolveMeasurement(): AgentChangeComparisonMeasurement {
    if (hasLiveNativeGraphSession()) {
        return 'unavailable-native-carrier';
    }
    if (transportStore.value?.isPlaying === true) {
        return 'web-master';
    }
    return 'unavailable-not-playing';
}

function findGroup(groupId: string): AiActionGroup | null {
    const groups = aiActionHistoryStore.value?.groups ?? [];
    return groups.find((group) => group.groupId === groupId) ?? null;
}

/** Whether the group is still the newest undoable unit, which is what makes reverting it a clean A side. */
function pastEndsWithGroup(groupId: string): boolean {
    const past = undoHistoryStore.value?.past ?? [];
    return past.length > 0 && past[past.length - 1]?.groupId === groupId;
}

/** Whether the group is still the next redoable unit, which is what makes returning to B possible. */
function futureStartsWithGroup(groupId: string): boolean {
    return undoHistoryStore.value?.future[0]?.groupId === groupId;
}

function activeSession(): AgentChangeComparisonSession | null {
    return agentChangeComparisonStore.value?.active ?? null;
}

function availability({ groupId }: { groupId: string }): AgentChangeComparisonAvailability {
    const group = findGroup(groupId);
    if (!group) {
        return { available: false, reason: 'group-not-found' };
    }
    if (group.executionKind === 'runtime') {
        return { available: false, reason: 'runtime-group' };
    }
    if (group.reverted) {
        return { available: false, reason: 'reverted' };
    }
    if (!pastEndsWithGroup(groupId)) {
        return { available: false, reason: 'later-edits' };
    }
    const session = activeSession();
    if (session && session.groupId !== groupId) {
        return { available: false, reason: 'another-comparison-active' };
    }
    return { available: true };
}

/**
 * Put the current match on the output.
 *
 * Side B is the reference and always sounds untrimmed; side A is the one that
 * moves, so the offset lands there and nowhere else. What comes back says
 * whether the fader had the headroom to deliver it.
 */
function applyMatchTrim(session: AgentChangeComparisonSession): void {
    if (session.side === 'B') {
        setMasterComparisonTrimDb(0);
        return;
    }
    const { limited } = setMasterComparisonTrimDb(session.matchDb ?? 0);
    recordAgentChangeComparisonMatchLimited(limited);
}

function resetSideMeter(): void {
    if (!runtime) {
        return;
    }
    runtime.meter = new ShortTermLUFS();
    runtime.blocksOnSide = 0;
    runtime.ticksSinceBlock = 0;
}

function loudnessOnSide(session: AgentChangeComparisonSession, side: AgentChangeComparisonSide): number | null {
    if (side === 'A') {
        return session.loudness.a;
    }
    return session.loudness.b;
}

function sampleOnce(): void {
    const session = activeSession();
    if (!session || !runtime) {
        return;
    }

    const measurement = resolveMeasurement();
    recordAgentChangeComparisonMeasurement(measurement);
    // A transition leaves the project half-reverted, so what is sounding
    // belongs to neither side and must not join either side's window.
    if (measurement !== 'web-master' || session.transitioning) {
        return;
    }

    // Every tick refreshes what the measurement is; only every fourth one
    // contributes a block, which is the rate the window is sized in.
    runtime.ticksSinceBlock += 1;
    if (runtime.ticksSinceBlock < TICKS_PER_BLOCK) {
        return;
    }
    runtime.ticksSinceBlock = 0;
    runtime.meter.push(runtime.sampler.readMomentaryLufs());
    runtime.blocksOnSide += 1;
    if (runtime.blocksOnSide < BLOCKS_PER_SIDE) {
        return;
    }

    const lufs = runtime.meter.value;
    if (lufs <= SILENCE_LUFS || loudnessOnSide(session, session.side) !== null) {
        return;
    }
    recordAgentChangeComparisonLoudness({ side: session.side, lufs });

    const matched = activeSession();
    if (matched) {
        applyMatchTrim(matched);
    }
}

function watchUndoDivergence(): void {
    const session = activeSession();
    if (!session || session.transitioning) {
        return;
    }
    // The group has to stay the unit the comparison can move across: the next
    // redo while A is sounding, the newest undo while B is. An edit made from
    // anywhere else takes that position and there is no longer a pair to compare.
    if (session.side === 'A') {
        if (!futureStartsWithGroup(session.groupId)) {
            finishComparison('project-changed');
        }
        return;
    }
    if (!pastEndsWithGroup(session.groupId)) {
        finishComparison('project-changed');
    }
}

function watchGroupReverted(): void {
    const session = activeSession();
    if (!session) {
        return;
    }
    if (findGroup(session.groupId)?.reverted === true) {
        finishComparison('group-reverted');
    }
}

function stopSampling(): void {
    if (!runtime) {
        return;
    }
    clearInterval(runtime.ticker);
    runtime.unsubscribe();
    runtime = null;
}

function startSampling(): void {
    stopSampling();
    const unsubscribeUndo = undoHistoryStore.subscribe(() => {
        watchUndoDivergence();
    });
    const unsubscribeHistory = aiActionHistoryStore.subscribe(() => {
        watchGroupReverted();
    });
    runtime = {
        sampler: createMasterLoudnessSampler(),
        ticker: setInterval(() => {
            sampleOnce();
        }, SAMPLE_INTERVAL_MS),
        meter: new ShortTermLUFS(),
        blocksOnSide: 0,
        ticksSinceBlock: 0,
        unsubscribe: () => {
            unsubscribeUndo();
            unsubscribeHistory();
        },
    };
}

/** Clear the trim, stop measuring, and record why the comparison is over. */
function finishComparison(reason: AgentChangeComparisonEndReason): void {
    setMasterComparisonTrimDb(0);
    stopSampling();
    endAgentChangeComparison(reason);
}

function settleOnSide(side: AgentChangeComparisonSide): AgentChangeComparisonToggle {
    settleAgentChangeComparisonSide(side);
    resetSideMeter();
    const session = activeSession();
    if (session) {
        applyMatchTrim(session);
    }
    return { status: side };
}

/**
 * Move the project across the group, and say whether it landed.
 *
 * A revert or a redo that rejects leaves the project on neither side, and there
 * is no second stack move that could put it back where it was. The comparison
 * closes instead of standing on a transition that will never settle: the trim
 * comes off, the sampler stops, and the ending says the transition is what
 * failed.
 */
async function moveAcrossGroup(move: () => Promise<void>): Promise<boolean> {
    try {
        await move();
        return true;
    } catch {
        finishComparison('transition-failed');
        return false;
    }
}

/**
 * Run one side change.
 *
 * The session is read here rather than carried in from the press, because this
 * runs behind whatever the chain already held: an `end` queued first has closed
 * the comparison by now, and reverting or redoing on its behalf would move the
 * project under a musician who is no longer comparing anything.
 */
async function runToggle(groupId: string): Promise<AgentChangeComparisonToggle> {
    const session = activeSession();
    if (!session || session.groupId !== groupId) {
        return { status: 'refused', reason: 'inactive' };
    }

    if (session.side === 'B') {
        const reverted = await moveAcrossGroup(() => revertActionGroup(groupId));
        return reverted ? settleOnSide('A') : { status: 'refused', reason: 'inactive' };
    }

    const redone = await moveAcrossGroup(() => redo());
    if (!redone) {
        return { status: 'refused', reason: 'inactive' };
    }
    if (!pastEndsWithGroup(groupId)) {
        // The redo did not put the group back at the head of `past`, so
        // something else now owns the newest edit and B is no longer reachable.
        finishComparison('project-changed');
        return { status: 'refused', reason: 'inactive' };
    }
    return settleOnSide('B');
}

function start({ groupId }: { groupId: string }): Promise<AgentChangeComparisonStart> {
    return serialise(async () => {
        const admission = availability({ groupId });
        if (!admission.available) {
            return { status: 'refused', reason: admission.reason };
        }
        beginAgentChangeComparison({ groupId, measurement: resolveMeasurement() });
        startSampling();
        return { status: 'started' };
    });
}

function toggle(): Promise<AgentChangeComparisonToggle> {
    const session = activeSession();
    if (!session) {
        return Promise.resolve({ status: 'refused', reason: 'inactive' });
    }
    if (session.transitioning) {
        return Promise.resolve({ status: 'refused', reason: 'transitioning' });
    }
    // Marked before the work is queued, so a second press lands on a refusal
    // rather than waiting behind the revert or redo already in flight.
    markAgentChangeComparisonTransitioning(true);
    return serialise(() => runToggle(session.groupId));
}

function end(): Promise<void> {
    return serialise(async () => {
        const session = activeSession();
        if (!session) {
            return;
        }
        // Ending is not a decision about the change: the committed project is
        // what stands, and the explicit Revert control is what keeps side A.
        if (session.side !== 'A' || !futureStartsWithGroup(session.groupId)) {
            finishComparison('user-ended');
            return;
        }
        markAgentChangeComparisonTransitioning(true);
        const redone = await moveAcrossGroup(() => redo());
        if (!redone) {
            return;
        }
        // The redo is what returns the committed project, so the ending says so
        // only once the group is back at the head of `past`. Reporting
        // `user-ended` over a redo that did not land would leave the musician
        // reading a return to a project they are in fact still hearing side A of.
        finishComparison(pastEndsWithGroup(session.groupId) ? 'user-ended' : 'left-on-a');
    });
}

export const agentChangeComparison = { availability, start, toggle, end };

function copySession(session: AgentChangeComparisonSession | null): AgentChangeComparisonSession | null {
    if (!session) {
        return null;
    }
    return { ...session, loudness: { ...session.loudness } };
}

export function getAgentChangeComparisonView(): AgentChangeComparisonState {
    const state = agentChangeComparisonStore.value;
    if (!state) {
        return { active: null, lastEnded: null };
    }
    return {
        active: copySession(state.active),
        lastEnded: state.lastEnded ? { ...state.lastEnded } : null,
    };
}
