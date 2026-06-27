import { inject } from '#/infra/di/inject';

import { YeastEventBus } from '../stores/yeastEventBus';
import { getYeastRack, getWorkletNodeSync, unregisterProcessorType, syncStoreFromRack } from '../stores/yeastStore';

export const removeYeastProcessor = inject({ eventBus: YeastEventBus })(
    ({ eventBus }) =>
        function removeYeastProcessor(id: string): void {
            const rack = getYeastRack();
            unregisterProcessorType(id);
            // removeProcessor returns a Note Off for every note still sounding through
            // the chain when the processor is pulled (a generator's reset() drops its
            // scheduled offs without emitting them). The rack has no downstream of its
            // own, so emit the offs as an app event and let the AudioEngine deliver them
            // to the live instrument — otherwise those notes hang.
            const hangingOffs = rack.removeProcessor(id);
            getWorkletNodeSync()?.removeProcessor(id);
            syncStoreFromRack();

            if (hangingOffs.length > 0) {
                const notes: number[] = [];
                for (const evt of hangingOffs) {
                    if (evt.kind.type === 'noteOff') {
                        notes.push(evt.kind.note);
                    }
                }
                if (notes.length > 0) {
                    void eventBus.emit('yeast.notesOff', { notes });
                }
            }
        }
);
