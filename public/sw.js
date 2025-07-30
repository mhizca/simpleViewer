/**
 * Service Worker for SimpleViewer - Advanced Offline Caching and Background Sync
 * 
 * Features:
 * - Cache-first strategy for images with intelligent fallbacks
 * - Background sync for preloading and cache warming
 * - CDN integration with fallback support
 * - Responsive image caching with size optimization
 * - Cache versioning and update management
 * - Performance monitoring and analytics
 */

const CACHE_VERSION = 'v1.2.0';
const CACHE_NAME = `simpleviewer-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;
const ASSET_CACHE = `assets-${CACHE_VERSION}`;
const CDN_CACHE = `cdn-${CACHE_VERSION}`;

// Cache configuration
const CACHE_CONFIG = {
    maxImageCacheSize: 100 * 1024 * 1024, // 100MB for images
    maxAssetCacheSize: 20 * 1024 * 1024,  // 20MB for assets
    maxCdnCacheSize: 150 * 1024 * 1024,   // 150MB for CDN responses
    imageExpirationTime: 7 * 24 * 60 * 60 * 1000, // 7 days
    assetExpirationTime: 24 * 60 * 60 * 1000,     // 1 day
    cdnExpirationTime: 3 * 24 * 60 * 60 * 1000,   // 3 days
    preloadBatchSize: 5,
    maxRetryAttempts: 3
};

// Performance metrics
const metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    networkRequests: 0,
    offlineRequests: 0,
    backgroundSyncs: 0,
    cacheCleanups: 0,
    errors: 0
};

// Background sync queues
const syncQueues = {
    preload: 'preload-images',
    cleanup: 'cache-cleanup',
    analytics: 'analytics-sync'
};

// Installation and activation
self.addEventListener('install', event => {
    console.log('[SW] Installing Service Worker version:', CACHE_VERSION);
    
    event.waitUntil(
        Promise.all([
            cacheStaticAssets(),
            self.skipWaiting() // Activate immediately
        ])
    );
});

self.addEventListener('activate', event => {
    console.log('[SW] Activating Service Worker version:', CACHE_VERSION);
    
    event.waitUntil(
        Promise.all([
            cleanupOldCaches(),
            self.clients.claim(), // Take control immediately
            initializeCache()
        ])
    );
});

/**
 * Cache static assets during installation
 */
async function cacheStaticAssets() {
    try {
        const cache = await caches.open(ASSET_CACHE);
        const staticAssets = [
            '/',
            '/index.html',
            '/styles.css',
            '/app.js',
            '/cdn-client.js',
            '/cdn-dashboard.js',
            '/performance-monitor.js'
        ];
        
        console.log('[SW] Caching static assets:', staticAssets.length);
        await cache.addAll(staticAssets);
        
        // Pre-warm essential API routes
        const apiRoutes = [
            '/api/datasets/analysis',
            '/api/datasets/coregistered',
            '/api/cdn/stats'
        ];
        
        for (const route of apiRoutes) {
            try {
                const response = await fetch(route);
                if (response.ok) {
                    await cache.put(route, response.clone());
                }
            } catch (error) {
                console.warn('[SW] Failed to cache API route:', route, error);
            }
        }
        
    } catch (error) {
        console.error('[SW] Failed to cache static assets:', error);
    }
}

/**
 * Clean up old cache versions
 */
async function cleanupOldCaches() {
    try {
        const cacheNames = await caches.keys();
        const oldCaches = cacheNames.filter(name => 
            (name.startsWith('simpleviewer-') || 
             name.startsWith('images-') || 
             name.startsWith('assets-') || 
             name.startsWith('cdn-')) &&
            !name.includes(CACHE_VERSION)
        );
        
        if (oldCaches.length > 0) {
            console.log('[SW] Cleaning up old caches:', oldCaches);
            await Promise.all(oldCaches.map(name => caches.delete(name)));
            metrics.cacheCleanups++;
        }
    } catch (error) {
        console.error('[SW] Failed to cleanup old caches:', error);
    }
}

/**
 * Initialize cache with performance tracking
 */
async function initializeCache() {
    try {
        // Ensure all cache stores exist
        await Promise.all([
            caches.open(CACHE_NAME),
            caches.open(IMAGE_CACHE),
            caches.open(ASSET_CACHE),
            caches.open(CDN_CACHE)
        ]);
        
        // Schedule periodic cache maintenance
        await schedulePeriodicMaintenance();
        
        console.log('[SW] Cache initialization complete');
    } catch (error) {
        console.error('[SW] Failed to initialize cache:', error);
    }
}

/**
 * Main fetch event handler with intelligent caching strategies
 */
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    
    // Skip non-GET requests and chrome-extension requests
    if (request.method !== 'GET' || url.protocol === 'chrome-extension:') {
        return;
    }
    
    // Route to appropriate handler based on request type
    if (isImageRequest(request)) {
        event.respondWith(handleImageRequest(request));
    } else if (isApiRequest(request)) {
        event.respondWith(handleApiRequest(request));
    } else if (isStaticAsset(request)) {
        event.respondWith(handleStaticAssetRequest(request));
    } else {
        // Default network-first for other requests
        event.respondWith(handleDefaultRequest(request));
    }
});

/**
 * Handle image requests with cache-first strategy
 */
async function handleImageRequest(request) {
    const url = new URL(request.url);
    const isResponsiveImage = url.searchParams.has('size') || url.searchParams.has('dpr');
    const isCdnRequest = isCdnUrl(request.url);
    
    try {
        // Try cache first (including CDN cache)
        const cacheKey = getCacheKey(request);
        const cachedResponse = await getCachedResponse(request, cacheKey);
        
        if (cachedResponse && !isExpired(cachedResponse, CACHE_CONFIG.imageExpirationTime)) {
            metrics.cacheHits++;
            console.log('[SW] Cache hit for image:', url.pathname);
            
            // Update cache headers for better client-side caching
            const response = cachedResponse.clone();
            response.headers.set('X-Cache-Status', 'HIT');
            response.headers.set('X-Cache-Source', 'ServiceWorker');
            
            return response;
        }
        
        metrics.cacheMisses++;
        
        // Network request with timeout and retry logic
        const networkResponse = await fetchWithRetry(request, {
            timeout: isResponsiveImage ? 15000 : 10000,
            retries: CACHE_CONFIG.maxRetryAttempts
        });
        
        if (networkResponse && networkResponse.ok) {
            // Cache successful response
            await cacheImageResponse(request, networkResponse.clone(), cacheKey);
            
            // Add performance headers
            const response = networkResponse.clone();
            response.headers.set('X-Cache-Status', 'MISS');
            response.headers.set('X-Cache-Source', 'Network');
            
            metrics.networkRequests++;
            return response;
        }
        
        // If network fails, try to serve stale cache
        if (cachedResponse) {
            console.log('[SW] Serving stale cache for:', url.pathname);
            const response = cachedResponse.clone();
            response.headers.set('X-Cache-Status', 'STALE');
            response.headers.set('X-Cache-Source', 'ServiceWorker');
            return response;
        }
        
        // Last resort: return offline placeholder or error
        return createOfflineImageResponse();
        
    } catch (error) {
        console.error('[SW] Error handling image request:', error);
        metrics.errors++;
        
        // Try to serve from cache as fallback
        try {
            const cacheKey = getCacheKey(request);
            const cachedResponse = await getCachedResponse(request, cacheKey);
            if (cachedResponse) {
                return cachedResponse;
            }
        } catch (cacheError) {
            console.error('[SW] Cache fallback failed:', cacheError);
        }
        
        return createOfflineImageResponse();
    }
}

/**
 * Handle API requests with network-first strategy and caching
 */
async function handleApiRequest(request) {
    const url = new URL(request.url);
    
    try {
        // Try network first for fresh data
        const networkResponse = await fetchWithRetry(request, {
            timeout: 8000,
            retries: 2
        });
        
        if (networkResponse && networkResponse.ok) {
            // Cache API responses (except for auth-related routes)
            if (!url.pathname.includes('/auth/') && !url.pathname.includes('/login')) {
                const cache = await caches.open(ASSET_CACHE);
                await cache.put(request, networkResponse.clone());
            }
            
            metrics.networkRequests++;
            return networkResponse;
        }
        
        throw new Error('Network request failed');
        
    } catch (error) {
        // Network failed, try cache
        console.log('[SW] Network failed for API, trying cache:', url.pathname);
        
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            metrics.cacheHits++;
            metrics.offlineRequests++;
            
            const response = cachedResponse.clone();
            response.headers.set('X-Cache-Status', 'OFFLINE');
            response.headers.set('X-Cache-Source', 'ServiceWorker');
            
            return response;
        }
        
        // Return offline response for critical API endpoints
        if (url.pathname.includes('/datasets/')) {
            return createOfflineDatasetResponse();
        }
        
        metrics.errors++;
        return new Response(JSON.stringify({ 
            error: 'Offline', 
            message: 'This feature is not available offline' 
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * Handle static asset requests with cache-first strategy
 */
async function handleStaticAssetRequest(request) {
    try {
        // Try cache first
        const cachedResponse = await caches.match(request);
        if (cachedResponse && !isExpired(cachedResponse, CACHE_CONFIG.assetExpirationTime)) {
            metrics.cacheHits++;
            return cachedResponse;
        }
        
        // Network request
        const networkResponse = await fetchWithRetry(request, {
            timeout: 5000,
            retries: 2
        });
        
        if (networkResponse && networkResponse.ok) {
            // Cache the response
            const cache = await caches.open(ASSET_CACHE);
            await cache.put(request, networkResponse.clone());
            
            metrics.networkRequests++;
            return networkResponse;
        }
        
        // Serve stale cache if available
        if (cachedResponse) {
            metrics.cacheHits++;
            return cachedResponse;
        }
        
        return new Response('Asset not available offline', { status: 503 });
        
    } catch (error) {
        console.error('[SW] Error handling static asset:', error);
        metrics.errors++;
        
        // Try cache as last resort
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response('Asset not available', { status: 503 });
    }
}

/**
 * Default handler for other requests
 */
async function handleDefaultRequest(request) {
    try {
        const response = await fetch(request);
        metrics.networkRequests++;
        return response;
    } catch (error) {
        metrics.errors++;
        return new Response('Request failed', { status: 503 });
    }
}

/**
 * Background sync for preloading and maintenance
 */
self.addEventListener('sync', event => {
    console.log('[SW] Background sync triggered:', event.tag);
    
    switch (event.tag) {
        case syncQueues.preload:
            event.waitUntil(handlePreloadSync());
            break;
        case syncQueues.cleanup:
            event.waitUntil(handleCleanupSync());
            break;
        case syncQueues.analytics:
            event.waitUntil(handleAnalyticsSync());
            break;
        default:
            console.log('[SW] Unknown sync tag:', event.tag);
    }
});

/**
 * Handle preload background sync
 */
async function handlePreloadSync() {
    try {
        console.log('[SW] Starting background preload sync');
        
        // Get preload queue from IndexedDB or client message
        const preloadQueue = await getPreloadQueue();
        
        if (preloadQueue && preloadQueue.length > 0) {
            // Process in batches to avoid overwhelming the network
            for (let i = 0; i < preloadQueue.length; i += CACHE_CONFIG.preloadBatchSize) {
                const batch = preloadQueue.slice(i, i + CACHE_CONFIG.preloadBatchSize);
                
                await Promise.allSettled(
                    batch.map(item => preloadImage(item))
                );
                
                // Small delay between batches
                if (i + CACHE_CONFIG.preloadBatchSize < preloadQueue.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            metrics.backgroundSyncs++;
            console.log('[SW] Background preload sync completed');
        }
        
    } catch (error) {
        console.error('[SW] Background preload sync failed:', error);
        metrics.errors++;
    }
}

/**
 * Handle cache cleanup background sync
 */
async function handleCleanupSync() {
    try {
        console.log('[SW] Starting background cache cleanup');
        
        await Promise.all([
            cleanupImageCache(),
            cleanupCdnCache(),
            cleanupAssetCache()
        ]);
        
        metrics.cacheCleanups++;
        console.log('[SW] Background cleanup completed');
        
    } catch (error) {
        console.error('[SW] Background cleanup failed:', error);
        metrics.errors++;
    }
}

/**
 * Handle analytics sync
 */
async function handleAnalyticsSync() {
    try {
        console.log('[SW] Syncing analytics data');
        
        // Send metrics to server when online
        const response = await fetch('/api/sw/analytics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metrics: metrics,
                cacheInfo: await getCacheInfo(),
                timestamp: Date.now()
            })
        });
        
        if (response.ok) {
            console.log('[SW] Analytics sync successful');
        }
        
    } catch (error) {
        console.log('[SW] Analytics sync failed (offline):', error);
    }
}

/**
 * Message handling for communication with main thread
 */
self.addEventListener('message', event => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'PRELOAD_IMAGES':
            handlePreloadMessage(data, event.ports[0]);
            break;
        case 'CLEAR_CACHE':
            handleClearCacheMessage(data, event.ports[0]);
            break;
        case 'GET_CACHE_INFO':
            handleGetCacheInfoMessage(event.ports[0]);
            break;
        case 'GET_METRICS':
            handleGetMetricsMessage(event.ports[0]);
            break;
        case 'UPDATE_CONFIG':
            handleUpdateConfigMessage(data, event.ports[0]);
            break;
        default:
            console.log('[SW] Unknown message type:', type);
    }
});

/**
 * Handle preload message from main thread
 */
async function handlePreloadMessage(imageUrls, port) {
    try {
        console.log('[SW] Received preload request for', imageUrls.length, 'images');
        
        const results = await Promise.allSettled(
            imageUrls.map(url => preloadImage({ url, priority: 'background' }))
        );
        
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        
        port.postMessage({
            type: 'PRELOAD_COMPLETE',
            data: { successful, failed, total: imageUrls.length }
        });
        
    } catch (error) {
        console.error('[SW] Preload message handling failed:', error);
        port.postMessage({
            type: 'PRELOAD_ERROR',
            data: { error: error.message }
        });
    }
}

/**
 * Utility Functions
 */

function isImageRequest(request) {
    const url = new URL(request.url);
    return /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(url.pathname) ||
           url.pathname.includes('/images/') ||
           request.headers.get('accept')?.includes('image/');
}

function isApiRequest(request) {
    return new URL(request.url).pathname.startsWith('/api/');
}

function isStaticAsset(request) {
    const url = new URL(request.url);
    return /\.(js|css|html|ico|manifest)$/i.test(url.pathname) ||
           url.pathname === '/' ||
           url.pathname === '/index.html';
}

function isCdnUrl(url) {
    // Check if the URL contains CDN parameters or comes from a CDN domain
    const urlObj = new URL(url);
    return urlObj.searchParams.has('cdn') ||
           urlObj.searchParams.has('cloudinary') ||
           urlObj.searchParams.has('imgix') ||
           urlObj.host.includes('cloudinary') ||
           urlObj.host.includes('imgix') ||
           urlObj.host.includes('cdn');
}

function getCacheKey(request) {
    const url = new URL(request.url);
    
    // For responsive images, include size parameters in cache key
    if (url.searchParams.has('size') || url.searchParams.has('dpr')) {
        const params = new URLSearchParams();
        ['size', 'dpr', 'quality', 'format'].forEach(param => {
            if (url.searchParams.has(param)) {
                params.set(param, url.searchParams.get(param));
            }
        });
        return `${url.pathname}?${params.toString()}`;
    }
    
    return url.pathname;
}

async function getCachedResponse(request, cacheKey) {
    const caches_to_check = [IMAGE_CACHE, CDN_CACHE, CACHE_NAME];
    
    for (const cacheName of caches_to_check) {
        try {
            const cache = await caches.open(cacheName);
            const response = await cache.match(cacheKey || request);
            if (response) {
                return response;
            }
        } catch (error) {
            console.warn('[SW] Error checking cache:', cacheName, error);
        }
    }
    
    return null;
}

async function cacheImageResponse(request, response, cacheKey) {
    try {
        const url = new URL(request.url);
        const cacheName = isCdnUrl(request.url) ? CDN_CACHE : IMAGE_CACHE;
        const cache = await caches.open(cacheName);
        
        // Add metadata headers
        const responseToCache = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: {
                ...Object.fromEntries(response.headers.entries()),
                'X-Cached-At': new Date().toISOString(),
                'X-Cache-Version': CACHE_VERSION
            }
        });
        
        await cache.put(cacheKey || request, responseToCache);
        console.log('[SW] Cached image:', url.pathname);
        
        // Schedule cleanup if cache is getting large
        scheduleCleanupIfNeeded(cacheName);
        
    } catch (error) {
        console.error('[SW] Failed to cache image:', error);
    }
}

function isExpired(response, maxAge) {
    try {
        const cachedAt = response.headers.get('X-Cached-At');
        if (!cachedAt) return false;
        
        const cacheTime = new Date(cachedAt).getTime();
        const now = Date.now();
        
        return (now - cacheTime) > maxAge;
    } catch (error) {
        return false;
    }
}

async function fetchWithRetry(request, options = {}) {
    const { timeout = 10000, retries = 3 } = options;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await fetch(request, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                return response;
            } else if (response.status >= 500 && attempt < retries) {
                // Retry on server errors
                console.log(`[SW] Server error ${response.status}, retrying... (${attempt}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                continue;
            } else {
                return response;
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`[SW] Request timeout (attempt ${attempt}/${retries})`);
            } else {
                console.log(`[SW] Request failed (attempt ${attempt}/${retries}):`, error.message);
            }
            
            if (attempt === retries) {
                throw error;
            }
            
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
    }
}

