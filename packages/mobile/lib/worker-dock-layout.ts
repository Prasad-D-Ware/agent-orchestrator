const RESTING_GAP = 12;
const KEYBOARD_GAP = 8;

export function workerDockKeyboardLayout(keyboardHeight: number, safeAreaBottom: number) {
	return {
		rootPaddingBottom: 0,
		dockBottom: keyboardHeight > 0 ? keyboardHeight + KEYBOARD_GAP : safeAreaBottom + RESTING_GAP,
	};
}

export function keyboardOverlap(windowHeight: number, keyboardScreenY: number, keyboardHeight: number): number {
	if (keyboardScreenY >= windowHeight) return 0;
	return Math.min(keyboardHeight, Math.max(0, windowHeight - keyboardScreenY));
}

export function workerDockVisibility(searchOpen: boolean) {
	return searchOpen
		? { showControls: false, showSearch: true, showSpawn: false }
		: { showControls: true, showSearch: false, showSpawn: true };
}
