import { Utils } from './Utils.js';

/**
 * Image caching and loading management with LRU eviction
 */
export class ImageCache {
    constructor(performanceManager) {
        this.performanceManager = performanceManager;
        this.imageCache = new Map();
        this.cacheOrder = []; // FIFO/LRU order tracking
        this.maxCacheSize = 8;
        this.preloadQueue = new Map();
        this.preloadAbortControllers = new Map();
        this.loadAbortController = null;
        this.isLoading = false;
        
        // Listen for cleanup events from performance manager
        this.performanceManager.on('aggressive-cleanup-needed', () => {
            this.performAggressiveCleanup();
        });
    }

    /**
     * Check if image is cached
     */
    has(cacheKey) {
        return this.imageCache.has(cacheKey);
    }

    /**
     * Get cached image
     */
    get(cacheKey) {
        if (this.imageCache.has(cacheKey)) {
            const entry = this.imageCache.get(cacheKey);
            // Update access metadata
            if (entry.metadata) {
                entry.metadata.lastAccessed = Date.now();
                entry.metadata.accessCount++;
            }
            return entry;
        }
        return null;
    }

    /**
     * Delete from cache
     */
    delete(cacheKey) {
        const entry = this.imageCache.get(cacheKey);
        if (entry) {
            this.cleanupBlobUrls(entry);
            this.imageCache.delete(cacheKey);
            
            // Remove from order tracking
            const index = this.cacheOrder.indexOf(cacheKey);
            if (index !== -1) {
                this.cacheOrder.splice(index, 1);
            }
        }
    }

    /**
     * Add image to cache with metadata
     */
    addToCache(cacheKey, img, metadata = {}) {
        this.performCircularBufferEviction();
        
        const cacheEntry = {
            image: img,
            metadata: {
                addedAt: Date.now(),
                lastAccessed: Date.now(),
                accessCount: 0,
                priority: metadata.priority || 10,
                context: metadata.context || 'unknown',
                loadTime: metadata.loadTime || 0,
                estimatedSize: Utils.estimateImageSize(img),
                ...metadata
            }
        };
        
        this.imageCache.set(cacheKey, cacheEntry);
        
        // Update order tracking
        const existingIndex = this.cacheOrder.indexOf(cacheKey);
        if (existingIndex !== -1) {
            this.cacheOrder.splice(existingIndex, 1);
        }
        this.cacheOrder.push(cacheKey);
        
        this.updateMemoryMetrics();
    }

    /**
     * Perform circular buffer eviction (FIFO)
     */
    performCircularBufferEviction() {
        while (this.imageCache.size >= this.maxCacheSize && this.cacheOrder.length > 0) {
            const oldestKey = this.cacheOrder.shift();
            const entry = this.imageCache.get(oldestKey);
            
            if (entry) {
                console.log(`Circular buffer evicting: ${oldestKey}`);
                this.cleanupBlobUrls(entry);
                this.imageCache.delete(oldestKey);
            }
        }
    }

    /**
     * Perform aggressive cleanup when memory is low
     */
    performAggressiveCleanup() {
        // Cancel all pending preloads
        for (const [, controller] of this.preloadAbortControllers) {
            controller.abort();
        }
        this.preloadAbortControllers.clear();
        this.preloadQueue.clear();
        
        // Reduce cache size aggressively
        const targetSize = Math.floor(this.maxCacheSize * 0.5);
        while (this.imageCache.size > targetSize && this.cacheOrder.length > 0) {
            const oldestKey = this.cacheOrder.shift();
            const entry = this.imageCache.get(oldestKey);
            if (entry) {
                this.cleanupBlobUrls(entry);
                this.imageCache.delete(oldestKey);
            }
        }
        
        console.log(`Aggressive cleanup completed. Cache size: ${this.imageCache.size}`);
    }

