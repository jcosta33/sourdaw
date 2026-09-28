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
    getAudioSampleRate,
    getMasterStereoAnalysers,
    hasLiveNativeGraphSession,
    setMasterComparisonTrimDb,
    MomentaryLUFS,
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

/** BS.1770-4 momentary block: 400 ms of programme, the granularity the meters change at. */
const MOMENTARY_BLOCK_SECONDS = 0.4;

/**
 * Blocks one side contributes before its loudness is trusted. Eight 400 ms
 * blocks are the short-term meter's three-second window, so the first trusted
 * reading is the first full one.
 */
const BLOCKS_PER_SIDE = 8;

/** `ShortTermLUFS` floors here; a reading sitting on the floor measured silence, not a level. */
const SILENCE_LUFS = -70;

/** One tap read: the master's most recent left and right chunks. */
type StereoChunk = { left: Float32Array; right: Float32Array };

type LoudnessSampler = { readStereoChunks: () => StereoChunk };

/**
 * Collects tap reads and releases a whole 400 ms block into the momentary
 * meter once that much programme is held.
 *
 * The tap offers only its newest `fftSize` samples per tick while the audio
 * clock moves further between ticks, so pushing per tick would feed the meter
 * a fraction of the programme and stretch its 400 ms window over seconds of
 * wall time. A tick's read never carries a whole block, so `feed` releases at
 * most one per call.
 */
class MomentaryBlockFeeder {
    private readonly blockFrames: number;
    private readonly sink: (left: Float32Array, right: Float32Array) => void;
    private pendingLeft = new Float32Array(0);
    private pendingRight = new Float32Array(0);
    private pendingFrames = 0;

    constructor(blockFrames: number, sink: (left: Float32Array, right: Float32Array) => void) {
        this.blockFrames = blockFrames;
        this.sink = sink;
    }

    feed(left: Float32Array, right: Float32Array): boolean {
        const frameCount = Math.min(left.length, right.length);
        const needed = this.pendingFrames + frameCount;
        if (needed > this.pendingLeft.length) {
            // Held across ticks, and regrown only if the analyser's fftSize
            // grows mid-comparison.
            const grownLeft = new Float32Array(needed);
            grownLeft.set(this.pendingLeft);
            this.pendingLeft = grownLeft;
            const grownRight = new Float32Array(needed);
            grownRight.set(this.pendingRight);
            this.pendingRight = grownRight;
        }
        this.pendingLeft.set(left.subarray(0, frameCount), this.pendingFrames);
        this.pendingRight.set(right.subarray(0, frameCount), this.pendingFrames);
        this.pendingFrames += frameCount;
        if (this.pendingFrames < this.blockFrames) {
            return false;
        }
        this.sink(this.pendingLeft.subarray(0, this.blockFrames), this.pendingRight.subarray(0, this.blockFrames));
        this.pendingLeft.copyWithin(0, this.blockFrames, this.pendingFrames);
        this.pendingRight.copyWithin(0, this.blockFrames, this.pendingFrames);
        this.pendingFrames -= this.blockFrames;
        return true;
    }
}

type ComparisonRuntime = {
    sampler: LoudnessSampler;
    ticker: ReturnType<typeof setInterval>;
    /** Reset whenever a side becomes current, so one side's window never carries the other's programme. */
    momentary: MomentaryLUFS;
    meter: ShortTermLUFS;
    feeder: MomentaryBlockFeeder;
    blocksOnSide: number;
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
    // Held across ticks: the analysers' fftSize does not change while one
    // comparison runs, and fresh arrays per tick would allocate ten times a
    // second.
    let tapData: {
        left: Float32Array<ArrayBuffer>;
        right: Float32Array<ArrayBuffer>;
    } | null = null;
    return {
        readStereoChunks: () => {
            const { left: leftAnalyser, right: rightAnalyser } = getMasterStereoAnalysers();
            if (!tapData || tapData.left.length !== leftAnalyser.fftSize) {
                tapData = {
                    left: new Float32Array(leftAnalyser.fftSize),
                    right: new Float32Array(rightAnalyser.fftSize),
                };
            }
            const { left, right } = tapData;
            // fftSize, not frequencyBinCount: getFloatTimeDomainData fills up to
            // fftSize samples, so the frequency-bin length would read half the tap.
            leftAnalyser.getFloatTimeDomainData(left);
            rightAnalyser.getFloatTimeDomainData(right);
            return { left, right };
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

function createSideFeeder(): MomentaryBlockFeeder {
    return new MomentaryBlockFeeder(Math.round(MOMENTARY_BLOCK_SECONDS * getAudioSampleRate()), (left, right) => {
        runtime?.momentary.push(left, right);
    });
}

function resetSideMeter(): void {
    if (!runtime) {
        return;
    }
    runtime.momentary = new MomentaryLUFS(getAudioSampleRate());
    runtime.meter = new ShortTermLUFS();
    // A fresh feeder drops the previous side's half-accumulated programme,
    // which must not open the new side's first block.
    runtime.feeder = createSideFeeder();
    runtime.blocksOnSide = 0;
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

    // Whole 400 ms blocks reach the momentary meter, released from the
    // accumulating feeder only once a full block of programme has been read.
    const chunks = runtime.sampler.readStereoChunks();
    if (!runtime.feeder.feed(chunks.left, chunks.right)) {
        return;
    }
    runtime.meter.push(runtime.momentary.energy);
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
        momentary: new MomentaryLUFS(getAudioSampleRate()),
        meter: new ShortTermLUFS(),
        feeder: createSideFeeder(),
        blocksOnSide: 0,
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

export function getAgentChangeComparisonView(): AgentChangeComparisonState {
    const state = agentChangeComparisonStore.value;
    if (!state) {
        return { active: null, lastEnded: null };
    }
    return structuredClone(state);
}
