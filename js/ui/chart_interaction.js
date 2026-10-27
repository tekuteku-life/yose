/** Select one observation on the touched line or bar, including between line markers. */
export function registerFocusedInteraction(Chart) {
	Chart.Interaction.modes.focused = (chart, event, options, useFinalPosition) => {
		if (event.native?.touches?.length > 1) return [];
		if (chart.config.type !== 'line') return Chart.Interaction.modes.nearest(chart, event, { ...options, intersect: true, axis: 'xy' }, useFinalPosition).slice(0, 1);
		const position = Chart.helpers.getRelativePosition(event, chart);
		let selected = null, bestDistance = Infinity;
		const ctx = chart.ctx;
		ctx.save(); ctx.resetTransform(); ctx.setLineDash([]); ctx.lineCap = 'round';
		try {
			for (const meta of chart.getSortedVisibleDatasetMetas()) {
				let nearest = null, previous = null, previousX = -Infinity, pointDistance = Infinity;
				meta.data.forEach((element, index) => {
					if (element.skip) return;
					const center = element.getCenterPoint(useFinalPosition);
					const distance = Math.hypot(position.x - center.x, position.y - center.y);
					if (distance < pointDistance) { pointDistance = distance; nearest = { element, datasetIndex: meta.index, index }; }
					if (center.x <= position.x + 1e-6 && center.x > previousX) { previousX = center.x; previous = { element, datasetIndex: meta.index, index }; }
				});
				if (!nearest) continue;
				let distance = nearest.element.inRange(position.x, position.y, useFinalPosition) ? pointDistance : Infinity;
				const line = meta.dataset;
				if (line?.options.borderWidth) {
					// Reuse Chart.js geometry so curves, steps and null gaps match the drawn line.
					const path = new Path2D(); line.path(path);
					const tolerance = 6 + line.options.borderWidth / 2;
					ctx.lineWidth = tolerance * 2;
					if (ctx.isPointInStroke(path, position.x, position.y)) {
						let low = 0, high = tolerance;
						for (let i = 0; i < 5; i++) {
							const middle = (low + high) / 2; ctx.lineWidth = middle * 2;
							if (ctx.isPointInStroke(path, position.x, position.y)) high = middle; else low = middle;
						}
						distance = Math.min(distance, high);
					}
				}
				if (distance < bestDistance) { bestDistance = distance; selected = line.options.stepped === 'before' && previous ? previous : nearest; }
			}
		} finally { ctx.restore(); }
		return selected ? [selected] : [];
	};
	return 'focused';
}

/** Chart.js retains active elements outside the plot unless explicitly cleared. */
export const focusedBoundary = {
	id: 'yose-focused-boundary',
	afterEvent(chart, args) {
		if (!chart.ctx || (args.inChartArea && !(args.event.native?.touches?.length > 1))) return;
		const hadActive = chart.getActiveElements().length || chart.tooltip.getActiveElements().length;
		chart.setActiveElements([]);
		chart.tooltip.setActiveElements([], args.event);
		if (hadActive) args.changed = true;
	}
};
