import { zoomMoneyRange, wheelZoomFactor } from '../logic/chart_geometry.js';

/** Owns and disposes only money-axis gestures for one live chart. */
export class ChartViewport {
	constructor(chart, canvas, resetButton, isActive) {
		this.chart = chart; this.canvas = canvas; this.resetButton = resetButton; this.isActive = isActive;
		this.initialSpan = null; this.pinch = null; this.listeners = [];
		this.listen(canvas, 'wheel', event => {
			if (!event.ctrlKey || event.deltaY === 0) return;
			const point = this.point(event.clientX, event.clientY);
			if (!point) return;
			if (this.zoom(point.y, wheelZoomFactor(event.deltaY, event.deltaMode, chart.height || canvas.clientHeight))) event.preventDefault();
		});
		this.listen(canvas, 'touchstart', event => {
			this.pinch = null;
			if (event.touches.length !== 2) return;
			const gesture = this.gesture(event.touches);
			if (gesture && this.point(gesture.x, gesture.y)) { this.pinch = gesture; event.preventDefault(); }
		});
		this.listen(canvas, 'touchmove', event => {
			if (!this.pinch || event.touches.length !== 2) return;
			const next = this.gesture(event.touches), point = next && this.point(next.x, next.y);
			if (point && this.zoom(point.y, this.pinch.distance / next.distance)) { this.pinch = next; event.preventDefault(); }
		});
		for (const name of ['touchend', 'touchcancel']) this.listen(canvas, name, () => { this.pinch = null; });
		this.listen(resetButton, 'click', () => this.reset());
		if (resetButton) resetButton.disabled = false;
	}

	listen(element, name, handler) {
		if (!element) return;
		element.addEventListener(name, handler, { passive: false });
		this.listeners.push(() => element.removeEventListener(name, handler));
	}

	point(x, y) {
		if (!this.chart || !this.isActive() || !this.chart.chartArea || !this.chart.scales?.y) return null;
		const rect = this.canvas.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;
		const px = (x - rect.left) * this.chart.width / rect.width, py = (y - rect.top) * this.chart.height / rect.height, area = this.chart.chartArea;
		return px >= area.left && px <= area.right && py >= area.top && py <= area.bottom ? { x: px, y: py } : null;
	}

	gesture(touches) {
		const a = touches[0], b = touches[1], distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
		return distance > 0 && Number.isFinite(distance) ? { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, distance } : null;
	}

	zoom(pixel, factor) {
		if (!this.chart || !this.isActive() || factor == null) return false;
		const scale = this.chart.scales?.y;
		if (!scale) return false;
		const initial = this.initialSpan ?? Math.max(1, scale.max - scale.min);
		const anchor = scale.getValueForPixel(pixel);
		const range = zoomMoneyRange({ min: scale.min, max: scale.max }, anchor, factor, initial);
		if (!range) return false;
		this.initialSpan = initial;
		Object.assign(this.chart.options.scales.y, range);
		// Tick label layout can change the plot height. Keep the same value under the physical pointer.
		for (let iteration = 0; iteration < 3; iteration++) {
			this.chart.update('none');
			const shift = anchor - this.chart.scales.y.getValueForPixel(pixel);
			if (!Number.isFinite(shift) || Math.abs(shift) < Math.max(1e-9, (range.max - range.min) * 1e-10)) break;
			this.chart.options.scales.y.min += shift; this.chart.options.scales.y.max += shift;
		}
		this.chart.update('none');
		return true;
	}

	reset() {
		if (!this.chart || !this.isActive()) return;
		delete this.chart.options.scales.y.min; delete this.chart.options.scales.y.max;
		this.initialSpan = null; this.pinch = null; this.chart.update('none');
	}

	destroy() {
		for (const remove of this.listeners) remove();
		this.listeners = []; this.pinch = null; this.chart = null;
		if (this.resetButton) this.resetButton.disabled = true;
	}
}
