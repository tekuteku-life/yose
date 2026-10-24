import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as budget from '../../js/logic/budget_engine.js';
const resolve = (...args) => { assert.equal(typeof budget.resolveAnnualTargets, 'function'); return budget.resolveAnnualTargets(...args); };
it('retains independent legacy targets and computes linked targets from each primary input', () => {
	assert.equal(resolve({ expense_budget: 5, savings_target_amount: 8, target_savings_rate: 9 }, 100).expense_budget, 5);
	for (const [goal_basis, values] of [['rate', { savings_target_rate: 20 }], ['savings', { savings_target_amount: 200 }], ['expense', { expense_budget: 800 }]]) {
		const r = resolve({ goal_basis, ...values }, 1000);
		assert.equal(r.expense_budget, 800); assert.equal(r.savings_target_amount, 200); assert.equal(r.savings_target_rate, 20);
	}
});
it('uses exact decimal rates at yen boundaries and preserves zero and negative derived goals', () => {
	assert.equal(resolve({ goal_basis: 'rate', savings_target_rate: 29 }, 100).savings_target_amount, 29);
	assert.equal(resolve({ goal_basis: 'rate', savings_target_rate: 0.29 }, 10000).savings_target_amount, 29);
	for (const r of [0, 100]) assert.equal(resolve({ goal_basis: 'rate', savings_target_rate: r }, 100).savings_target_amount, r);
	assert.equal(resolve({ goal_basis: 'savings', savings_target_amount: 200 }, 100).expense_budget, -100);
	const zero = resolve({ goal_basis: 'expense', expense_budget: 200 }, 0);
	assert.equal(zero.savings_target_amount, -200); assert.equal(zero.savings_target_rate, null);
});
it('rejects unsafe inputs without plausible invented targets', () => {
	for (const [c, income] of [[{ goal_basis: 'unknown' }, 10], [{ goal_basis: 'rate', savings_target_rate: 101 }, 100], [{ goal_basis: 'savings', savings_target_amount: -1 }, 100], [{}, Infinity], [{}, Number.MAX_SAFE_INTEGER + 1]]) assert.equal(resolve(c, income).valid, false);
});
it('shares derived targets with progress and trajectory, including deficits', () => {
	const config = { goal_basis: 'rate', savings_target_rate: 20, expense_budget: 1, savings_target_amount: 1 };
	const p = budget.calculateAnnualBudgetProgress({ budgetConfig: config, yearlySummary: { income: 1000, expense: 500, net: 500 } });
	assert.equal(p.expense_budget, 800); assert.equal(p.savings_target_amount, 200); assert.equal(p.expense_remaining, 300); assert.equal(p.savings_achievement_rate, 250);
	const targets = resolve({ goal_basis: 'expense', expense_budget: 200 }, 100);
	const t = budget.generateAnnualTrajectory({ expenseBudget: targets.expense_budget, savingsTarget: targets.savings_target_amount, linked: true });
	assert.equal(t[11].cumulative_savings_pace, -100);
	const deficit = budget.calculateAnnualBudgetProgress({ budgetConfig: { goal_basis: 'expense', expense_budget: 200 }, incomeActual: 100 });
	assert.equal(deficit.savings_target_amount, -100); assert.equal(deficit.savings_rate_achieved, false);
});
it('keeps unavailable targets and pace unavailable when annual income overflows', () => {
	const p = budget.calculateAnnualBudgetProgress({ budgetConfig: { goal_basis: 'rate', savings_target_rate: 20 }, incomeActual: Number.MAX_SAFE_INTEGER + 1, expenseActual: 10 });
	assert.equal(p.expense_budget, null); assert.equal(p.expense_remaining, null); assert.equal(p.pace_status, 'unavailable');
	const rows = budget.generateAnnualTrajectory({ monthlySummaries: { '2026-01': { income_total: 100 } }, targetsValid: false });
	assert.equal(rows[0].cumulative_savings, 100); assert.equal(rows[0].cumulative_budget_pace, null); assert.equal(rows[0].cumulative_savings_pace, null);
});
