import type { DirectProjectSetupModule } from './directProjectSetupContract';
import { newProject as _newProject } from '../../src/modules/Project/useCases';

// Checked against the pure contract so both Node tooling and browser tsconfigs
// agree on the callable surface without crossing module-graph boundaries.
export const newProject: DirectProjectSetupModule['newProject'] = _newProject;
