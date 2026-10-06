import { getArrangementEndBeat } from '../models/ArrangementEnd';
import { trackStore } from '../stores/trackStore';

export function getLastClipEndBeat(): number {
    return getArrangementEndBeat(trackStore.value?.tracks ?? []);
}