async function preloadImage(item) {
    try {
        const { url, priority = 'low' } = item;
        const request = new Request(url);
        
        // Skip if already cached
        const cached = await getCachedResponse(request);
        if (cached && !isExpired(cached, CACHE_CONFIG.imageExpirationTime)) {
            return { success: true, cached: true };
        }
        
        // Fetch and cache
        const response = await fetchWithRetry(request, {
            timeout: priority === 'high' ? 15000 : 10000,
            retries: 2
        });
        
        if (response && response.ok) {
            await cacheImageResponse(request, response, getCacheKey(request));
            return { success: true, cached: false };
        }
        
        throw new Error(`HTTP ${response?.status || 'unknown'}`);
        
    } catch (error) {
        console.warn('[SW] Preload failed for:', item.url, error);
        return { success: false, error: error.message };
    }
}

function createOfflineImageResponse() {
    // Return a simple SVG placeholder for offline images
    const svg = `
        <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#f0f0f0"/>
            <text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="16" fill="#666">
                Image not available offline
            </text>
        </svg>
    `;
    
    return new Response(svg, {
        headers: {
            'Content-Type': 'image/svg+xml',
            'X-Cache-Status': 'OFFLINE'
        }
    });
}

function createOfflineDatasetResponse() {
    return new Response(JSON.stringify({
        error: 'offline',
        message: 'Dataset information is not available offline',
        datasets: []
    }), {
        status: 503,
        headers: {
            'Content-Type': 'application/json',
            'X-Cache-Status': 'OFFLINE'
        }
    });
}

