// Ambient declarations for Yose browser and Service Worker environment

interface Window {
	__yose_app?: any;
	Chart?: any;
	skipWaiting?: () => Promise<void>;
	clients?: any;
}

interface HTMLElement {
	value?: string | number | any;
	checked?: boolean;
	disabled?: boolean;
	placeholder?: string;
	showPicker?: () => void;
	select?: () => void;
}

interface Element {
	dataset?: DOMStringMap;
	value?: string | number | any;
	checked?: boolean;
	style?: CSSStyleDeclaration;
	classList?: DOMTokenList;
}

interface EventTarget {
	value?: string | number | any;
	dataset?: DOMStringMap;
	checked?: boolean;
	files?: FileList | null;
	classList?: DOMTokenList;
	closest?: (selectors: string) => (HTMLElement & Element) | null;
}

interface Credential {
	rawId?: ArrayBuffer;
	getClientExtensionResults?: () => any;
}

interface MessageEvent {
	waitUntil?: (p: Promise<any>) => void;
}
