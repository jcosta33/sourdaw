import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Observation = { kind: string; data: unknown; time: string; monotonicMs: number };
export type RecordObservation = (kind: string, data: unknown) => void;

export function createJournal(path: string): RecordObservation {
    mkdirSync(dirname(path), { recursive: true });
    return (kind, data) => {
        const observation: Observation = { kind, data, time: new Date().toISOString(), monotonicMs: performance.now() };
        appendFileSync(path, `${JSON.stringify(observation)}\n`);
    };
}

export function writeReceipt(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    const descriptor = openSync(path, 'r');
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

export function recordOf(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return Object.fromEntries(Object.entries(value));
}

export function requiredText(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label} must be nonempty text`);
    }
    return value;
}
