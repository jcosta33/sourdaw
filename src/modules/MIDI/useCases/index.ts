// MIDI/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

// ── Arpeggiator ───────────────────────────────────────────────────────────────
export { arpeggiate } from './arpeggiator';

export { stampChord } from './chordStamps/stampChord';
export { removeNotesByIds } from './chordStamps/removeNotesByIds';
export { CHORD_TYPE_KEYS } from './chordStamps/CHORD_TYPE_KEYS';

// ── Chord Track ───────────────────────────────────────────────────────────────
export { addChordEvent } from './chordTrack/addChordEvent';
export { clearChordTrack } from './chordTrack/clearChordTrack';
export { createChordPitchProjector } from './chordTrack/createChordPitchProjector';
export { getChordAtBeat } from './chordTrack/getChordAtBeat';
export { moveChordEvent } from './chordTrack/moveChordEvent';
export { removeChordEvent } from './chordTrack/removeChordEvent';
export { replaceChordTrackState } from './chordTrack/replaceChordTrackState';
export { readLegacyChordTrackMigration } from './readLegacyChordTrackMigration';
export { toggleChordTrack } from './chordTrack/toggleChordTrack';
export { updateChordEvent } from './chordTrack/updateChordEvent';

export { getChordTrackHandlers } from './getChordTrackHandlers';

// ── Note Creation ─────────────────────────────────────────────────────────────
export { appendRecordedMidiNote } from './appendRecordedMidiNote';
export { createMidiNote } from './createMidiNote';

// ── File I/O ──────────────────────────────────────────────────────────────────
export { downloadMidiFile } from './exportMidiFile';
export { readMidiFile } from './importMidiFile';

// ── Formatting ────────────────────────────────────────────────────────────────
export { formatChordName } from './formatChordName';

// ── State Accessors ───────────────────────────────────────────────────────────
export { getMidiStoreState } from './getMidiStoreState';
export { serializeMidiStateForClips } from './serializeMidiStateForClips';
export { mergeImportedMidiClipNotes } from './mergeImportedMidiClipNotes';
export { setMidiStoreState } from './setMidiStoreState';
export { hydrateMidiProjectState } from './hydrateMidiProjectState';
export { resetMidiStoreForProject } from './resetMidiStoreForProject';
export { shouldPlayMidiEvent } from './shouldPlayMidiEvent';
export { duplicateMidiClipData } from './midiClipData/duplicateMidiClipData';
export { glueMidiClipData } from './midiClipData/glueMidiClipData';
export { canPrepareMidiClipGlueState } from './midiClipData/canPrepareMidiClipGlueState';
export { prepareMidiClipGlueState } from './midiClipData/prepareMidiClipGlueState';
export { midiClipGlueStateMatches } from './midiClipData/midiClipGlueStateMatches';
export { restoreMidiClipGlueState } from './midiClipData/restoreMidiClipGlueState';
export { removeMidiClipData } from './midiClipData/removeMidiClipData';
export { restoreMidiClipData } from './midiClipData/restoreMidiClipData';
export { prepareMidiClipSplit } from './midiClipData/prepareMidiClipSplit';
export { midiClipSplitStateMatches } from './midiClipData/midiClipSplitStateMatches';
export { restoreMidiClipSplitState } from './midiClipData/restoreMidiClipSplitState';

