const DB_NAME = 'loveevo';
const DB_VERSION = 1;
const META_KEY = 'app-data';
const LAYOUT_KEY = 'atlas-layout';
let databasePromise;

function openDatabase() {
    if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
                if (!database.objectStoreNames.contains('photos')) database.createObjectStore('photos', { keyPath: 'id' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库。'));
        });
    }
    return databasePromise;
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('本地数据库操作失败。'));
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('本地事务已中止。'));
        transaction.onerror = () => reject(transaction.error ?? new Error('本地事务失败。'));
    });
}

function notifyChanged() {
    try {
        const channel = new BroadcastChannel('loveevo');
        channel.postMessage({ type: 'data-changed', at: Date.now() });
        channel.close();
    } catch {
        // BroadcastChannel is optional; storage remains usable without it.
    }
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

async function blobToBase64(blob) {
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export async function loadData() {
    const database = await openDatabase();
    const transaction = database.transaction('meta', 'readonly');
    return await requestResult(transaction.objectStore('meta').get(META_KEY)) ?? null;
}

export async function commitData(data, photosToPut, photosToDelete, replaceAll, expectedRevision, layoutToSave) {
    const run = async () => {
        const database = await openDatabase();
        const readTransaction = database.transaction('meta', 'readonly');
        const current = await requestResult(readTransaction.objectStore('meta').get(META_KEY)) ?? null;
        if (expectedRevision !== null && expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) {
            return 'conflict';
        }
        const transaction = database.transaction(['meta', 'photos'], 'readwrite');
        const meta = transaction.objectStore('meta');
        const photos = transaction.objectStore('photos');
        if (replaceAll) {
            meta.clear();
            photos.clear();
        }
        data.revision = (current?.revision ?? 0) + 1;
        meta.put(data, META_KEY);
        if (layoutToSave !== null && layoutToSave !== undefined) meta.put(layoutToSave, LAYOUT_KEY);
        for (const item of photosToPut ?? []) {
            const bytes = base64ToBytes(item.data);
            photos.put({
                id: item.id,
                blob: new Blob([bytes], { type: item.contentType }),
                contentType: item.contentType,
                savedAt: new Date().toISOString()
            });
        }
        for (const id of photosToDelete ?? []) photos.delete(id);
        await transactionDone(transaction);
        notifyChanged();
        return 'ok';
    };
    return navigator.locks ? navigator.locks.request('loveevo-write', run) : run();
}

export async function getPhotoBytes(photoId) {
    const database = await openDatabase();
    const transaction = database.transaction('photos', 'readonly');
    const record = await requestResult(transaction.objectStore('photos').get(photoId));
    return record ? await blobToBase64(record.blob) : null;
}

export async function getPhotoDataUrl(photoId) {
    const database = await openDatabase();
    const transaction = database.transaction('photos', 'readonly');
    const record = await requestResult(transaction.objectStore('photos').get(photoId));
    if (!record) return null;
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error ?? new Error('无法读取照片。'));
        reader.readAsDataURL(record.blob);
    });
}

export async function getStorageUsage() {
    if (!navigator.storage?.estimate) return { usageBytes: 0, quotaBytes: 0 };
    const estimate = await navigator.storage.estimate();
    return { usageBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0 };
}

export async function getLayout() {
    const database = await openDatabase();
    const transaction = database.transaction('meta', 'readonly');
    return await requestResult(transaction.objectStore('meta').get(LAYOUT_KEY)) ?? null;
}

export async function saveLayout(xml) {
    const database = await openDatabase();
    const transaction = database.transaction('meta', 'readwrite');
    transaction.objectStore('meta').put(xml, LAYOUT_KEY);
    await transactionDone(transaction);
}

export async function clearAll() {
    const run = async () => {
        const database = await openDatabase();
        const transaction = database.transaction(['meta', 'photos'], 'readwrite');
        transaction.objectStore('meta').clear();
        transaction.objectStore('photos').clear();
        await transactionDone(transaction);
        notifyChanged();
    };
    return navigator.locks ? navigator.locks.request('loveevo-write', run) : run();
}

export async function compressImage(base64, contentType, maxDimension = 1600) {
    const blob = new Blob([base64ToBytes(base64)], { type: contentType });
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('浏览器无法处理图片。');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const compressed = await new Promise((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片压缩失败。')), 'image/webp', 0.86);
    });
    const bytes = new Uint8Array(await compressed.arrayBuffer());
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, '0')).join('');
    return {
        base64: bytesToBase64(bytes),
        contentType: 'image/webp',
        width,
        height,
        sizeBytes: bytes.byteLength,
        sha256
    };
}