    /**
     * Clean up blob URLs to prevent memory leaks
     */
    cleanupBlobUrls(entry) {
        if (entry.metadata?.blobUrl) {
            URL.revokeObjectURL(entry.metadata.blobUrl);
        }
        if (entry.image?.src?.startsWith('blob:')) {
            URL.revokeObjectURL(entry.image.src);
        }
    }

    /**
     * Update cache size
     */
    updateCacheSize(newSize = 8) {
        if (newSize < this.maxCacheSize) {
            while (this.imageCache.size > newSize && this.cacheOrder.length > 0) {
                const oldestKey = this.cacheOrder.shift();
                const entry = this.imageCache.get(oldestKey);
                if (entry) {
                    this.cleanupBlobUrls(entry);
                    this.imageCache.delete(oldestKey);
                }
            }
            console.log(`Cache size reduced to ${newSize}, evicted ${this.maxCacheSize - newSize} images`);
        }
        
        this.maxCacheSize = newSize;
        console.log(`Cache size updated: ${this.maxCacheSize} images`);
    }

    /**
     * Load image with progress tracking and caching
     */
    async loadImageWithProgress(imageUrl, cacheKey, onProgress) {
        if (!cacheKey) {
            throw new Error('Cache key is required');
        }

        const loadStartTime = Date.now();
        this.isLoading = true;
        
        try {
            this.loadAbortController = new AbortController();
            
            const img = new Image();
            const cacheStrategy = this.determineCacheStrategy(imageUrl);
            
            const response = await fetch(imageUrl, {
                signal: this.loadAbortController.signal,
                cache: cacheStrategy,
                priority: 'high'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const contentLength = response.headers.get('content-length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            let loaded = 0;
            
            const reader = response.body.getReader();
            const chunks = [];
            
            const progressHistory = [];
            let lastProgressUpdate = Date.now();
            
            // Read stream with progress feedback
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                loaded += value.length;
                
                const now = Date.now();
                if (total > 0 && now - lastProgressUpdate > 100) {
                    const progress = Math.round((loaded / total) * 100);
                    
                    progressHistory.push({ time: now, loaded });
                    if (progressHistory.length > 10) progressHistory.shift();
                    
                    const eta = Utils.calculateETA(progressHistory, total, loaded);
                    const speed = Utils.calculateSpeed(progressHistory);
                    
                    if (onProgress) {
                        onProgress(progress, eta, speed, total);
                    }
                    lastProgressUpdate = now;
                }
            }
            
            const blob = new Blob(chunks);
            const imageObjectURL = URL.createObjectURL(blob);
            
            // Load image from blob
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Image loading timeout'));
                }, 15000);
                
                img.onload = () => {
                    clearTimeout(timeout);
                    const loadTime = Date.now() - loadStartTime;
                    this.performanceManager.updateNetworkQuality(loadTime);
                    this.performanceManager.recordLoadTime(loadTime);
                    
                    img.dataset.originalUrl = imageUrl;
                    
                    this.addToCache(cacheKey, img, {
                        priority: 1,
                        context: 'main-load',
                        loadTime,
                        imageSize: total,
                        blobUrl: imageObjectURL,
                        originalUrl: imageUrl
                    });
                    
                    resolve();
                };
                
                img.onerror = () => {
                    clearTimeout(timeout);
                    URL.revokeObjectURL(imageObjectURL);
                    reject(new Error('Failed to decode image'));
                };
                
                img.src = imageObjectURL;
            });
            
