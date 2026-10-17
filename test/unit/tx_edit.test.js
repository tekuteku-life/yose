import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';

describe('Transaction Editing & Retroactive Sync - Unit Tests', () => {
	let db;

	beforeEach(async () => {
		db = new YoseDB(null);
		await db.init();
	});

	it('updates fields of an existing transaction in local DB', async () => {
		const initialTx = {
			id: 'tx_edit_sample',
			group_id: 'grp_sample',
			date: '2026-10-10',
			target_month: '2026-10',
			status: 'planned',
			type: 'expense',
			amount: 1500,
			account_id: 'acc_wallet',
			category_id: 'cat_food',
			subcategory_id: 'sub_groceries',
			memo: '初稿メモ',
			tags: ['初期'],
			is_deleted: false,
			sync_status: 'synced'
		};
		await db.putTransaction(initialTx);

		// Retrieve and edit
		const tx = await db.getTransaction('tx_edit_sample');
		tx.amount = 2200;
		tx.status = 'confirmed';
		tx.memo = '修正後メモ（領収書確認済）';
		tx.tags = ['初期', '修正済'];
		tx.sync_status = 'unsynced';
		await db.putTransaction(tx);

		const updated = await db.getTransaction('tx_edit_sample');
		assert.equal(updated.amount, 2200);
		assert.equal(updated.status, 'confirmed');
		assert.equal(updated.memo, '修正後メモ（領収書確認済）');
		assert.equal(updated.tags.length, 2);
		assert.equal(updated.sync_status, 'unsynced');
	});

	it('identifies whether an edited transaction belongs to a closed past month', async () => {
		const snapshot = {
			last_closed_month: '2026-09',
			account_balances: {}
		};

		const isPastClosedMonth = (tx, snap) => {
			if (!snap || !snap.last_closed_month) return false;
			return tx.target_month <= snap.last_closed_month;
		};

		const sepTx = { id: 'tx_sep', target_month: '2026-09' };
		const octTx = { id: 'tx_oct', target_month: '2026-10' };

		assert.equal(isPastClosedMonth(sepTx, snapshot), true);
		assert.equal(isPastClosedMonth(octTx, snapshot), false);
	});
});

