import { type LlmEngineStatus, llmStatusStore } from '../../stores/llmStatusStore';

type GeneratingStatus = Extract<LlmEngineStatus, { state: 'generating' }>;

/** One planning turn's claim on the answering status, held from its first attempt until it settles. */
export type AnsweringTurn = { readonly id: symbol };

/**
 * The sole writer of the `generating` status. Overlapping turns (the Prompt Bar and the chat both
 * plan) each register their attempt here, so the status names the newest attempt still answering
 * and, once none is, the status the last turn to settle computed — never one turn's `generating`
 * left behind by another. A local engine load in progress is not an answering attempt: its
 * loading, ready and error writes stay with the load itself.
 */
const answeringAttempts: { turn: AnsweringTurn; status: GeneratingStatus }[] = [];

// The status the engine settled to outside any answering attempt, which a turn that leaves the
// engine as it was settles back to. It is never a `generating` status.
let settledStatus: LlmEngineStatus | null = null;

function removeAttempt(turn: AnsweringTurn): boolean {
    const index = answeringAttempts.findIndex((attempt) => attempt.turn === turn);
    if (index === -1) {
        return false;
    }
    answeringAttempts.splice(index, 1);
    return true;
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
        answeringAttempts.push({ turn, status });
        llmStatusStore.set(status);
    },

    /** The status a turn that leaves the engine as it was settles to. */
    readSettled(): LlmEngineStatus | null {
        return settledStatus;
    },

    /**
     * Ends the turn's attempt. The newest remaining attempt keeps the status; with none left the
     * engine settles to `settled`. A turn that is not answering changes nothing.
     */
    settle(turn: AnsweringTurn, settled: LlmEngineStatus | null): void {
        const wasNewest = answeringAttempts.at(-1)?.turn === turn;
        if (!removeAttempt(turn)) {
            return;
        }
        settledStatus = settled;
        const newest = answeringAttempts.at(-1);
        if (newest === undefined) {
            llmStatusStore.set(settled);
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
    },
};
