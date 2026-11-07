// E2E-only same-build module for direct project creation.
// Shares the App module graph with index.html so newProject runs with the same
// singleton store and lifecycle instances as the application.
// Never creates a project on import — exports only the callable surface.
export { newProject } from '../../src/modules/Project/useCases';
