/** Plot density and finite money-axis geometry, independent of Chart.js and the DOM. */
export function markerRadii(values, radius = 3) {
	const last = values.length - 1, stride = Math.max(1, Math.ceil(last / 39));
	return values.map((value, index) => value == null || radius === 0 ? 0 : (index === last || index % stride === 0 ? radius : 0));
}

export function zoomMoneyRange(range, anchor, factor, initialSpan) {
	if (![range.min, range.max, anchor, factor, initialSpan].every(Number.isFinite) || factor <= 0 || range.max < range.min) return null;
	const base = Math.max(1, initialSpan), oldSpan = Math.max(1, range.max - range.min);
	const span = Math.min(base * 64, Math.max(Math.max(1, base / 1000), oldSpan * factor));
	const fraction = (anchor - range.min) / oldSpan;
	const min = anchor - fraction * span, max = min + span;
	return [min, max].every(Number.isFinite) && max > min ? { min, max } : null;
}

export function wheelZoomFactor(delta, mode = 0, height = 300) {
	if (!Number.isFinite(delta) || !Number.isFinite(height) || height <= 0) return null;
	return Math.exp(Math.max(-2, Math.min(2, delta * (mode === 1 ? 16 : mode === 2 ? height : 1) * 0.002)));
}
