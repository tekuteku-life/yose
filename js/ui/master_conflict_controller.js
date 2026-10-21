/**
 * Compare conflicting master values and collect explicit choices without writing data.
 * @typedef {{ id: string, path: string, label: string, localValue: any, remoteValue: any, hasLocal: boolean, hasRemote: boolean, localDisplayName?: string, remoteDisplayName?: string }} MasterConflictDetail
 * @typedef {Record<string, 'local'|'remote'>} MasterConflictChoices
 */
export class MasterConflictController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		/** @type {{details: MasterConflictDetail[], validateChoices: ((choices: MasterConflictChoices) => any)|null, settle: (result: MasterConflictChoices|false) => void, validating: boolean}|null} */
		this.pending = null;
	}

	setup() {
		const modal = document.getElementById('modal-master-conflict');
		for (const id of ['btn-cancel-master-conflict', 'btn-close-master-conflict']) {
			document.getElementById(id).addEventListener('click', () => this.cancel());
		}
		for (const side of ['local', 'remote']) {
			document.getElementById(`btn-master-conflict-all-${side}`).addEventListener('click', () => {
				if (!this.pending || this.pending.validating) return;
				for (const select of this.selects()) select.value = side;
				this.selectionChanged();
			});
		}
		document.getElementById('btn-apply-master-conflict').addEventListener('click', () => this.apply());
		const observer = new MutationObserver(() => {
			if (!modal.classList.contains('active') && this.pending) this.cancel();
		});
		observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
	}

	/** @param {MasterConflictDetail[]} details @param {((choices: MasterConflictChoices) => any)|null} validateChoices @returns {Promise<MasterConflictChoices|false>} */
	resolve(details, validateChoices = null) {
		this.cancel();
		if (!details.length) return Promise.resolve(false);
		return new Promise(settle => {
			this.pending = { details: structuredClone(details), validateChoices, settle, validating: false };
			this.render();
			document.getElementById('modal-master-conflict').classList.add('active');
		});
	}

	selects() {
		return /** @type {NodeListOf<HTMLSelectElement>} */ (document.querySelectorAll('#master-conflict-list select'));
	}

	selectionChanged() {
		document.getElementById('master-conflict-error').textContent = '';
		const pending = this.pending;
		document.getElementById('btn-apply-master-conflict').disabled = !pending || pending.validating || Array.from(this.selects()).some(select => !['local', 'remote'].includes(select.value));
	}

	cancel() { this.finish(false); }

	/** @param {MasterConflictChoices|false} result */
	finish(result) {
		const pending = this.pending;
		this.pending = null;
		document.getElementById('modal-master-conflict').classList.remove('active');
		pending?.settle(result);
	}

	async apply() {
		const pending = this.pending;
		if (!pending || pending.validating) return;
		/** @type {MasterConflictChoices} */
		const choices = Object.create(null);
		const selects = Array.from(this.selects());
		if (selects.length !== pending.details.length || selects.some(select => !['local', 'remote'].includes(select.value))) return;
		for (let index = 0; index < selects.length; index++) choices[pending.details[index].id] = /** @type {'local'|'remote'} */ (selects[index].value);
		pending.validating = true;
		this.setValidating(true);
		try {
			await pending.validateChoices?.(choices);
			if (this.pending === pending) this.finish(choices);
		} catch (error) {
			if (this.pending === pending) document.getElementById('master-conflict-error').textContent = error.message || String(error);
		} finally {
			if (this.pending === pending) {
				pending.validating = false;
				this.setValidating(false);
			}
		}
	}

	setValidating(validating) {
		for (const select of this.selects()) select.disabled = validating;
		for (const side of ['local', 'remote']) document.getElementById(`btn-master-conflict-all-${side}`).disabled = validating;
		document.getElementById('btn-apply-master-conflict').disabled = validating || Array.from(this.selects()).some(select => !select.value);
		document.getElementById('master-conflict-list').setAttribute('aria-busy', String(validating));
	}

	valueElement(value, exists, displayName = null) {
		const element = document.createElement('div');
		element.className = 'master-conflict-value';
		if (!exists) element.textContent = '削除（項目なし）';
		else if (value === null) element.textContent = 'null';
		else if (value === '') element.textContent = '空文字（長さ0の文字列）';
		else if (value === undefined) element.textContent = '未定義（undefined）';
		else if (typeof value === 'string' && displayName) element.textContent = `${displayName}（ID: ${value}）`;
		else if (typeof value === 'object') {
			const details = document.createElement('details');
			const summary = document.createElement('summary');
			summary.textContent = Array.isArray(value) ? `配列（${value.length}件）: 詳細を表示` : `オブジェクト（${Object.keys(value).length}項目）: 詳細を表示`;
			const pre = document.createElement('pre');
			pre.textContent = JSON.stringify(value, null, 2);
			details.append(summary, pre); element.append(details);
		} else element.textContent = typeof value === 'string' ? `文字列: ${value}` : `${typeof value === 'boolean' ? '真偽値' : '数値'}: ${String(value)}`;
		return element;
	}

	render() {
		const list = document.getElementById('master-conflict-list');
		list.replaceChildren();
		this.pending.details.forEach((detail, index) => {
			const row = document.createElement('section');
			row.className = 'master-conflict-row'; row.dataset.conflictId = detail.id;
			const title = document.createElement('h4'); title.textContent = detail.label;
			const comparison = document.createElement('div'); comparison.className = 'master-conflict-comparison';
			for (const side of ['local', 'remote']) {
				const column = document.createElement('div');
				const heading = document.createElement('h5'); heading.textContent = side === 'local' ? '手元の値' : 'サーバーの値';
				column.append(heading, this.valueElement(side === 'local' ? detail.localValue : detail.remoteValue, side === 'local' ? detail.hasLocal : detail.hasRemote, side === 'local' ? detail.localDisplayName : detail.remoteDisplayName));
				comparison.append(column);
			}
			const label = document.createElement('label');
			label.htmlFor = `master-conflict-choice-${index}`; label.textContent = '採用する設定'; label.className = 'form-label';
			const select = document.createElement('select'); select.id = label.htmlFor; select.className = 'form-control';
			select.setAttribute('aria-label', `${detail.label}の採用する設定`);
			for (const [value, text] of [['', '選択する'], ['local', '手元を採用する'], ['remote', 'サーバーを採用する']]) {
				const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
			}
			select.addEventListener('change', () => this.selectionChanged());
			row.append(title, comparison, label, select); list.append(row);
		});
		document.getElementById('master-conflict-error').textContent = '';
		this.setValidating(false);
	}
}
