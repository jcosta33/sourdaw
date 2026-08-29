/**
 * The native wire's strip-report reader, shared by both native graph backends.
 *
 * `map_graph_batch` and `apply_graph_commands` answer the same
 * `StripReportPayload` shape (`crates/sourdaw-native/src/commands/graph.rs`),
 * so both backends read it here: a second reader is a second place one seam
 * shape can be believed differently.
 *
 * A malformed report throws rather than degrading to an empty list. Reports are
 * the only channel that says which devices a strip actually realized
 * ({@link AudioGraphStripReport}), so one silently dropped reads downstream as
 * a strip that built nothing.
 */

import { type AudioGraphStripReport } from '../../models/AudioGraphBackend';

function readStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const out: string[] = [];
    for (const entry of value as readonly unknown[]) {
        if (typeof entry !== 'string') {
            return null;
        }
        out.push(entry);
    }
    return out;
}

/** `command` names the answering command in the failure, so a seam defect says which wire broke. */
export function readNativeStripReports(value: unknown, command: string): AudioGraphStripReport[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`${command} answered without reports: ${JSON.stringify(value)}`);
    }
    return (value as readonly unknown[]).map((entry) => {
        const report = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
        const kind = report?.kind;
        const id = report?.id;
        const deviceIds = readStringArray(report?.deviceIds);
        if ((kind !== 'track' && kind !== 'bus') || typeof id !== 'string' || deviceIds === null) {
            throw new Error(`${command} answered a malformed strip report: ${JSON.stringify(entry)}`);
        }
        return { kind, id, deviceIds };
    });
}