async function cleanupImageCache() {
    try {
        const cache = await caches.open(IMAGE_CACHE);
        const requests = await cache.keys();
        const currentSize = await getCacheSize(IMAGE_CACHE);
        
        if (currentSize > CACHE_CONFIG.maxImageCacheSize) {
            console.log('[SW] Image cache size exceeded, cleaning up');
            
            // Get cache entries with metadata
            const entries = await Promise.all(
                requests.map(async request => {
                    const response = await cache.match(request);
                    const cachedAt = response?.headers.get('X-Cached-At');
                    return {
                        request,
                        cachedAt: cachedAt ? new Date(cachedAt).getTime() : 0,
                        size: await estimateResponseSize(response)
                    };
                })
            );
            
            // Sort by age (oldest first)
            entries.sort((a, b) => a.cachedAt - b.cachedAt);
            
            // Remove oldest entries until we're under the limit
            let removedSize = 0;
            let removedCount = 0;
            
            for (const entry of entries) {
                if (currentSize - removedSize <= CACHE_CONFIG.maxImageCacheSize * 0.8) {
                    break;
                }
                
                await cache.delete(entry.request);
                removedSize += entry.size;
                removedCount++;
            }
            
            console.log(`[SW] Cleaned up ${removedCount} images, freed ${Math.round(removedSize / 1024 / 1024)}MB`);
        }
    } catch (error) {
        console.error('[SW] Image cache cleanup failed:', error);
    }
}

