const owners = new WeakMap();

/** Preserve each control's original state and let only the active owner restore it. */
export function beginFormBusy(root, button, label, extraControls = []) {
	const owner = {};
	const controls = new Set([...root.querySelectorAll('input, select, textarea, button'), ...extraControls]);
	if (root.matches('button, input, select, textarea')) controls.add(root);
	const states = [...controls].map(control => [control, control.disabled]);
	const previousBusy = root.getAttribute('aria-busy');
	const children = [...button.childNodes], previousLabel = button.getAttribute('aria-label');
	const spinner = document.createElement('span');
	spinner.className = 'spinner'; spinner.setAttribute('aria-hidden', 'true');
	const progress = document.createElement('span');
	progress.className = 'sr-only'; progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite'); progress.textContent = label;
	owners.set(root, owner);
	for (const [control] of states) control.disabled = true;
	root.setAttribute('aria-busy', 'true');
	button.setAttribute('aria-label', label); button.replaceChildren(spinner, document.createTextNode(label));
	root.append(progress);
	return () => {
		if (owners.get(root) !== owner) return;
		owners.delete(root);
		for (const [control, disabled] of states) if (control.isConnected) control.disabled = disabled;
		if (previousBusy === null) root.removeAttribute('aria-busy'); else root.setAttribute('aria-busy', previousBusy);
		if (previousLabel === null) button.removeAttribute('aria-label'); else button.setAttribute('aria-label', previousLabel);
		button.replaceChildren(...children); progress.remove();
	};
}

/** Capture a submission before asynchronous reads or disabled-state changes. */
export function captureFormValues(root) {
	const controls = [...root.querySelectorAll('input, select, textarea')];
	return {
		values: Object.fromEntries(controls.filter(control => control.id).map(control => [control.id, control.value])),
		checked: Object.fromEntries(controls.filter(control => control.type === 'checkbox').map(control => [control.id, control.checked]))
	};
}
