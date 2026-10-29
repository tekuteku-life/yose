import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ChartController } from '../../js/ui/chart_controller.js';

it('formats numeric, raw-value and empty doughnut tooltip contexts with concrete proportions', () => {
	const label = new ChartController({}).getDoughnutTooltipOptions().callbacks.label;
	assert.equal(label({label:'食費',parsed:25,dataset:{data:[25,75]}}), '食費: ¥25 (25%)');
	assert.equal(label({label:'食費',raw:'25',dataset:{data:[25,75]}}), '食費: ¥25 (25%)');
	assert.equal(label({raw:'invalid'}), '¥0 (0%)');
	assert.equal(label({label:'全額',parsed:50,dataset:{data:[50]}}), '全額: ¥50 (100%)');
});