async function cleanupCdnCache() {
    try {
        const cache = await caches.open(CDN_CACHE);
        const requests = await cache.keys();
        const currentSize = await getCacheSize(CDN_CACHE);
        
        if (currentSize > CACHE_CONFIG.maxCdnCacheSize) {
            console.log('[SW] CDN cache size exceeded, cleaning up');
            
            // Similar cleanup logic for CDN cache
            const entries = await Promise.all(
                requests.map(async request => {
                    const response = await cache.match(request);
                    const cachedAt = response?.headers.get('X-Cached-At');
                    return {
                        request,
                        cachedAt: cachedAt ? new Date(cachedAt).getTime() : 0,
                        size: await estimateResponseSize(response)
                    };
                })
            );
            
            entries.sort((a, b) => a.cachedAt - b.cachedAt);
            
            let removedSize = 0;
            let removedCount = 0;
            
            for (const entry of entries) {
                if (currentSize - removedSize <= CACHE_CONFIG.maxCdnCacheSize * 0.8) {
                    break;
                }
                
                await cache.delete(entry.request);
                removedSize += entry.size;
                removedCount++;
            }
            
            console.log(`[SW] Cleaned up ${removedCount} CDN entries, freed ${Math.round(removedSize / 1024 / 1024)}MB`);
        }
    } catch (error) {
        console.error('[SW] CDN cache cleanup failed:', error);
    }
}

