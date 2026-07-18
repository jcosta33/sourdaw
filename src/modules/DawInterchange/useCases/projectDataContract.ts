import type { buildProjectData } from '#/modules/Project/useCases';

/**
 * ProjectData payload shape of the Project interchange contract (ADR 0011),
 * derived from the contract functions instead of importing Project's private
 * model: `buildProjectData` produces this snapshot on export and
 * `applyImportedProjectData` consumes it on import. Subtype names used by the
 * codec are derived by indexing the root type.
 */
type BuiltProjectData = NonNullable<Awaited<ReturnType<typeof buildProjectData>>>;

export type ProjectData = BuiltProjectData['data'];
export type ProjectTrack = ProjectData['arrangement']['tracks'][number];
export type ProjectClip = ProjectTrack['clips'][number];
export type ProjectTrackAlternative = ProjectTrack['alternatives'][number];
export type ProjectDevice = ProjectTrack['devices'][number];
export type ProjectFreezeState = ProjectTrack['freezeState'];
export type ProjectMidi = ProjectData['midi'];
export type ProjectMidiNote = ProjectMidi['notesByClipId'][string][number];
export type ProjectAutomation = ProjectData['automation'];
export type ProjectMarker = ProjectData['markers'][number];
