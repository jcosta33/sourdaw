import { type WebMidiState } from '../../models/WebMidiTypes';

import { webMidiState } from './state';

export function getState(): WebMidiState {
    return webMidiState.current;
}