async function cleanupAssetCache() {
    try {
        const cache = await caches.open(ASSET_CACHE);
        const requests = await cache.keys();
        
        // Remove expired assets
        let removedCount = 0;
        
        for (const request of requests) {
            const response = await cache.match(request);
            if (response && isExpired(response, CACHE_CONFIG.assetExpirationTime)) {
                await cache.delete(request);
                removedCount++;
            }
        }
        
        if (removedCount > 0) {
            console.log(`[SW] Cleaned up ${removedCount} expired assets`);
        }
    } catch (error) {
        console.error('[SW] Asset cache cleanup failed:', error);
    }
}

async function getCacheSize(cacheName) {
    try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        let totalSize = 0;
        
        for (const key of keys) {
            const response = await cache.match(key);
            if (response) {
                totalSize += await estimateResponseSize(response);
            }
        }
        
        return totalSize;
    } catch (error) {
        console.error('[SW] Failed to calculate cache size:', error);
        return 0;
    }
}

async function estimateResponseSize(response) {
    try {
        if (!response) return 0;
        
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            return parseInt(contentLength, 10);
        }
        
        // Estimate from response body
        const clone = response.clone();
        const arrayBuffer = await clone.arrayBuffer();
        return arrayBuffer.byteLength;
    } catch (error) {
        return 1024; // Default estimate
    }
}

