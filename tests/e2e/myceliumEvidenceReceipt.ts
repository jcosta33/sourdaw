import type { Page } from '@playwright/test';

export type MyceliumProjectReceipt = {
    projectSha256: string;
    projectSectionSha256: Record<string, string>;
    durationBeats: number;
    trackCount: number;
    clipCount: number;
    noteCount: number;
    automationLaneCount: number;
    automationPointCount: number;
};

export type MyceliumSourceReceipt = {
    sourceRevision: string;
    sourceDirty: boolean;
    sourceTreeSha256: string;
    sourceTreeHashScope: string;
};

type BindMyceliumEvidenceInput = {
    source: MyceliumSourceReceipt;
    project: MyceliumProjectReceipt;
    measurements: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function captureMyceliumSourceReceipt(metadata: unknown): MyceliumSourceReceipt {
    if (
        !isRecord(metadata) ||
        typeof metadata.myceliumSourceRevision !== 'string' ||
        typeof metadata.myceliumSourceDirty !== 'boolean' ||
        typeof metadata.myceliumSourceTreeSha256 !== 'string' ||
        typeof metadata.myceliumSourceTreeHashScope !== 'string'
    ) {
        throw new TypeError('Mycelium evidence source receipt is missing from Playwright metadata');
    }
    return {
        sourceRevision: metadata.myceliumSourceRevision,
        sourceDirty: metadata.myceliumSourceDirty,
        sourceTreeSha256: metadata.myceliumSourceTreeSha256,
        sourceTreeHashScope: metadata.myceliumSourceTreeHashScope,
    };
}

export async function captureMyceliumProjectReceipt(page: Page): Promise<MyceliumProjectReceipt> {
    return page.evaluate(async () => {
        const isRecordValue = (value: unknown): value is Record<string, unknown> =>
            typeof value === 'object' && value !== null;
        const projectModule: unknown = await import('/src/modules/Project/useCases/index.ts');
        if (
            typeof projectModule !== 'object' ||
            projectModule === null ||
            typeof Reflect.get(projectModule, 'buildProjectData') !== 'function'
        ) {
            throw new TypeError('Mycelium evidence could not resolve the project serialization contract');
        }
        const buildProjectData = Reflect.get(projectModule, 'buildProjectData') as (input: {
            includeAudioBuffers: boolean;
        }) => Promise<{ data: unknown } | null>;
        const built = await buildProjectData({ includeAudioBuffers: false });
        if (!built || typeof built.data !== 'object' || built.data === null) {
            throw new TypeError('Mycelium evidence could not serialize the live project');
        }
        const projectData = built.data as {
            arrangement: { tracks: Array<{ clips: unknown[] }> };
            automation: { lanes: Array<{ points: unknown[] }> };
            midi: { notesByClipId: Record<string, unknown[]> };
            transport: { loopEnd: number };
        };
        const hasItems = (value: unknown, property: string): boolean => {
            if (!isRecordValue(value)) {
                return true;
            }
            const items = value[property];
            return !Array.isArray(items) || items.length > 0;
        };
        const normalize = (value: unknown): unknown => {
            if (Array.isArray(value)) {
                return value.map((item) => normalize(item));
            }
            if (!isRecordValue(value)) {
                return value;
            }
            const entries = Object.entries(value).filter(([key, child]) => {
                if (child === undefined) {
                    return false;
                }
                if (key === 'createdAt' || key === 'updatedAt' || key === 'notes') {
                    return false;
                }
                if (
                    ((key === 'pitchBend' || key === 'pressure' || key === 'slide') && child === 0) ||
                    (key === 'probability' && child === 100)
                ) {
                    return false;
                }
                if (key === 'adjustmentLayers') {
                    return hasItems(child, 'layers');
                }
                if (key === 'grooves') {
                    return hasItems(child, 'assignments');
                }
                if (key === 'ghostClips') {
                    return !Array.isArray(child) || child.length > 0;
                }
                if (key === 'takeLanes') {
                    return hasItems(child, 'lanes');
                }
                return true;
            });
            return Object.fromEntries(
                entries
                    .toSorted(([first], [second]) => first.localeCompare(second))
                    .map(([key, child]) => {
                        if (key === 'frequencies' && Array.isArray(child)) {
                            return [
                                key,
                                child.map((frequency: unknown) =>
                                    typeof frequency === 'number' ? Number(frequency.toPrecision(12)) : frequency
                                ),
                            ];
                        }
                        return [key, normalize(child)];
                    })
            );
        };
        const normalizedProject = normalize(projectData);
        if (!isRecordValue(normalizedProject)) {
            throw new TypeError('Mycelium evidence normalization did not produce a project object');
        }
        const bytes = new TextEncoder().encode(JSON.stringify(normalizedProject));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const projectSha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        const projectSectionSha256 = Object.fromEntries(
            await Promise.all(
                Object.entries(normalizedProject).map(async ([key, value]) => {
                    const sectionBytes = new TextEncoder().encode(JSON.stringify(value));
                    const sectionDigest = await crypto.subtle.digest('SHA-256', sectionBytes);
                    const sectionSha256 = [...new Uint8Array(sectionDigest)]
                        .map((byte) => byte.toString(16).padStart(2, '0'))
                        .join('');
                    return [key, sectionSha256];
                })
            )
        );
        return {
            projectSha256,
            projectSectionSha256,
            durationBeats: projectData.transport.loopEnd,
            trackCount: projectData.arrangement.tracks.length,
            clipCount: projectData.arrangement.tracks.reduce((total, track) => total + track.clips.length, 0),
            noteCount: Object.values(projectData.midi.notesByClipId).reduce((total, notes) => total + notes.length, 0),
            automationLaneCount: projectData.automation.lanes.length,
            automationPointCount: projectData.automation.lanes.reduce((total, lane) => total + lane.points.length, 0),
        };
    });
}

export function bindMyceliumEvidence({
    source,
    project,
    measurements,
}: BindMyceliumEvidenceInput): Record<string, unknown> {
    return { ...source, ...project, ...measurements };
}
