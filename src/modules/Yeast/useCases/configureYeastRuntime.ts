import { Container } from '#/infra/di/Container';

import { setYeastRuntimeNotesOffHandler, setYeastRuntimeOutputPanicHandler } from '../engine/yeastRuntime';
import { YeastEventBus } from '../stores/yeastEventBus';

type ConfigureYeastRuntimeInput = {
    panicOutputNotes: () => void;
};

export function configureYeastRuntime({ panicOutputNotes }: ConfigureYeastRuntimeInput): void {
    const eventBus = Container.get(YeastEventBus);
    setYeastRuntimeOutputPanicHandler(panicOutputNotes);
    setYeastRuntimeNotesOffHandler((notesOff) => {
        for (const payload of notesOff) {
            if (payload.noteOffs.length > 0) {
                void eventBus.emit('yeast.notesOff', payload);
            }
        }
    });
}
