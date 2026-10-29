import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChartViewport } from '../../js/ui/chart_viewport.js';

function target() {
	const handlers = new Map();
	return {
		disabled: true, clientHeight: 100,
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
		addEventListener(name, handler, options) { assert.equal(options.passive, false); (handlers.get(name) || handlers.set(name, new Set()).get(name)).add(handler); },
		removeEventListener(name, handler) { handlers.get(name).delete(handler); },
		dispatch(name, values = {}) { const event = { prevented: false, preventDefault() { this.prevented = true; }, ...values }; for (const handler of handlers.get(name) || []) handler(event); return event; },
		listeners: () => [...handlers.values()].reduce((count, set) => count + set.size, 0)
	};
}

function fixture({ reset = true, layoutChange = false } = {}) {
	const canvas = target(), button = reset ? target() : null;
	let active = true, offset = 0, updates = 0;
	const scale = { min: 0, max: 100, getValueForPixel(pixel) { return this.max - pixel * (this.max - this.min) / 100 + offset; } };
	const chart = {
		width: 100, height: 100, chartArea: { left: 10, right: 90, top: 10, bottom: 90 },
		scales: { y: scale }, options: { scales: { y: {} } },
		update(mode) { assert.equal(mode, 'none'); updates++; scale.min = this.options.scales.y.min ?? 0; scale.max = this.options.scales.y.max ?? 100; if (layoutChange) offset = 2; }
	};
	const viewport = new ChartViewport(chart, canvas, button, () => active);
	return { canvas, button, chart, viewport, activate: value => { active = value; }, updates: () => updates };
}

describe('Money viewport event and lifecycle boundaries', () => {
	it('leaves normal scrolling, a zero wheel delta and outside plotting bounds untouched', () => {
		const f = fixture();
		for (const values of [{ ctrlKey: false, deltaY: -100 }, { ctrlKey: true, deltaY: 0 }, { ctrlKey: true, deltaY: -100, clientX: 1, clientY: 50 }]) {
			const event = f.canvas.dispatch('wheel', { clientX: 50, clientY: 50, deltaMode: 0, ...values }); assert.equal(event.prevented, false);
		}
		assert.equal(f.updates(), 0); assert.deepEqual(f.chart.options.scales.y, {});
		const event = f.canvas.dispatch('wheel', { ctrlKey: true, deltaY: -1, deltaMode: 1, clientX: 50, clientY: 50 });
		assert.equal(event.prevented, true); assert.ok(f.chart.scales.y.max - f.chart.scales.y.min < 100);
	});
	it('maps CSS coordinates and rejects hidden, inactive and not-yet-laid-out surfaces', () => {
		const f = fixture();
		f.canvas.getBoundingClientRect = () => ({ left: 20, top: 40, width: 200, height: 200 });
		assert.deepEqual(f.viewport.point(120, 140), { x: 50, y: 50 });
		for (const [x, y] of [[0, 140], [240, 140], [120, 0], [120, 240]]) assert.equal(f.viewport.point(x, y), null);
		for (const [width, height] of [[0, 100], [100, 0]]) { f.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height }); assert.equal(f.viewport.point(50, 50), null); }
		f.activate(false); assert.equal(f.viewport.point(50, 50), null); assert.equal(f.viewport.zoom(50, 0.5), false); f.viewport.reset(); assert.equal(f.updates(), 0);
		f.activate(true); f.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
		f.chart.chartArea = null; assert.equal(f.viewport.point(50, 50), null);
		f.chart.chartArea = { left: 0, right: 100, top: 0, bottom: 100 }; f.chart.scales = {};
		assert.equal(f.viewport.point(50, 50), null); assert.equal(f.viewport.zoom(50, 0.5), false);
	});
	it('requires two distinct fingers inside the plot and cancels a pinch on end or cancel', () => {
		const f = fixture(), touch = (x, y) => ({ clientX: x, clientY: y });
		assert.equal(f.canvas.dispatch('touchmove', { touches: [touch(20, 20), touch(80, 80)] }).prevented, false);
		for (const touches of [[touch(50, 50)], [touch(50, 50), touch(50, 50)], [touch(0, 0), touch(2, 2)]]) assert.equal(f.canvas.dispatch('touchstart', { touches }).prevented, false);
		assert.equal(f.canvas.dispatch('touchstart', { touches: [touch(40, 40), touch(60, 60)] }).prevented, true);
		assert.equal(f.canvas.dispatch('touchmove', { touches: [touch(30, 30)] }).prevented, false);
		assert.equal(f.canvas.dispatch('touchmove', { touches: [touch(50, 50), touch(50, 50)] }).prevented, false);
		assert.equal(f.canvas.dispatch('touchmove', { touches: [touch(30, 30), touch(70, 70)] }).prevented, true);
		assert.equal(f.chart.scales.y.max - f.chart.scales.y.min, 50);
		for (const name of ['touchend', 'touchcancel']) { f.canvas.dispatch(name); assert.equal(f.viewport.pinch, null); }
	});
	it('preserves the pointer value when tick layout changes after applying the zoom', () => {
		const f = fixture({ layoutChange: true }); const anchor = f.chart.scales.y.getValueForPixel(50);
		assert.equal(f.viewport.zoom(50, 0.5), true);
		assert.equal(f.chart.scales.y.getValueForPixel(50), anchor); assert.equal(f.chart.scales.y.max - f.chart.scales.y.min, 50);
		assert.equal(f.updates(), 3);
	});
	it('rejects invalid zoom requests without creating an axis override, resets and disposes listeners', () => {
		const f = fixture();
		for (const factor of [null, undefined, 0, -1]) assert.equal(f.viewport.zoom(50, factor), false);
		assert.deepEqual(f.chart.options.scales.y, {});
		f.viewport.zoom(50, 0.5); f.button.dispatch('click');
		assert.deepEqual(f.chart.options.scales.y, {}); assert.equal(f.viewport.initialSpan, null);
		const updates = f.updates(); f.viewport.destroy();
		assert.equal(f.canvas.listeners(), 0); assert.equal(f.button.listeners(), 0); assert.equal(f.button.disabled, true);
		assert.equal(f.viewport.point(50, 50), null); assert.equal(f.viewport.zoom(50, 0.5), false); f.viewport.reset(); assert.equal(f.updates(), updates);
	});
	it('supports an embedded money chart without a reset button', () => {
		const f = fixture({ reset: false }); assert.equal(f.viewport.zoom(50, 0.5), true); f.viewport.destroy(); assert.equal(f.canvas.listeners(), 0);
	});
});
