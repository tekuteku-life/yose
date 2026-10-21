/** Archived master references and validated, non-mutating migration plans. */
export function archivedMasterSources(config) {
	const result = [];
	for (const account of config.accounts || []) {
		if (account.is_archived) result.push({ kind: 'account', id: account.id, label: `口座: ${account.name}` });
	}
	for (const category of config.categories || []) {
		if (category.is_archived) result.push({ kind: 'category', id: category.id, label: `費目: ${category.name}` });
		for (const child of category.subcategories || []) {
			if (category.is_archived || child.is_archived) result.push({ kind: 'subcategory', parentId: category.id, id: child.id, label: `中項目: ${category.name} > ${child.name}` });
		}
	}
	return result;
}

function matches(record, source) {
	if (record.is_deleted) return false;
	if (source.kind === 'account') return record.account_id === source.id || record.to_account_id === source.id;
	return ['', 'actual_'].some(prefix => record[`${prefix}category_id`] === (source.kind === 'subcategory' ? source.parentId : source.id)
		&& (source.kind === 'category' || record[`${prefix}subcategory_id`] === source.id));
}

export function findArchivedReferences(records, config) {
	const sources = archivedMasterSources(config);
	return records.filter(record => sources.some(source => matches(record, source))).map(record => ({
		...record,
		archived_labels: sources.filter(source => matches(record, source)).map(source => source.label)
	}));
}

export function buildMasterMigration(records, config, source, target) {
	if (!archivedMasterSources(config).some(item => item.kind === source.kind && item.id === source.id && item.parentId === source.parentId)) throw new Error('移行元はアーカイブ済み設定を指定する必要がある');
	let destination;
	if (source.kind === 'account') {
		const origin = (config.accounts || []).find(item => item.id === source.id);
		destination = (config.accounts || []).find(item => item.id === target.id);
		if (!destination || destination.is_archived || destination.type !== origin.type || Boolean(destination.is_asset) !== Boolean(origin.is_asset)) throw new Error('移行先口座は有効かつ同じ種別・資産区分である必要がある');
	} else {
		const origin = (config.categories || []).find(item => item.id === (source.parentId || source.id));
		destination = (config.categories || []).find(item => item.id === target.id);
		if (!destination || destination.is_archived || (destination.type || 'expense') !== (origin.type || 'expense')) throw new Error('移行先費目は有効かつ同じ収支種別である必要がある');
		if (target.subcategoryId && !(destination.subcategories || []).some(item => item.id === target.subcategoryId && !item.is_archived)) throw new Error('移行先中項目は選択した有効費目の配下である必要がある');
	}
	return records.filter(record => matches(record, source)).map(record => {
		const changed = { ...record };
		if (source.kind === 'account') {
			for (const key of ['account_id', 'to_account_id']) if (changed[key] === source.id) changed[key] = target.id;
			if (changed.type === 'transfer' && changed.account_id === changed.to_account_id) throw new Error('振替元と振替先が同一になるため移行できない');
		} else {
			for (const prefix of ['', 'actual_']) {
				if (changed[`${prefix}category_id`] !== (source.parentId || source.id)) continue;
				if (source.kind === 'subcategory' && changed[`${prefix}subcategory_id`] !== source.id) continue;
				changed[`${prefix}category_id`] = target.id;
				changed[`${prefix}subcategory_id`] = target.subcategoryId || null;
			}
		}
		return changed;
	});
}
