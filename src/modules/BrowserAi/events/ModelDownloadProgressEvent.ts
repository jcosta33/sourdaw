// Public event-payload contract for a browser-model download. The shape is a pure
// model (models/ModelDownloadProgress) so repositories/ can consume it without
// crossing the repositories-no-business boundary; re-exported here as the event surface.
export type { ModelDownloadProgressPayload } from '../models/ModelDownloadProgress';
