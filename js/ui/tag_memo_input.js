/** Shared chip editing and suggestion selection for transaction forms. */
import { escapeHtml } from '../logic.js';

export class TagMemoInput {
	constructor({ host, source, ids, onMemoChange = null }) {
		this.host = host;
		this.source = source;
		this.ids = ids;
		this.onMemoChange = onMemoChange;
	}

	get(id) { return document.getElementById(this.ids[id]); }

	setup() {
		const input = this.get('text');
		input?.addEventListener('focus', () => this.renderTagSuggestions(input.value));
		input?.addEventListener('input', () => this.renderTagSuggestions(input.value));
		input?.addEventListener('keydown', e => {
			if (e.isComposing || e.keyCode === 229) return;
			if (e.key === 'Enter' || e.key === ',') {
				e.preventDefault();
				this.commitPending();
				this.renderTagSuggestions('');
			} else if (e.key === 'Backspace' && !input.value) {
				this.host.confirmedTags.pop(); this.renderTagChips();
			} else if (e.key === 'Escape') {
				this.hide('tags');
			}
		});
		input?.addEventListener('blur', event => {
			if (event.relatedTarget instanceof Node && this.get('tags')?.contains(event.relatedTarget)) return;
			this.commitPending();
		});
		this.get('tags')?.addEventListener('focusout', event => {
			if (event.relatedTarget === input || (event.relatedTarget instanceof Node && this.get('tags').contains(event.relatedTarget))) return;
			this.commitPending();
		});
		this.get('chips')?.addEventListener('click', e => {
			const button = e.target.closest('.tag-chip-del');
			if (button) {
				this.host.confirmedTags.splice(Number(button.dataset.tagIndex), 1);
				this.renderTagChips();
			}
		});
		this.get('hidden')?.addEventListener('change', () => {
			this.host.confirmedTags = Array.from(new Set(this.get('hidden').value.split(',').map(s => s.trim()).filter(Boolean)));
			this.renderTagChips();
		});
		const memo = this.get('memo');
		memo?.addEventListener('focus', () => this.renderMemoSuggestions(memo.value));
		memo?.addEventListener('input', () => {
			this.renderMemoSuggestions(memo.value);
			this.onMemoChange?.(memo.value);
		});
		memo?.addEventListener('change', () => this.onMemoChange?.(memo.value));
		memo?.addEventListener('keydown', e => { if (e.key === 'Escape') this.hide('memos'); });
		document.addEventListener('click', e => {
			if (!(e.target instanceof Node)) return;
			if (!this.get('box')?.contains(e.target)) this.hide('tags');
			if (e.target !== memo && !this.get('memos')?.contains(e.target)) this.hide('memos');
		});
		for (const key of ['tags', 'memos']) {
			// Keep focus on the text field until selection, preventing blur from committing a partial tag.
			this.get(key)?.addEventListener('pointerdown', e => {
				if (e.target.closest('.suggest-item')) e.preventDefault();
			});
		}
	}

	hide(key) { const element = this.get(key); if (element) element.style.display = 'none'; }

	commitPending() {
		const input = this.get('text');
		if (input?.value.trim()) this.addTag(input.value);
		if (input) input.value = '';
	}

	addTag(value) {
		for (const tag of String(value || '').split(',').map(s => s.trim()).filter(Boolean)) {
			if (!this.host.confirmedTags.includes(tag)) this.host.confirmedTags.push(tag);
		}
		this.renderTagChips();
	}

	renderTagChips() {
		const hidden = this.get('hidden');
		if (hidden) hidden.value = this.host.confirmedTags.join(', ');
		const chips = this.get('chips');
		if (chips) chips.innerHTML = this.host.confirmedTags.map((tag, index) => `<span class="tag-chip">${escapeHtml(tag)}<button type="button" class="tag-chip-del" data-tag-index="${index}" aria-label="タグ削除">&times;</button></span>`).join('');
	}

	renderSuggestions(key, values, onSelect) {
		const dropdown = this.get(key);
		if (!dropdown) return;
		dropdown.innerHTML = values.slice(0, 15).map(value => `<button type="button" class="suggest-item" data-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join('');
		dropdown.style.display = values.length ? 'block' : 'none';
		dropdown.querySelectorAll('.suggest-item').forEach(item => {
			item.addEventListener('click', e => {
				e.stopPropagation();
				onSelect(item.dataset.value);
				this.hide(key);
			});
		});
	}

	renderTagSuggestions(query = '') {
		const q = query.trim().toLowerCase();
		const values = (this.source.availableTags || []).filter(tag => tag.toLowerCase().includes(q) && !this.host.confirmedTags.includes(tag));
		this.renderSuggestions('tags', values, value => {
			const input = this.get('text');
			if (input) input.value = '';
			this.addTag(value);
		});
	}

	renderMemoSuggestions(query = '') {
		const q = query.trim().toLowerCase();
		this.renderSuggestions('memos', Object.keys(this.source.memoHistoryMap || {}).filter(memo => memo.toLowerCase().includes(q)), value => {
			this.get('memo').value = value;
			this.onMemoChange?.(value);
		});
	}
}
