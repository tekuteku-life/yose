import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as renderSession from '../../js/ui/render_session.js';

const context = () => ({ db: { encryptionKey: {}, keyGeneration: 1 }, authController: { authGeneration: 1 }, privateKey: {}, isKeyLocked: false });
const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const reader = () => { assert.equal(typeof renderSession.readInRenderSession, 'function', 'render reads must safely ignore only obsolete completions'); return renderSession.readInRenderSession; };

for (const change of ['key', 'key-generation', 'authentication', 'private-key', 'lock']) it(`expires a captured render session after changing only ${change}`, () => {
	const c = context(), valid = renderSession.captureRenderSession(c);
	assert.equal(valid(), true);
	if (change === 'key') c.db.encryptionKey = {};
	if (change === 'key-generation') c.db.keyGeneration++;
	if (change === 'authentication') c.authController.authGeneration++;
	if (change === 'private-key') c.privateKey = {};
	if (change === 'lock') c.isKeyLocked = true;
	assert.equal(valid(), false);
});

it('does not run an already expired native read', async () => {
	const read = reader(), c = context(); let called = 0;
	const valid = renderSession.captureRenderSession(c); c.db.keyGeneration++;
	assert.equal(await read(valid, () => { called++; throw new Error('must not read'); }), undefined);
	assert.equal(called, 0);
});

for (const reject of [false, true]) it(`discards an expired native ${reject ? 'rejection' : 'success'} after the actual read started`, async () => {
	const read = reader(), c = context(), entered = deferred(), release = deferred();
	const valid = renderSession.captureRenderSession(c);
	const pending = read(valid, async () => { entered.release(); await release.promise; if (reject) throw new Error('OBSOLETE_READ'); return { secret: 'old value' }; });
	try {
		await entered.promise; c.db.keyGeneration++;
		release.release(); assert.equal(await pending, undefined);
	} finally { release.release(); await pending; }
});

it('preserves the result and exact failure of a current read', async () => {
	const read = reader(), c = context(), valid = renderSession.captureRenderSession(c), value = { current: true }, failure = new Error('CURRENT_READ_FAILURE');
	assert.equal(await read(valid, async () => value), value);
	await assert.rejects(read(valid, async () => { throw failure; }), error => error === failure);
});

it('honors an expired parent callback even when key and generations remain current', async () => {
	const read = reader(), c = context(); let parent = true;
	const valid = renderSession.captureRenderSession(c, () => parent);
	parent = false;
	assert.equal(await read(valid, () => { throw new Error('parent expired'); }), undefined);
});

for (const reject of [false, true]) it(`cancels an old read ${reject ? 'failure' : 'success'} when only the signing key changes and accepts a newly captured session`, async () => {
	const read = reader(), c = context(), release = deferred(), valid = renderSession.captureRenderSession(c);
	const pending = read(valid, async () => { await release.promise; if (reject) throw new Error('OLD_SIGNING_KEY'); return 'old'; });
	c.privateKey = {};
	release.release();
	assert.equal(await pending, undefined);
	assert.equal(await read(renderSession.captureRenderSession(c), async () => 'new'), 'new');
});
