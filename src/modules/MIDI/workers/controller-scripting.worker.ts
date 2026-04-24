/**
 * Hardware Controller Scripting Worker (R-J2).
 * Runs custom JavaScript scripts for hardware integration in a sandboxed environment.
 */

type ControllerScriptMessage = { type: 'runScript'; payload: { code: string } };

self.onmessage = (event: MessageEvent<ControllerScriptMessage>) => {
    const { type, payload } = event.data;

    if (type === 'runScript') {
        const { code } = payload;
        try {
            // SECURITY NOTE: using new Function() in a Worker provides basic isolation
            // but is not a full secure sandbox. Production usage should use a more
            // robust isolation mechanism if running untrusted third-party scripts.
            console.log('Running controller script...');

            // API provided to the script
            const DAW = {
                setParam: (trackId: string, deviceId: string, paramId: string, value: number) => {
                    self.postMessage({ type: 'setParam', payload: { trackId, deviceId, paramId, value } });
                },
                sendMidi: (bytes: number[]) => {
                    self.postMessage({ type: 'sendMidi', payload: { bytes } });
                },
            };

            // Execute
            // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional: this worker's entire purpose is to execute user-supplied controller scripts; new Function() runs inside a Worker (already sandboxed) with a restricted DAW API
            const scriptFunc = new Function('DAW', code);
            (scriptFunc as (daw: typeof DAW) => void)(DAW);
        } catch (error) {
            self.postMessage({ type: 'error', payload: { message: String(error) } });
        }
    }
};