async function getCacheInfo() {
    try {
        const cacheNames = [CACHE_NAME, IMAGE_CACHE, ASSET_CACHE, CDN_CACHE];
        const info = {};
        
        for (const name of cacheNames) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            const size = await getCacheSize(name);
            
            info[name] = {
                entries: keys.length,
                size: size,
                sizeMB: Math.round(size / 1024 / 1024 * 100) / 100
            };
        }
        
        return info;
    } catch (error) {
        console.error('[SW] Failed to get cache info:', error);
        return {};
    }
}

async function scheduleCleanupIfNeeded(cacheName) {
    try {
        const size = await getCacheSize(cacheName);
        const maxSize = cacheName === IMAGE_CACHE ? CACHE_CONFIG.maxImageCacheSize :
                      cacheName === CDN_CACHE ? CACHE_CONFIG.maxCdnCacheSize :
                      CACHE_CONFIG.maxAssetCacheSize;
        
        if (size > maxSize * 0.9) {
            // Schedule background cleanup
            if ('serviceWorker' in self && 'sync' in self.registration) {
                await self.registration.sync.register(syncQueues.cleanup);
            }
        }
    } catch (error) {
        console.warn('[SW] Failed to schedule cleanup:', error);
    }
}

async function schedulePeriodicMaintenance() {
    // Schedule periodic maintenance tasks
    setInterval(async () => {
        try {
            await Promise.all([
                cleanupImageCache(),
                cleanupCdnCache(),
                cleanupAssetCache()
            ]);
        } catch (error) {
            console.error('[SW] Periodic maintenance failed:', error);
        }
    }, 60 * 60 * 1000); // Every hour
}

