import { type LlmEngineStatus, llmStatusStore } from './llmStatusStore';

type GeneratingStatus = Extract<LlmEngineStatus, { state: 'generating' }>;

/** One planning turn's claim on the answering status, held from its first attempt until it settles. */
export type AnsweringTurn = { readonly id: symbol };

type AnsweringAttempt = {
    turn: AnsweringTurn;
    status: GeneratingStatus;
    // The engine revision when the attempt published, so settling can tell whether a load recorded a
    // status since.
    engineRevision: number;
};

/**
 * The sole writer of the `generating` status. Overlapping turns (the Prompt Bar and the chat both
 * plan) each register their attempt here, so the status names the newest attempt still answering
 * and, once none is, the status the engine settled to — never one turn's `generating` left behind
 * by another. A local engine load is not an answering attempt: it records its loading, ready and
 * error statuses through `publishEngineStatus`, which shows them at once with no turn answering
 * and otherwise holds them as the status the engine settles to.
 */
const answeringAttempts: AnsweringAttempt[] = [];

// The status the engine settled to outside any answering attempt, which a turn that leaves the
// engine as it was settles back to. It is never a `generating` status.
let settledStatus: LlmEngineStatus | null = null;

// Counts the engine statuses recorded while a turn answered.
let engineRevision = 0;

function removeAttempt(turn: AnsweringTurn): void {
    const index = answeringAttempts.findIndex((attempt) => attempt.turn === turn);
    if (index !== -1) {
        answeringAttempts.splice(index, 1);
    }
}

export const answeringStatus = {
    openTurn(): AnsweringTurn {
        return { id: Symbol('answering-turn') };
    },

    /** Registers (or replaces, on a fall-through) the turn's attempt as the newest and publishes it. */
    publish(turn: AnsweringTurn, status: GeneratingStatus): void {
        if (answeringAttempts.length === 0) {
            settledStatus = llmStatusStore.value;
        }
        removeAttempt(turn);
        answeringAttempts.push({ turn, status, engineRevision });
        llmStatusStore.set(status);
    },

    /**
     * Records a status the engine itself reached (a load's loading, ready or error). With no turn
     * answering it shows at once; otherwise the newest answering attempt keeps showing and this
     * becomes the status the engine settles to.
     */
    publishEngineStatus(status: LlmEngineStatus): void {
        if (answeringAttempts.length === 0) {
            llmStatusStore.set(status);
            return;
        }
        engineRevision += 1;
        settledStatus = status;
    },

    /** The engine's own status: what the store shows, except while a turn answers, then the status it settles to. */
    readEngineStatus(): LlmEngineStatus | null {
        return answeringAttempts.length === 0 ? llmStatusStore.value : settledStatus;
    },

    /** The status a turn that leaves the engine as it was settles to. */
    readSettled(): LlmEngineStatus | null {
        return settledStatus;
    },

    /**
     * Ends the turn's attempt. The newest remaining attempt keeps the status; with none left the
     * engine settles. `settled` is what the turn computed from the engine as it stood when its
     * attempt published, so a load that recorded a status since wins over it. A turn that is not
     * answering changes nothing.
     */
    settle(turn: AnsweringTurn, settled: LlmEngineStatus | null): void {
        const attempt = answeringAttempts.find((candidate) => candidate.turn === turn);
        if (attempt === undefined) {
            return;
        }
        const wasNewest = answeringAttempts.at(-1) === attempt;
        removeAttempt(turn);
        if (attempt.engineRevision === engineRevision) {
            settledStatus = settled;
        }
        const newest = answeringAttempts.at(-1);
        if (newest === undefined) {
            llmStatusStore.set(settledStatus);
            return;
        }
        if (wasNewest) {
            llmStatusStore.set(newest.status);
        }
    },

    /** Forgets every attempt without publishing, so each spec starts with no turn answering. */
    clear(): void {
        answeringAttempts.length = 0;
        settledStatus = null;
        engineRevision = 0;
    },
};
