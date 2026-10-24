import { it } from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../../js/logic/chart_geometry.js').catch(() => ({}));
it('thins only markers, retaining endpoints, null gaps and every underlying value', () => {
	assert.equal(typeof api.markerRadii, 'function');
	for (const n of [0, 1, 40, 41, 365, 10000]) {
		const values = Array.from({ length: n }, (_, i) => i), before = values.slice();
		const mask = api.markerRadii(values);
		assert.equal(mask.length, n); assert.ok(mask.filter(Boolean).length <= 40);
		if (n) { assert.equal(mask[0], 3); assert.equal(mask[n - 1], 3); }
		if (n <= 40) assert.ok(mask.every(r => r === 3));
		assert.deepEqual(values, before);
	}
	assert.deepEqual(api.markerRadii([null, 1, null]), [0, 3, 0]);
	assert.deepEqual(api.markerRadii([1, 2], 0), [0, 0]);
});
it('zooms signed money ranges about the pointer and bounds the span without moving x/data', () => {
	assert.equal(typeof api.zoomMoneyRange, 'function');
	assert.deepEqual(api.zoomMoneyRange({ min: -100, max: 900 }, 100, 0.5, 1000), { min: 0, max: 500 });
	assert.deepEqual(api.zoomMoneyRange({ min: 0, max: 1000 }, 0, 2, 1000), { min: 0, max: 2000 });
	for (const factor of [0.000001, 1000000]) {
		const r = api.zoomMoneyRange({ min: 0, max: 1000 }, 0, factor, 1000);
		assert.ok(r.max - r.min >= 1 && r.max - r.min <= 64000);
	}
	assert.ok(api.zoomMoneyRange({ min: 0, max: 0 }, 0, 0.5, 0).max > 0);
	for (const args of [[{ min: NaN, max: 1 }, 0, 1, 1], [{ min: 0, max: 1 }, Infinity, 1, 1], [{ min: 0, max: 1 }, 0, 0, 1]]) assert.equal(api.zoomMoneyRange(...args), null);
});
it('normalizes wheel modes and rejects unusable gestures', () => {
	assert.equal(typeof api.wheelZoomFactor, 'function');
	assert.ok(api.wheelZoomFactor(-120, 0, 300) < 1);
	assert.ok(api.wheelZoomFactor(120, 0, 300) > 1);
	assert.equal(api.wheelZoomFactor(1, 1, 300), api.wheelZoomFactor(16, 0, 300));
	assert.equal(api.wheelZoomFactor(1, 2, 300), api.wheelZoomFactor(300, 0, 300));
	assert.equal(api.wheelZoomFactor(NaN), null);
});
it('rejects inverted, unrepresentable or zero-size gesture ranges', () => {
	assert.equal(api.zoomMoneyRange({min:10,max:0},0,1,10),null);
	assert.equal(api.zoomMoneyRange({min:Number.MAX_VALUE/2,max:Number.MAX_VALUE},Number.MAX_VALUE,100,Number.MAX_VALUE),null);
	assert.equal(api.wheelZoomFactor(1,0,0),null);assert.deepEqual(api.markerRadii([0,1],5),[5,5]);
});