            return this.imageCache.get(cacheKey);
            
        } finally {
            this.isLoading = false;
            this.loadAbortController = null;
        }
    }

    /**
     * Preload image with priority
     */
    async preloadImageWithPriority(imageUrl, cacheKey, priority, context) {
        if (this.imageCache.has(cacheKey)) return;
        
        if (!this.canPreloadMore()) {
            console.log('Skipping preload due to constraints:', imageUrl);
            return;
        }
        
        try {
            const abortController = new AbortController();
            this.preloadAbortControllers.set(imageUrl, abortController);
            
            const img = new Image();
            const loadStartTime = Date.now();
            
            await new Promise((resolve, reject) => {
                const cleanup = () => {
                    this.preloadAbortControllers.delete(imageUrl);
                    this.preloadQueue.delete(imageUrl);
                };
                
                abortController.signal.addEventListener('abort', () => {
                    cleanup();
                    reject(new Error('Preload aborted'));
                });
                
                img.onload = () => {
                    const loadTime = Date.now() - loadStartTime;
                    this.performanceManager.updateNetworkQuality(loadTime);
                    
                    this.addToCache(cacheKey, img, {
                        priority,
                        context,
                        loadTime,
                        lastAccessed: Date.now(),
                        accessCount: 0,
                        blobUrl: img.dataset.blobUrl,
                        originalUrl: imageUrl
                    });
                    
                    cleanup();
                    resolve();
                };
                
                img.onerror = (error) => {
                    console.warn(`Preload failed for ${imageUrl} (${context}):`, error);
                    cleanup();
                    reject(error);
                };
                
                fetch(imageUrl, { 
                    signal: abortController.signal,
                    cache: 'force-cache'
                }).then(response => response.blob())
                .then(blob => {
                    const blobUrl = URL.createObjectURL(blob);
                    img.src = blobUrl;
                    img.dataset.blobUrl = blobUrl;
                    img.dataset.originalUrl = imageUrl;
                }).catch(reject);
            });
            
        } catch (error) {
            if (error.message !== 'Preload aborted') {
                console.warn(`Preload failed for ${imageUrl} (${context}):`, error);
            }
        }
    }

    /**
     * Check if we can preload more images
     */
    canPreloadMore() {
        const memoryUsage = this.estimateMemoryUsage();
        const maxMemoryBytes = this.performanceManager.maxMemoryMB * 1024 * 1024;
        
        return memoryUsage <= maxMemoryBytes && 
               this.imageCache.size < this.maxCacheSize && 
               this.preloadAbortControllers.size <= 5;
    }

    /**
     * Determine cache strategy for fetch
     */
    determineCacheStrategy(imageUrl) {
        return this.imageCache.has(imageUrl) ? 'force-cache' : 'default';
    }

    /**
     * Estimate total memory usage
     */
    estimateMemoryUsage() {
        let totalSize = 0;
        for (const [, entry] of this.imageCache) {
            totalSize += entry.metadata.estimatedSize;
        }
        return totalSize;
    }

    /**
     * Update memory metrics in performance manager
     */
    updateMemoryMetrics() {
        const totalMemoryUsed = this.estimateMemoryUsage();
        this.performanceManager.updateMemoryMetrics(totalMemoryUsed);
    }

    /**
     * Get cache size
     */
    get size() {
        return this.imageCache.size;
    }

    /**
     * Get max cache size
     */
    get maxSize() {
        return this.maxCacheSize;
    }

    /**
     * Cancel ongoing load
     */
    cancelLoad() {
        if (this.loadAbortController) {
            this.loadAbortController.abort();
        }
    }

    /**
     * Cancel preload for specific URL
     */
    cancelPreload(imageUrl) {
        if (this.preloadAbortControllers.has(imageUrl)) {
            this.preloadAbortControllers.get(imageUrl).abort();
            this.preloadAbortControllers.delete(imageUrl);
            this.preloadQueue.delete(imageUrl);
        }
    }

    /**
     * Cleanup all resources
     */
    cleanup() {
        if (this.loadAbortController) {
            this.loadAbortController.abort();
        }
        
        for (const [, controller] of this.preloadAbortControllers) {
            controller.abort();
        }
        
        // Clean up blob URLs
        for (const [, entry] of this.imageCache) {
            this.cleanupBlobUrls(entry);
        }
        
        this.imageCache.clear();
        this.preloadQueue.clear();
        this.preloadAbortControllers.clear();
        this.cacheOrder.length = 0;
        
        console.log('ImageCache cleanup completed');
    }
}