export { adaptGrooveTemplateForConsumer } from './grooveTemplates/adaptGrooveTemplateForConsumer';
export { applyGrooveTemplate } from './grooveTemplates/applyGrooveTemplate';
export { assignGrooveTemplate } from './grooveTemplates/assignGrooveTemplate';
export { createGrooveMidiEventProjector } from './grooveTemplates/createGrooveMidiEventProjector';
export { createGrooveTemplate } from './grooveTemplates/createGrooveTemplate';
export { deleteGrooveTemplate } from './grooveTemplates/deleteGrooveTemplate';
export { extractGrooveTemplate } from './grooveTemplates/extractGrooveTemplate';
export { getGrooveAssignment } from './grooveTemplates/getGrooveAssignment';
export { getGrooveExtractionActionErrorCode } from './grooveTemplates/getGrooveExtractionActionErrorCode';
export { getScopedGrooveAssignment } from './grooveTemplates/getScopedGrooveAssignment';
export { getScopedGrooveConsumerId } from './grooveTemplates/getScopedGrooveConsumerId';
export { getCanonicalGrooveTemplateKey } from './grooveTemplates/getCanonicalGrooveTemplateKey';
export { getGrooveTemplate } from './grooveTemplates/getGrooveTemplate';
export { getSupportedGrooveSubdivisions } from './grooveTemplates/getSupportedGrooveSubdivisions';
export { getStraightGrooveTemplateId } from './grooveTemplates/getStraightGrooveTemplateId';
export { hydrateGrooveTemplates } from './grooveTemplates/hydrateGrooveTemplates';
export { previewGrooveTemplate } from './grooveTemplates/previewGrooveTemplate';
export { prepareGrooveExtraction } from './grooveTemplates/prepareGrooveExtraction';
export { projectClipMidiEvents } from './grooveTemplates/projectClipMidiEvents';
export { projectCommittedGroove } from './grooveTemplates/projectCommittedGroove';
export { renameGrooveTemplate } from './grooveTemplates/renameGrooveTemplate';
export { restoreDeletedGrooveTemplate } from './grooveTemplates/restoreDeletedGrooveTemplate';
export { restoreGrooveAssignment } from './grooveTemplates/restoreGrooveAssignment';
export { snapshotGrooveTemplateDeletion } from './grooveTemplates/snapshotGrooveTemplateDeletion';

// ── MIDI Events ───────────────────────────────────────────────────────────────
export { addMidiCC } from './midiEvent/addMidiCC';
export { addPitchBend } from './midiEvent/addPitchBend';
export { moveMidiCC } from './midiEvent/moveMidiCC';
export { movePitchBend } from './midiEvent/movePitchBend';
export { removeMidiCC } from './midiEvent/removeMidiCC';
export { removePitchBend } from './midiEvent/removePitchBend';
export { setNotePressure } from './midiEvent/setNotePressure';
export { setNoteSlide } from './midiEvent/setNoteSlide';
export { setNotePitchBend } from './midiEvent/setNotePitchBend';
export { resolveMidiNoteArticulationId } from './resolveMidiNoteArticulationId';

// ── MIDI Note CRUD ────────────────────────────────────────────────────────────
export { addMidiNote } from './midiNoteCrud/addMidiNote';
export { appendMidiNotes } from './midiNoteCrud/appendMidiNotes';
export { batchAddMidiNotes } from './midiNoteCrud/batchAddMidiNotes';
export { duplicateClipNotes } from './midiNoteCrud/duplicateClipNotes';
export { getNotesForClip } from './midiNoteCrud/getNotesForClip';
export { migrateAbsoluteMidiNotes } from './midiNoteCrud/migrateAbsoluteMidiNotes';
export { moveMidiNote } from './midiNoteCrud/moveMidiNote';
export { prepareClipMidiShiftTransaction } from './midiNoteCrud/prepareClipMidiShiftTransaction';
export { prepareMidiGlobalTimeTransaction } from './midiNoteCrud/prepareMidiGlobalTimeTransaction';
export { prepareMidiTimeStateRestore } from './midiNoteCrud/prepareMidiTimeStateRestore';
export { prepareMidiTimeShiftTransaction } from './midiNoteCrud/prepareMidiTimeShiftTransaction';
export { removeMidiNote } from './midiNoteCrud/removeMidiNote';
export { resizeMidiNote } from './midiNoteCrud/resizeMidiNote';
export { setNoteProbability } from './midiNoteCrud/setNoteProbability';
export { setNoteVelocity } from './midiNoteCrud/setNoteVelocity';
export { setNoteVelocities } from './midiNoteCrud/setNoteVelocities';
export { setNotesForClip } from './midiNoteCrud/setNotesForClip';
export { shiftClipMidiNotes } from './midiNoteCrud/shiftClipMidiNotes';
export { shiftMidiNotesAfterBeat } from './midiNoteCrud/shiftMidiNotesAfterBeat';
export { splitMidiNotesAtBeat } from './midiNoteCrud/splitMidiNotesAtBeat';

