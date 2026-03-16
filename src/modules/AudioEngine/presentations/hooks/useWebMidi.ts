import { useEffect, useSyncExternalStore } from "react";
import {
    initWebMidi,
    destroyWebMidi,
    selectMidiInput,
    subscribe,
    getSnapshot,
} from "../../useCases/webMidiInput";

export const useWebMidi = () => {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    useEffect(() => {
        const init = initWebMidi();

        return () => {
            void init.then(() => {
                destroyWebMidi();
            });
        };
    }, []);

    return {
        inputs: state.inputs,
        selectedInputId: state.selectedInputId,
        selectInput: selectMidiInput,
        isSupported: state.isSupported,
    };
};
