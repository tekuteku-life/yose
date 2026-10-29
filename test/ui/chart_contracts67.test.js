import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';

const f=useBrowser({realCharts:true});
it('handles omitted and null category inputs and excludes zero-valued chart slices',async()=>{
	const d=f.driver;
	const states=await d.evaluate(`(()=>{const c=window.__yose_app.chartController,canvas=document.querySelector('#category-breakdown-chart'),result=[];c.renderChartForCategoryBreakdown();result.push(canvas.style.display);c.renderChartForCategoryBreakdown(null);result.push(canvas.style.display);c.renderChartForCategoryBreakdown([{name:'ゼロ',amount:0}]);result.push(canvas.style.display);c.updateThemeMode(false);c.renderChartForCategoryBreakdown([{name:'食費',amount:30}]);return{states:result,labels:c.categoryBreakdownChart.data.labels,amounts:c.categoryBreakdownChart.data.datasets[0].data,color:c.categoryBreakdownChart.options.plugins.legend.labels.color};})()`);
	assert.deepEqual(states,{states:['none','none','none'],labels:['食費'],amounts:[30],color:'#334155'});
});
it('builds a time chart with default money scales and keeps only expense tags in a light theme',async()=>{
	const d=f.driver;
	const result=await d.evaluate(`(()=>{const c=window.__yose_app.chartController;c.updateThemeMode(false);c.drawTime('chart','summary','summary-chart','chart-fallback','既定軸','line',{labels:['2026-10-01'],datasets:[{seriesKey:'amount',label:'実績',data:[10]}]});const scale=Boolean(c.chart.scales.y),data=c.chart.data.datasets[0].data;c.renderChartForTags({tagList:[{tag:'収入のみ',income:20,expense:0,net:20}]});const hidden=document.querySelector('#tag-chart').style.display;c.renderChartForTags({tagList:[{tag:'食費',income:0,expense:30,net:-30}]});return{scale,data,hidden,tags:c.tagChart.data.labels,amounts:c.tagChart.data.datasets[0].data,color:c.tagChart.options.plugins.legend.labels.color};})()`);
	assert.deepEqual(result,{scale:true,data:[10],hidden:'none',tags:['食費'],amounts:[30],color:'#334155'});
	await d.evaluate('window.Chart=undefined;window.__yose_app.chartController.updateThemeMode(false)');
	assert.match(await d.textContent('#chart-fallback'),/既定軸/);
});
