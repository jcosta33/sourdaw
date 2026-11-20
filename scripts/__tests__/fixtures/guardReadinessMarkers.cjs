const { publishJson } = require('./atomicJsonMarker.cjs');

function publishDescendantReady(markerPath, record, filesystem) {
    publishJson(markerPath, record, filesystem);
}

function publishRootPid(markerPath, pid, filesystem) {
    publishJson(markerPath, pid, filesystem);
}

module.exports = { publishDescendantReady, publishRootPid };
