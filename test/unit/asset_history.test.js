import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../../js/logic/aggregator.js';
import { transaction } from '../helpers/ui_fixture.js';

describe('Asset history periods', () => {
	const snapshot = { last_closed_month: '2026-09', account_balances: { cash: 1000 }, monthly_summaries: { '2026-09': { closing_balances: { cash: 1000 } } } };
	const accounts = [{ id: 'cash', type: 'cash', is_asset: true, initial_balance: 1000 }, { id: 'bank', type: 'bank', is_asset: true, initial_balance: 0 }];
	const txs = [
		transaction('expense', { date: '2026-10-05', account_id: 'cash', amount: 100 }),
		transaction('income', { date: '2026-10-15', account_id: 'cash', type: 'income', amount: 200 }),
		transaction('future', { date: '2026-10-25', account_id: 'cash', amount: 900 }),
		transaction('planned', { date: '2026-10-10', account_id: 'cash', amount: 800, status: 'planned' }),
		transaction('transfer', { date: '2026-10-16', type: 'transfer', account_id: 'cash', to_account_id: 'bank', amount: 50 })
	];
	for (const mode of ['month', 'year', 'range', 'all']) {
		it(`computes ${mode} without future/planned records or transfer double counting`, () => {
			const result = logic.buildAssetHistory(snapshot, txs, accounts, { mode, month: '2026-10', year: '2026', start: '2026-10-10', end: '2026-10-20', today: '2026-10-20' });
			assert.equal(result.points.at(-1).net_assets, 1100);
			assert.ok(result.points.every(point => point.date <= '2026-10-20'));
			if (mode === 'month') assert.equal(result.points.find(point => point.date === '2026-10-10').net_assets, 900);
			if (mode === 'range') assert.equal(result.points[0].net_assets, 900);
		});
	}
	it('rejects inverted ranges instead of making up balances', () => {
		assert.throws(() => logic.buildAssetHistory(snapshot, txs, accounts, { mode: 'range', start: '2026-10-20', end: '2026-10-01', today: '2026-10-20' }), /期間/);
	});
	it('uses closed month balances and reports unavailable daily history', () => {
		const result = logic.buildAssetHistory(snapshot, [], accounts, { mode: 'month', month: '2026-09', today: '2026-10-20' });
		assert.deepEqual(result.points.map(point => [point.date, point.net_assets]), [['2026-09-30', 1000]]);
		assert.ok(result.notice);
	});
	it('carries closed balances across missing months and includes investment and debt', () => {
		const config = [...accounts, { id: 'stock', type: 'investment', is_asset: true }, { id: 'card', type: 'credit_card', is_asset: false }];
		const history = { last_closed_month: '2026-09', account_balances: { cash: 1000, stock: 500, card: -200 }, monthly_summaries: { '2026-07': { closing_balances: { cash: 900, stock: 500, card: -100 } }, '2026-09': { closing_balances: { cash: 1000, stock: 500, card: -200 } } } };
		const result = logic.buildAssetHistory(history, [], config, { mode: 'all', today: '2026-10-20' });
		assert.equal(result.points.find(point => point.date === '2026-07-31').net_assets, 1300);
		assert.equal(result.points.at(-1).net_assets, 1300);
		assert.equal(result.points.at(-1).investment_assets, 500);
		assert.equal(result.points.at(-1).liabilities, 200);
	});
});
