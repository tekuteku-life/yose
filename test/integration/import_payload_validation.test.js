import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { transaction } from '../helpers/ui_fixture.js';
const raw = db => Promise.all(['transactions', 'master_config', 'summary_snapshot'].map(store => db.getAllRaw(store)));

describe('Import payload validation before lossy OR merging', () => {
	for (const key of ['__proto__', 'constructor', 'prototype']) {
		for (const location of ['root', 'master metadata', 'budget', 'transaction metadata']) {
			it(`rejects unsafe ${key} in ${location} without applying an earlier valid row`, async () => {
				const db = new YoseDB(); await db.init();
				const unsafe = JSON.parse(`{"${key}":{"polluted":true}}`);
				const data = { schema_version: 2, transactions: [transaction('valid-first')] };
				if (location === 'root') Object.defineProperty(data, key, { value: unsafe, enumerable: true });
				if (location === 'master metadata') data.master_config = { collapsed_panes: unsafe };
				if (location === 'budget') data.annual_budgets = { 2026: { category_budgets: unsafe } };
				if (location === 'transaction metadata') data.transactions.push(transaction('unsafe', { tax_meta: unsafe }));
				const before = await raw(db);
				await assert.rejects(db.importFullData(data), /不正|unsafe|Invalid|整合/i);
				assert.deepEqual(await raw(db), before);
				assert.equal(Object.prototype.polluted, undefined);
			});
		}
	}
	for (const collection of ['accounts', 'categories', 'recurring_rules', 'subcategories', 'transactions']) {
		for (const defect of ['unsafe ID', 'duplicate ID']) {
			it(`rejects ${defect} in ${collection} before OR merge can discard it`, async () => {
				const db = new YoseDB(); await db.init();
				const config = await db.getMasterConfig();
				const lists = { accounts: [config.accounts[0]], categories: [config.categories[0]], recurring_rules: [config.recurring_rules[0]], subcategories: [config.categories[0].subcategories[0]], transactions: [transaction('valid-first')] };
				const first = structuredClone(lists[collection][0]);
				const records = defect === 'unsafe ID' ? [{ ...first, id: '__proto__' }] : [first, structuredClone(first)];
				const data = { schema_version: 2, transactions: [transaction('earlier-valid')] };
				if (collection === 'transactions') data.transactions = records;
				else if (collection === 'subcategories') data.master_config = { categories: [{ ...config.categories[0], subcategories: records }] };
				else data.master_config = { [collection]: records };
				const before = await raw(db);
				await assert.rejects(db.importFullData(data), /ID|重複|unsafe|Invalid|不正/i);
				assert.deepEqual(await raw(db), before);
			});
		}
	}
});
