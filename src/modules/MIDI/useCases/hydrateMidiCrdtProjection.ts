import { grooveTemplateStore } from '../stores/grooveTemplateStore';
import { midiStore } from '../stores/midiStore';

export function hydrateMidiCrdtProjection(): void {
    midiStore.hydrate();
    grooveTemplateStore.hydrate();
}