// ── MIDI Note Transforms ──────────────────────────────────────────────────────
export { humanizeNotes } from './midiNoteTransforms/humanizeNotes';
export { invertNotes } from './midiNoteTransforms/invertNotes';
export { joinNotes } from './midiNoteTransforms/joinNotes';
export { legatoNotes } from './midiNoteTransforms/legatoNotes';
export { describeShortMidiOverlapRemoval } from './midiNoteTransforms/describeShortMidiOverlapRemoval';
export { projectShortMidiOverlapRemoval } from './midiNoteTransforms/projectShortMidiOverlapRemoval';
export { projectSyncopatedArpeggio } from './midiNoteTransforms/projectSyncopatedArpeggio';
export { projectDrumPreviewCandidateNotes } from './midiNoteTransforms/projectDrumPreviewCandidateNotes';
export { restoreMidiClipNotes } from './midiNoteTransforms/restoreMidiClipNotes';
export { quantizeNoteLengths } from './midiNoteTransforms/quantizeNoteLengths';
export { quantizeNotes } from './midiNoteTransforms/quantizeNotes';
export { retrogradeNotes } from './midiNoteTransforms/retrogradeNotes';
export { scaleAllVelocities } from './midiNoteTransforms/scaleAllVelocities';
export { scaleVelocities } from './midiNoteTransforms/scaleVelocities';
export { setAllVelocities } from './midiNoteTransforms/setAllVelocities';
export { splitNoteAtBeat } from './midiNoteTransforms/splitNoteAtBeat';
export { transposeNotes } from './midiNoteTransforms/transposeNotes';
export { snapClipToScale } from './snapClipToScale';

// ── Step Recording ────────────────────────────────────────────────────────────
export { hasActiveStepRecordingDependency } from './stepRecording/hasActiveStepRecordingDependency';
export { toggleStepRecording } from './stepRecording/toggleStepRecording';
export { stepRecordNoteOn } from './stepRecording/stepRecordNoteOn';
export { stepRecordNoteOff } from './stepRecording/stepRecordNoteOff';
export { stepRecordAdvance } from './stepRecording/stepRecordAdvance';
export { stepRecordRetreat } from './stepRecording/stepRecordRetreat';
export { stepRecordStepUp } from './stepRecording/stepRecordStepUp';
export { stepRecordStepDown } from './stepRecording/stepRecordStepDown';
export { setStepRecordBeat } from './stepRecording/setStepRecordBeat';
export { toggleStepRecordingForClip } from './stepRecording/toggleStepRecordingForClip';

export { getMidiNoteTransformHandlers } from './getMidiNoteTransformHandlers';
export { getMidiTransformProtocolContract } from './getMidiTransformProtocolContract';
export { getMidiGrooveHandlers } from './getMidiGrooveHandlers';

// ── Pattern Instances ─────────────────────────────────────────────────────────
export { getPatternInstanceHandlers } from './getPatternInstanceHandlers';

export { strumNotes } from './strumNotes/strumNotes';
export { restoreStrumOriginals } from './strumNotes/restoreStrumOriginals';

// ── Chord Track Transposition ─────────────────────────────────────────────────
export { transposeForChordTrack } from './transposeForChordTrack';

// ── WebMIDI Note Input ────────────────────────────────────────────────────────
export { initWebMidi } from './webMidiInput/initWebMidi';
export { setWebMidiRealtimeProcessor } from './webMidiInput/setWebMidiRealtimeProcessor';
export { setWebMidiRuntimeEventBus } from './webMidiInput/setWebMidiRuntimeEventBus';
export { setMidiInputTrack } from './webMidiInput/setMidiInputTrack';
export { getMidiInputTrack } from './webMidiInput/getMidiInputTrack';
export { getMidiInputTrackOwnerId } from './webMidiInput/getMidiInputTrackOwnerId';
export { getMidiInputTrackRevision } from './webMidiInput/getMidiInputTrackRevision';
export { selectMidiInput } from './webMidiInput/selectMidiInput';
export { resetMidiState } from './webMidiInput/resetMidiState';
export { panicLiveNotes } from './webMidiInput/panicLiveNotes';
export { triggerLiveNoteOn } from './triggerLiveNoteOn';
export { triggerLiveNoteOff } from './triggerLiveNoteOff';
export { getWebMidiInputHandlers } from './getWebMidiInputHandlers';

// ── MIDI Effect Plugins ───────────────────────────────────────────────────────
export { MIDI_EFFECT_FACTORIES } from './midiEffectPlugins/registry';
