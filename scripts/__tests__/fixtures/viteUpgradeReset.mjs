import { errorMonitor } from 'node:events';
import { pathToFileURL } from 'node:url';

const [viteEntry, root] = process.argv.slice(2);
const { createServer } = await import(pathToFileURL(viteEntry).href);
const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
});
const httpServer = server.httpServer;
if (!httpServer) throw new Error('Vite did not expose its HTTP server');
httpServer.on('upgrade', (_request, socket) => {
    socket.on(errorMonitor, (error) => process.send?.({ type: 'socket-error', code: error.code, pid: process.pid }));
    process.send?.({ type: 'upgrade', pid: process.pid });
});
await server.listen();
const address = httpServer.address();
if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP address');
process.send?.({ type: 'ready', port: address.port, pid: process.pid });
