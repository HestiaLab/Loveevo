export function isCompact() {
    return window.matchMedia('(max-width: 900px)').matches;
}

export async function register(callback) {
    if (!('serviceWorker' in navigator)) return;
    try {
        const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
        registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                    callback.invokeMethodAsync('OnUpdateReady');
                }
            });
        });
    } catch {
        // Offline support is progressive; the app remains usable without it.
    }
}

export function applyUpdate() {
    navigator.serviceWorker?.getRegistration().then(registration => {
        registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
}
