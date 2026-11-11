// Run: node --test tests/
// Loads background.js against a stubbed chrome API and checks that closing the
// PiP seeks the original tab to where the PiP left off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadBackground() {
    const listeners = {};
    const nativeListeners = [];
    const executed = [];
    const posted = [];
    const port = {
        onMessage: { addListener: (fn) => nativeListeners.push(fn) },
        onDisconnect: { addListener: () => {} },
        postMessage: (msg) => posted.push(msg),
        disconnect: () => {},
    };
    const event = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
    const chrome = {
        runtime: { connectNative: () => port, onMessage: event('message'), lastError: null },
        tabs: { onRemoved: event('removed'), onUpdated: event('updated') },
        action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
        cookies: { getAll: async () => [] },
        scripting: { executeScript: async (opts) => { executed.push(opts); return []; } },
    };
    const src = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
    vm.runInNewContext(src, { chrome, console: { log() {}, warn() {}, error() {} }, setTimeout });
    const send = (msg) => new Promise((resolve) => listeners.message(msg, {}, resolve));
    const fromNative = (msg) => nativeListeners.forEach((fn) => fn(msg));
    return { send, fromNative, executed, posted };
}

test('closing the PiP seeks the source tab to the PiP position', async () => {
    const bg = loadBackground();
    const res = await bg.send({
        type: 'FLOAT_VIDEO_REQUEST',
        tabId: 42,
        videoInfo: { pageUrl: 'https://www.youtube.com/watch?v=x', site: 'youtube', currentTime: 300 },
    });
    assert.equal(res.success, true);

    bg.fromNative({ type: 'status', status: 'closed', currentTime: 612.5 });
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(bg.executed.length, 1);
    assert.equal(bg.executed[0].target.tabId, 42);
    assert.equal(bg.executed[0].world, 'MAIN');
    assert.equal(bg.executed[0].args[0], 612.5);
});

test('a close without a position does not touch the tab', async () => {
    const bg = loadBackground();
    await bg.send({ type: 'FLOAT_VIDEO_REQUEST', tabId: 42, videoInfo: { pageUrl: 'https://a/b', site: 'generic' } });
    bg.fromNative({ type: 'status', status: 'closed' });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(bg.executed.length, 0);
});

const YT = { pageUrl: 'https://www.youtube.com/watch?v=x', site: 'youtube', currentTime: 300 };

test('the popup can see which video is floating', async () => {
    const bg = loadBackground();
    assert.equal((await bg.send({ type: 'GET_FLOAT_STATE' })).floating, null);
    await bg.send({ type: 'FLOAT_VIDEO_REQUEST', tabId: 7, videoInfo: YT });
    const { floating } = await bg.send({ type: 'GET_FLOAT_STATE' });
    assert.equal(floating.tabId, 7);
    assert.equal(floating.pageUrl, YT.pageUrl);
});

test('closing the PiP clears the floating state', async () => {
    const bg = loadBackground();
    await bg.send({ type: 'FLOAT_VIDEO_REQUEST', tabId: 7, videoInfo: YT });
    bg.fromNative({ type: 'status', status: 'closed', currentTime: 310 });
    assert.equal((await bg.send({ type: 'GET_FLOAT_STATE' })).floating, null);
});

test('stop floating closes the PiP', async () => {
    const bg = loadBackground();
    await bg.send({ type: 'FLOAT_VIDEO_REQUEST', tabId: 7, videoInfo: YT });
    await bg.send({ type: 'CLOSE_FLOAT' });
    assert.equal(bg.posted.at(-1).action, 'close');
});

test('move to corner is sent to the native app', async () => {
    const bg = loadBackground();
    await bg.send({ type: 'FLOAT_VIDEO_REQUEST', tabId: 7, videoInfo: YT });
    const res = await bg.send({ type: 'MOVE_FLOAT_TO_CORNER' });
    assert.equal(res.success, true);
    assert.equal(bg.posted.at(-1).action, 'moveToCorner');
});
