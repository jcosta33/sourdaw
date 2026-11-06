// E2E-only input of the SAME build as index.html. Direct namespace exports keep
// the App's stores, handlers, inspection provider and audio cache identities.
export * as arrangement from '../../src/modules/Arrangement/stores';
export * as midi from '../../src/modules/MIDI/stores';
export * as automation from '../../src/modules/Automation/stores';
export * as project from '../../src/modules/Project/stores';
export * as crdt from '../../src/modules/CrdtDocument/useCases';
export * as inspection from '../../src/modules/CrdtDocument/useCases/agentProjectInspectionPort';
export * as audio from '../../src/modules/AudioEngine/useCases';
export * as command from '../../src/modules/Command/useCases';
