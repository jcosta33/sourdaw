import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';
import { type TrackTemplate } from '../../models/TrackTemplate';
export const storage = createLocalStorage<TrackTemplate[]>('sourdaw:track-templates');