async function getPreloadQueue() {
    // This would typically come from IndexedDB or client messages
    // For now, return empty array - will be populated by client messages
    return [];
}

async function handleClearCacheMessage(data, port) {
    try {
        const { cacheType } = data;
        
        if (cacheType === 'all') {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        } else {
            const cacheName = cacheType === 'images' ? IMAGE_CACHE :
                            cacheType === 'cdn' ? CDN_CACHE :
                            cacheType === 'assets' ? ASSET_CACHE : CACHE_NAME;
            await caches.delete(cacheName);
        }
        
        port.postMessage({
            type: 'CACHE_CLEARED',
            data: { cacheType }
        });
        
    } catch (error) {
        port.postMessage({
            type: 'CACHE_CLEAR_ERROR',
            data: { error: error.message }
        });
    }
}

async function handleGetCacheInfoMessage(port) {
    try {
        const cacheInfo = await getCacheInfo();
        port.postMessage({
            type: 'CACHE_INFO',
            data: cacheInfo
        });
    } catch (error) {
        port.postMessage({
            type: 'CACHE_INFO_ERROR',
            data: { error: error.message }
        });
    }
}

function handleGetMetricsMessage(port) {
    port.postMessage({
        type: 'METRICS',
        data: { ...metrics }
    });
}

function handleUpdateConfigMessage(data, port) {
    try {
        // Update cache configuration
        Object.assign(CACHE_CONFIG, data);
        
        port.postMessage({
            type: 'CONFIG_UPDATED',
            data: { success: true }
        });
    } catch (error) {
        port.postMessage({
            type: 'CONFIG_UPDATE_ERROR',
            data: { error: error.message }
        });
    }
}

console.log('[SW] Service Worker script loaded, version:', CACHE_VERSION);