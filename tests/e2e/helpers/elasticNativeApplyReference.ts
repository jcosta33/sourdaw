import {
    type Doc,
    applyChanges,
    clone,
    decodeChange,
    free,
    getActorId,
    getHeads,
    getMissingDeps,
} from '@automerge/automerge';

import { getCrdtDoc } from '../../../src/modules/CrdtDocument/useCases';

const REFERENCE_SAMPLE_COUNT = 5;
const REFERENCE_START = 'elastic-native-apply-reference-start';
const REFERENCE_END = 'elastic-native-apply-reference-end';

type RequestCapture = { actor: unknown; heads: unknown; reply: unknown };
type PhaseCapture = {
    phase: string;
    predecessor: Doc<Record<string, unknown>>;
    requests: RequestCapture[];
};
type PublishedChange = {
    actor: string;
    previousHeads: string[];
    heads: string[];
    changes: Uint8Array<ArrayBuffer>[];
    expectedWarpStates: string | undefined;
};

function equalHeads(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((head) => right.includes(head));
}

function isHeadArray(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.every((head: unknown) => typeof head === 'string') &&
        new Set(value).size === value.length
    );
}

function isOwnedChange(value: unknown): value is Uint8Array<ArrayBuffer> {
    return (
        value instanceof Uint8Array &&
        value.buffer instanceof ArrayBuffer &&
        value.byteLength > 0 &&
        value.byteOffset === 0 &&
        value.byteLength === value.buffer.byteLength
    );
}

function readPublishedChange(capture: PhaseCapture): PublishedChange {
    const [request] = capture.requests;
    if (!request || capture.requests.length !== 1) {
        throw new Error(`Expected one native Detect request for the reference in ${capture.phase}`);
    }
    const { actor, heads, reply } = request;
    if (
        typeof actor !== 'string' ||
        actor !== getActorId(capture.predecessor) ||
        !isHeadArray(heads) ||
        !equalHeads(heads, getHeads(capture.predecessor))
    ) {
        throw new Error(`Native Detect request did not match the protected predecessor in ${capture.phase}`);
    }
    if (
        typeof reply !== 'object' ||
        reply === null ||
        !('status' in reply) ||
        reply.status !== 'complete' ||
        !('heads' in reply) ||
        !isHeadArray(reply.heads) ||
        !('changes' in reply) ||
        !Array.isArray(reply.changes) ||
        reply.changes.length !== 1
    ) {
        throw new Error(`Expected one complete native Detect change in ${capture.phase}`);
    }
    const change: unknown = reply.changes[0];
    const published = getCrdtDoc('root');
    if (!isOwnedChange(change) || !published || getMissingDeps(published, reply.heads).length > 0) {
        throw new Error(`Expected the exact Worker reply in the published root in ${capture.phase}`);
    }
    return {
        actor,
        previousHeads: heads,
        heads: reply.heads,
        changes: [change],
        expectedWarpStates: JSON.stringify(published.warpStates),
    };
}

function nextTask(): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            resolve();
        };
        channel.port2.postMessage(undefined);
    });
}

async function hashChange(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function measureDecodeSample(change: PublishedChange) {
    const bytes = change.changes[0];
    await nextTask();
    const startTime = performance.now();
    const { hash } = decodeChange(bytes);
    const duration = performance.now() - startTime;
    await nextTask();
    const checksum = Array.from(bytes.subarray(4, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (change.heads.length !== 1 || change.heads[0] !== hash || !hash.startsWith(checksum)) {
        throw new Error('Reference decode did not produce the Worker change hash and checksum');
    }
    return { startTime, duration };
}

async function measureApplySample(predecessor: PhaseCapture['predecessor'], change: PublishedChange) {
    let candidate = clone(predecessor, { actor: change.actor });
    try {
        if (!equalHeads(getHeads(candidate), change.previousHeads)) {
            throw new Error('Reference clone did not start from the Worker request heads');
        }
        const patches = { count: 0 };
        await nextTask();
        const startTime = performance.now();
        [candidate] = applyChanges(candidate, change.changes, {
            patchCallback: (entries) => {
                patches.count = entries.length;
            },
        });
        const duration = performance.now() - startTime;
        await nextTask();
        if (
            patches.count === 0 ||
            !equalHeads(getHeads(candidate), change.heads) ||
            JSON.stringify(candidate.warpStates) !== change.expectedWarpStates
        ) {
            throw new Error('Reference apply did not produce the published Worker heads and warp state');
        }
        return { startTime, duration, patchCount: patches.count };
    } finally {
        free(candidate);
    }
}

/** The test owns every clone. Observing a request or reply retains only the needed references. */
export function createElasticNativeApplyReference() {
    let armed: PhaseCapture | undefined;
    const completed: { capture: PhaseCapture; change: PublishedChange }[] = [];
    return {
        arm(phase: string): void {
            const original = getCrdtDoc('root');
            if (!original || armed) {
                throw new Error(`Could not capture a fresh native Detect predecessor in ${phase}`);
            }
            armed = { phase, predecessor: clone(original, { actor: getActorId(original) }), requests: [] };
        },
        observeRequest(request: { actor: unknown; heads: unknown }): ((reply: unknown) => void) | undefined {
            if (!armed) {
                return undefined;
            }
            const capture: RequestCapture = { actor: request.actor, heads: request.heads, reply: undefined };
            armed.requests.push(capture);
            return (reply) => {
                capture.reply = reply;
            };
        },
        finish(phase: string): void {
            if (armed?.phase !== phase) {
                throw new Error(`Native Detect reference was not armed for ${phase}`);
            }
            const change = readPublishedChange(armed);
            completed.push({ capture: armed, change });
            armed = undefined;
        },
        async measure() {
            if (armed || completed.length === 0) {
                throw new Error('Native Detect reference requires completed product captures');
            }
            const start = performance.mark(REFERENCE_START);
            const phases = [];
            for (const { capture, change } of completed) {
                const bytes = change.changes[0];
                const sha256 = await hashChange(bytes);
                const samples = [];
                const decodeSamples = [];
                for (let index = 0; index < REFERENCE_SAMPLE_COUNT; index++) {
                    decodeSamples.push(await measureDecodeSample(change));
                    samples.push(await measureApplySample(capture.predecessor, change));
                }
                if ((await hashChange(bytes)) !== sha256) {
                    throw new Error(`Reference apply changed the input bytes in ${capture.phase}`);
                }
                phases.push({
                    phase: capture.phase,
                    previousHeads: change.previousHeads,
                    heads: change.heads,
                    bytes: bytes.byteLength,
                    sha256,
                    samples,
                    decodeSamples,
                });
            }
            performance.mark(REFERENCE_END);
            return { startTime: start.startTime, phases };
        },
        dispose(): void {
            if (armed) {
                free(armed.predecessor);
                armed = undefined;
            }
            for (const { capture } of completed.splice(0)) {
                free(capture.predecessor);
            }
        },
    };
}