export function downloadFile(base64, fileName, contentType) {
    const bytes = base64ToBytes(base64);
    const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function connect(callback) {
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('loveevo') : null;
    if (channel) channel.onmessage = event => callback.invokeMethodAsync('OnDataChanged', event.data);
    const onStorage = event => {
        if (event.key === DB_NAME || event.key === null) callback.invokeMethodAsync('OnDataChanged', { type: 'storage' });
    };
    window.addEventListener('storage', onStorage);
    return {
        dispose() {
            channel?.close();
            window.removeEventListener('storage', onStorage);
        }
    };
}

export function setTheme(theme) {
    const root = document.documentElement;
    root.dataset.theme = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
        if (root.dataset.themePreference === 'system') {
            root.dataset.theme = media.matches ? 'dark' : 'light';
        }
    };
    root.dataset.themePreference = theme;
    media.addEventListener('change', listener);
}

export function reloadForUpdate() {
    navigator.serviceWorker?.getRegistrations().then(registrations => {
        for (const registration of registrations) registration.update();
    });
    window.location.reload();
}

export function setBeforeUnload(enabled) {
    if (enabled) {
        window.onbeforeunload = event => {
            event.preventDefault();
            event.returnValue = '';
        };
    } else {
        window.onbeforeunload = null;
    }
}

export function enhanceAccessibility() {
    const update = () => {
        document.querySelectorAll('.atlas-v2-splitter[role="separator"]').forEach(element => {
            if (element.hasAttribute('aria-valuenow')) return;
            const text = element.getAttribute('aria-valuetext') ?? '';
            const match = text.match(/(\d+(?:\.\d+)?)\s*(?:pixels|%)/);
            element.setAttribute('aria-valuenow', match ? match[1] : '50');
        });
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-valuetext'] });
    update();
    return { dispose: () => observer.disconnect() };
}

export function drawBarChart(canvas, items, color = '#d97793') {
    const context = canvas.getContext('2d');
    if (!context || items.length === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(canvas);
    const textColor = styles.getPropertyValue('--chart-text').trim() || '#6d6270';
    const gridColor = styles.getPropertyValue('--chart-grid').trim() || 'rgba(120,100,115,.14)';
    const padding = { top: 14, right: 10, bottom: 28, left: 30 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const max = Math.max(1, ...items.map(item => item.value));
    context.strokeStyle = gridColor;
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + chartHeight * index / 4;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
    }
    const slot = chartWidth / items.length;
    const barWidth = Math.max(4, Math.min(28, slot * 0.58));
    context.font = '11px system-ui, sans-serif';
    context.fillStyle = textColor;
    context.textAlign = 'right';
    for (let index = 0; index <= 4; index += 1) {
        const value = Math.round(max * (4 - index) / 4);
        context.fillText(String(value), padding.left - 7, padding.top + chartHeight * index / 4 + 4);
    }
    items.forEach((item, index) => {
        const barHeight = chartHeight * item.value / max;
        const x = padding.left + slot * index + (slot - barWidth) / 2;
        const y = padding.top + chartHeight - barHeight;
        const gradient = context.createLinearGradient(0, y, 0, padding.top + chartHeight);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, `${color}88`);
        context.fillStyle = gradient;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, [5, 5, 2, 2]);
        context.fill();
        context.fillStyle = textColor;
        context.textAlign = 'center';
        context.fillText(item.label, x + barWidth / 2, height - 8);
    });
}

export function drawDonutChart(canvas, items) {
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const total = items.reduce((sum, item) => sum + item.value, 0);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 12;
    const inner = radius * 0.62;
    if (total === 0) {
        context.strokeStyle = 'rgba(130,110,125,.16)';
        context.lineWidth = radius - inner;
        context.beginPath();
        context.arc(centerX, centerY, (radius + inner) / 2, 0, Math.PI * 2);
        context.stroke();
        return;
    }
    let angle = -Math.PI / 2;
    for (const item of items) {
        const slice = Math.PI * 2 * item.value / total;
        context.beginPath();
        context.arc(centerX, centerY, radius, angle, angle + slice);
        context.arc(centerX, centerY, inner, angle + slice, angle, true);
        context.closePath();
        context.fillStyle = item.color;
        context.fill();
        angle += slice;
    }
    context.fillStyle = getComputedStyle(canvas).getPropertyValue('--chart-text').trim() || '#6d6270';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 22px system-ui, sans-serif';
    context.fillText(String(total), centerX, centerY - 6);
    context.font = '11px system-ui, sans-serif';
    context.fillText('条记录', centerX, centerY + 16);
}
