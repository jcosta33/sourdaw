/**
 * Hardware Controller Scripting Worker (R-J2).
 * Runs custom JavaScript scripts for hardware integration in a sandboxed environment.
 */

self.onmessage = (e) => {
    const { type, payload } = e.data;

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
                }
            };
            
            // Execute
            const scriptFunc = new Function('DAW', code);
            scriptFunc(DAW);
            
        } catch (err) {
            self.postMessage({ type: 'error', payload: { message: String(err) } });
        }
    }
};
