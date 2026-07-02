import { type WebMidiState } from '../../models/WebMidiTypes';

import { webMidiState } from './state';

export function getSnapshot(): WebMidiState {
    return webMidiState.current;
}
