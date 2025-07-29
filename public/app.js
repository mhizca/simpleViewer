class ImageViewer {
    constructor() {
        this.datasets = [];
        this.currentDatasetIndex = 0;
        this.currentImageType = 'pre';
        this.currentProject = 'analysis';
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 5;
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.translateX = 0;
        this.translateY = 0;
        
        // Touch tracking
        this.touches = [];
        this.lastTouchDistance = 0;
        
        // Performance optimizations
        this.imageCache = new Map(); // Cache for preloaded images
        this.loadQueue = []; // Queue for sequential image loading
        this.isLoading = false;
        this.loadAbortController = null; // For canceling ongoing loads
        
        // Advanced caching and performance tracking
        this.cacheMetrics = {
            hits: 0,
            misses: 0,
            totalLoadTime: 0,
            averageLoadTime: 0,
            totalMemoryUsed: 0,
            lastMemoryCheck: Date.now()
        };
        this.preloadQueue = new Map(); // Priority-based preload queue
        
        // Circular buffer for simple FIFO eviction
        this.cacheOrder = []; // Track insertion order for FIFO eviction
        this.maxCacheSize = 6; // Circular buffer cache size
        this.maxMemoryMB = 500; // Max memory usage in MB
        this.preloadAbortControllers = new Map(); // Track preload operations
        this.networkQuality = 'good'; // Track network performance
        this.loadStartTimes = new Map(); // Track load performance
        
        this.init();
    }
    
    init() {
        this.setupElements();
        this.setupEventListeners();
        this.loadDatasets();
        
        // Setup performance monitoring
        this.setupPerformanceMonitoring();
        
        // Setup cleanup on page unload
        window.addEventListener('beforeunload', () => this.cleanup());
    }
    
    setupPerformanceMonitoring() {
        // Monitor memory usage periodically
        setInterval(() => {
            this.monitorMemoryUsage();
        }, 30000); // Every 30 seconds
        
        // Setup performance observer for network timing
        if ('PerformanceObserver' in window) {
            try {
                this.performanceObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.initiatorType === 'img' || entry.initiatorType === 'fetch') {
                            this.recordNetworkTiming(entry);
                        }
                    }
                });
                this.performanceObserver.observe({ entryTypes: ['resource'] });
            } catch (e) {
                console.log('Performance Observer not supported');
            }
        }
        
        // Log performance metrics every 60 seconds
        setInterval(() => {
            this.logPerformanceReport();
        }, 60000);
    }
    
    monitorMemoryUsage() {
        // Check if we're approaching memory limits
        const memoryUsage = this.estimateMemoryUsage();
        const memoryUsageMB = memoryUsage / (1024 * 1024);
        
        if (memoryUsageMB > this.maxMemoryMB * 0.8) {
            console.warn(`High memory usage detected: ${memoryUsageMB.toFixed(1)}MB`);
            this.performAggressiveCleanup();
        }
        
        // Check for browser memory API
        if ('memory' in performance) {
            const browserMemory = performance.memory;
            if (browserMemory.usedJSHeapSize > browserMemory.jsHeapSizeLimit * 0.9) {
                console.warn('Browser memory limit approaching, performing cleanup');
                this.performAggressiveCleanup();
            }
        }
    }
    
    performAggressiveCleanup() {
        // Cancel all pending preloads
        for (const [url, controller] of this.preloadAbortControllers) {
            controller.abort();
        }
        this.preloadAbortControllers.clear();
        this.preloadQueue.clear();
        
        // Reduce cache size more aggressively with circular buffer
        const targetSize = Math.floor(this.maxCacheSize * 0.5);
        while (this.imageCache.size > targetSize && this.cacheOrder.length > 0) {
            const oldestUrl = this.cacheOrder.shift();
            const entry = this.imageCache.get(oldestUrl);
            if (entry) {
                // Clean up blob URLs
                if (entry.metadata?.blobUrl) {
                    URL.revokeObjectURL(entry.metadata.blobUrl);
                }
                if (entry.image?.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(entry.image.src);
                }
                this.imageCache.delete(oldestUrl);
            }
        }
        
        console.log(`Aggressive cleanup completed. Cache size: ${this.imageCache.size}`);
    }
    
    recordNetworkTiming(entry) {
        // Record network performance for adaptive loading
        const timing = {
            duration: entry.duration,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize,
            timestamp: entry.startTime
        };
        
        // Update network quality based on performance
        if (timing.transferSize > 0 && timing.duration > 0) {
            const speed = timing.transferSize / timing.duration; // bytes per ms
            const speedMBps = speed / 1024; // KB per second
            
            if (speedMBps > 500) {
                this.networkQuality = 'excellent';
            } else if (speedMBps > 200) {
                this.networkQuality = 'good';
            } else if (speedMBps > 50) {
                this.networkQuality = 'fair';
            } else {
                this.networkQuality = 'poor';
            }
        }
    }
    
    logPerformanceReport() {
        const totalRequests = this.cacheMetrics.hits + this.cacheMetrics.misses;
        if (totalRequests === 0) return;
        
        const report = {
            cachePerformance: {
                hitRate: ((this.cacheMetrics.hits / totalRequests) * 100).toFixed(1) + '%',
                totalRequests,
                averageLoadTime: this.cacheMetrics.averageLoadTime.toFixed(0) + 'ms'
            },
            memoryUsage: {
                cacheSize: this.imageCache.size,
                estimatedMemoryMB: (this.cacheMetrics.totalMemoryUsed / 1024 / 1024).toFixed(1) + 'MB',
                maxMemoryMB: this.maxMemoryMB + 'MB'
            },
            networkQuality: this.networkQuality,
            activePreloads: this.preloadAbortControllers.size,
            queuedPreloads: this.preloadQueue.size
        };
        
        console.group('🚀 ImageViewer Performance Report');
        console.table(report.cachePerformance);
        console.table(report.memoryUsage);
        console.log('Network Quality:', report.networkQuality);
        console.log('Active Preloads:', report.activePreloads);
        console.log('Queued Preloads:', report.queuedPreloads);
        console.groupEnd();
    }
    
    cleanup() {
        // Cancel all ongoing operations
        if (this.loadAbortController) {
            console.log('Aborting main load controller');
            this.loadAbortController.abort();
        }
        
        console.log(`Aborting ${this.preloadAbortControllers.size} preload operations`);
        for (const [url, controller] of this.preloadAbortControllers) {
            controller.abort();
        }
        
        // Clean up performance observer
        if (this.performanceObserver) {
            this.performanceObserver.disconnect();
        }
        
        // Clean up blob URLs before clearing cache
        for (const [url, entry] of this.imageCache) {
            if (entry.metadata?.blobUrl) {
                URL.revokeObjectURL(entry.metadata.blobUrl);
            }
            if (entry.image?.src?.startsWith('blob:')) {
                URL.revokeObjectURL(entry.image.src);
            }
        }
        
        // Clear caches
        this.imageCache.clear();
        this.preloadQueue.clear();
        this.preloadAbortControllers.clear();
        this.cacheOrder.length = 0; // Clear circular buffer order tracking
        
        console.log('ImageViewer cleanup completed');
    }
    
    setupElements() {
        this.viewer = document.getElementById('imageViewer');
        this.image = document.getElementById('mainImage');
        this.projectSelect = document.getElementById('projectSelect');
        this.datasetSelect = document.getElementById('datasetSelect');
        this.datasetCounter = document.getElementById('datasetCounter');
        this.statusText = document.getElementById('statusText');
        this.imageNameText = document.getElementById('imageName');
        this.zoomLevelText = document.getElementById('zoomLevel');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        this.progressBarFill = document.getElementById('progressBarFill');
        this.performanceIndicator = document.getElementById('performanceIndicator');
        this.networkQualityDot = this.performanceIndicator.querySelector('.network-quality');
        this.metricsText = this.performanceIndicator.querySelector('.metrics-text');
        
        // Add error handling to main image element
        this.image.addEventListener('error', (e) => {
            console.error('Main image failed to load:', e.target.src);
            this.statusText.textContent = 'Image failed to display';
            // Try to reload the image if it was from cache
            if (e.target.src && (e.target.src.startsWith('blob:') || this.imageCache.has(e.target.dataset.originalUrl))) {
                console.log('Attempting to reload failed image');
                const originalUrl = e.target.dataset.originalUrl || e.target.src;
                this.imageCache.delete(originalUrl);
                setTimeout(() => this.loadCurrentImage(), 100);
            }
        });
        
        this.image.addEventListener('load', () => {
            console.log('Main image loaded successfully:', this.image.src);
        });
    }
    
    setupEventListeners() {
        document.getElementById('prevDataset').addEventListener('click', () => this.previousDataset());
        document.getElementById('nextDataset').addEventListener('click', () => this.nextDataset());
        
        document.getElementById('zoomIn').addEventListener('click', () => this.zoom(1.2));
        document.getElementById('zoomOut').addEventListener('click', () => this.zoom(0.8));
        document.getElementById('resetZoom').addEventListener('click', () => this.resetView());
        
        this.projectSelect.addEventListener('change', (e) => {
            this.currentProject = e.target.value;
            this.currentDatasetIndex = 0;
            this.loadDatasets();
            this.updateChangeDetectionButton();
        });
        
        document.querySelectorAll('.image-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.image-type-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentImageType = e.target.dataset.type;
                this.loadCurrentImage();
            });
        });
        
        this.datasetSelect.addEventListener('change', (e) => {
            this.currentDatasetIndex = parseInt(e.target.value);
            // Reset view when changing datasets via dropdown
            this.resetView();
            this.loadCurrentImage();
        });
        
        // Mouse events
        this.viewer.addEventListener('mousedown', (e) => this.startDrag(e));
        this.viewer.addEventListener('mousemove', (e) => this.drag(e));
        this.viewer.addEventListener('mouseup', () => this.endDrag());
        this.viewer.addEventListener('mouseleave', () => this.endDrag());
        
        // Touch events for mobile
        this.viewer.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.viewer.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.viewer.addEventListener('touchend', (e) => this.handleTouchEnd(e));
        
        this.viewer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const rect = this.viewer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.zoomAtPoint(delta, x, y);
        });
        
        document.addEventListener('keydown', (e) => {
            switch(e.key) {
                case 'ArrowLeft':
                    this.previousDataset();
                    break;
                case 'ArrowRight':
                    this.nextDataset();
                    break;
                case '1':
                    this.setImageType('pre');
                    break;
                case '2':
                    this.setImageType('post');
                    break;
                case '3':
                    this.setImageType('change');
                    break;
                case 'r':
                    this.resetView();
                    break;
            }
        });
    }
    
    async loadDatasets() {
        try {
            this.statusText.textContent = 'Loading datasets...';
            const response = await fetch(`/api/datasets/${this.currentProject}`);
            this.datasets = await response.json();
            
            if (this.datasets.length === 0) {
                this.statusText.textContent = 'No datasets found';
                this.datasetSelect.innerHTML = '<option>No datasets available</option>';
                return;
            }
            
            this.datasetSelect.innerHTML = this.datasets.map((dataset, index) => 
                `<option value="${index}">Image pair ${dataset.id}</option>`
            ).join('');
            
            this.updateDatasetCounter();
            this.updateChangeDetectionButton();
            this.loadCurrentImage();
        } catch (error) {
            console.error('Error loading datasets:', error);
            this.statusText.textContent = 'Error loading datasets';
        }
    }
    
    async loadCurrentImage() {
        if (this.datasets.length === 0) return;
        
        const dataset = this.datasets[this.currentDatasetIndex];
        let imageUrl;
        
        switch(this.currentImageType) {
            case 'pre':
                imageUrl = dataset.preEvent;
                break;
            case 'post':
                imageUrl = dataset.postEvent;
                break;
            case 'change':
                imageUrl = dataset.changeDetection;
                break;
        }
        
        console.log(`Loading image: dataset=${this.currentDatasetIndex}, type=${this.currentImageType}, url=${imageUrl}`);
        
        if (!imageUrl) {
            this.statusText.textContent = 'No change detection image available';
            this.image.src = '';
            console.warn('No image URL found for current selection');
            return;
        }
        
        // Cancel any ongoing load
        if (this.loadAbortController) {
            this.loadAbortController.abort();
        }
        
        // Check cache first with metrics tracking
        if (this.imageCache.has(imageUrl)) {
            this.cacheMetrics.hits++;
            const cachedEntry = this.imageCache.get(imageUrl);
            
            // Validate cached entry before using it
            if (this.validateCachedEntry(cachedEntry, imageUrl)) {
                console.log('Using cached image:', imageUrl);
                this.displayImage(cachedEntry, imageUrl);
                this.intelligentPreload(); // Enhanced preloading
                this.updatePerformanceMetrics();
                return;
            } else {
                console.warn('Cached entry is invalid, removing and reloading:', imageUrl);
                this.imageCache.delete(imageUrl);
                // Continue to load the image fresh
            }
        }
        
        this.cacheMetrics.misses++;
        
        // Cancel any ongoing preloads for the same image to avoid conflicts
        if (this.preloadAbortControllers.has(imageUrl)) {
            console.log('Canceling preload for main load:', imageUrl);
            this.preloadAbortControllers.get(imageUrl).abort();
            this.preloadAbortControllers.delete(imageUrl);
            this.preloadQueue.delete(imageUrl);
        }
        
        // Load with progress indication and error handling
        await this.loadImageWithProgress(imageUrl);
        this.intelligentPreload(); // Enhanced preloading
        this.updatePerformanceMetrics();
    }
    
    async loadImageWithProgress(imageUrl) {
        const loadStartTime = Date.now();
        this.loadStartTimes.set(imageUrl, loadStartTime);
        
        this.statusText.textContent = 'Loading image...';
        this.isLoading = true;
        
        // Show loading indicator with enhanced feedback
        this.loadingIndicator.style.display = 'block';
        this.progressBarFill.style.width = '0%';
        
        // Extract filename from URL
        const filename = imageUrl.split('/').pop();
        this.imageNameText.textContent = filename;
        
        try {
            this.loadAbortController = new AbortController();
            
            // Create image element for loading
            const img = new Image();
            
            // Check if we can use ServiceWorker cache or need fresh fetch
            const cacheStrategy = this.determineCacheStrategy(imageUrl);
            
            // Progressive loading with fetch API for better control
            const response = await fetch(imageUrl, {
                signal: this.loadAbortController.signal,
                cache: cacheStrategy,
                priority: 'high' // High priority for current image
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const contentLength = response.headers.get('content-length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            let loaded = 0;
            
            const reader = response.body.getReader();
            const chunks = [];
            
            // Enhanced progress tracking with ETA
            let lastProgressUpdate = Date.now();
            const progressHistory = [];
            
            // Read stream with enhanced progress feedback
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                loaded += value.length;
                
                const now = Date.now();
                if (total > 0 && now - lastProgressUpdate > 100) { // Update every 100ms
                    const progress = Math.round((loaded / total) * 100);
                    
                    // Calculate loading speed and ETA
                    progressHistory.push({ time: now, loaded });
                    if (progressHistory.length > 10) progressHistory.shift();
                    
                    const eta = this.calculateETA(progressHistory, total, loaded);
                    const speed = this.calculateSpeed(progressHistory);
                    
                    this.updateLoadingProgress(progress, eta, speed, total);
                    lastProgressUpdate = now;
                }
            }
            
            // Convert chunks to blob
            const blob = new Blob(chunks);
            const imageObjectURL = URL.createObjectURL(blob);
            
            // Load image from blob with timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Image loading timeout'));
                }, 15000); // 15 second timeout
                
                img.onload = () => {
                    clearTimeout(timeout);
                    
                    // Calculate total load time and update metrics
                    const loadTime = Date.now() - loadStartTime;
                    this.cacheMetrics.totalLoadTime += loadTime;
                    this.updateNetworkQuality(loadTime);
                    
                    // Store the original imageUrl as a data attribute for reference
                    img.dataset.originalUrl = imageUrl;
                    
                    // Cache the loaded image with metadata
                    this.addToCache(imageUrl, img, {
                        priority: 1, // Main image has highest priority
                        context: 'main-load',
                        loadTime,
                        imageSize: total,
                        blobUrl: imageObjectURL // Store blob URL for cleanup tracking
                    });
                    
                    this.displayImage(this.imageCache.get(imageUrl), imageUrl);
                    
                    // Don't revoke the blob URL immediately - let the cache management handle it
                    // The blob URL will be cleaned up when the image is evicted from cache
                    resolve();
                };
                
                img.onerror = () => {
                    clearTimeout(timeout);
                    URL.revokeObjectURL(imageObjectURL);
                    reject(new Error('Failed to decode image'));
                };
                
                img.src = imageObjectURL;
            });
            
        } catch (error) {
            if (error.name === 'AbortError') {
                this.statusText.textContent = 'Loading cancelled';
                console.log('Image loading aborted for:', imageUrl);
            } else {
                console.error('Image loading error for', imageUrl, ':', error);
                this.statusText.textContent = 'Error loading image - retrying...';
                this.imageNameText.textContent = '';
                
                // Enhanced retry with network-aware backoff
                const retryDelay = this.calculateRetryDelay(1);
                setTimeout(() => this.retryImageLoad(imageUrl, 1), retryDelay);
            }
        } finally {
            this.isLoading = false;
            this.loadAbortController = null;
            this.loadStartTimes.delete(imageUrl);
            // Hide loading indicator
            this.loadingIndicator.style.display = 'none';
        }
    }
    
    determineCacheStrategy(imageUrl) {
        // Use browser cache for repeated loads, but allow fresh fetch for new images
        return this.imageCache.has(imageUrl) ? 'force-cache' : 'default';
    }
    
    calculateETA(progressHistory, total, loaded) {
        if (progressHistory.length < 2) return null;
        
        const recent = progressHistory.slice(-5); // Use last 5 data points
        const timeSpan = recent[recent.length - 1].time - recent[0].time;
        const dataSpan = recent[recent.length - 1].loaded - recent[0].loaded;
        
        if (timeSpan === 0 || dataSpan === 0) return null;
        
        const bytesPerMs = dataSpan / timeSpan;
        const remainingBytes = total - loaded;
        const etaMs = remainingBytes / bytesPerMs;
        
        return Math.max(0, etaMs / 1000); // Convert to seconds
    }
    
    calculateSpeed(progressHistory) {
        if (progressHistory.length < 2) return 0;
        
        const recent = progressHistory.slice(-3); // Use last 3 data points
        const timeSpan = recent[recent.length - 1].time - recent[0].time;
        const dataSpan = recent[recent.length - 1].loaded - recent[0].loaded;
        
        if (timeSpan === 0) return 0;
        
        return (dataSpan / timeSpan) * 1000; // bytes per second
    }
    
    updateLoadingProgress(progress, eta, speed, total) {
        this.statusText.textContent = `Loading image... ${progress}%`;
        this.progressBarFill.style.width = `${progress}%`;
        
        // Update loading text with enhanced info
        const loadingText = this.loadingIndicator.querySelector('.loading-text');
        let loadingMessage = `Loading image... ${progress}%`;
        
        if (eta && eta < 30) {
            loadingMessage += ` (${Math.ceil(eta)}s remaining)`;
        }
        
        if (speed > 0 && total > 0) {
            const speedMB = speed / (1024 * 1024);
            const totalMB = total / (1024 * 1024);
            if (speedMB > 0.1) {
                loadingMessage += ` • ${speedMB.toFixed(1)} MB/s`;
            }
            if (totalMB > 1) {
                loadingMessage += ` • ${totalMB.toFixed(1)} MB`;
            }
        }
        
        loadingText.textContent = loadingMessage;
    }
    
    calculateRetryDelay(attempt) {
        // Network-aware retry delays
        const baseDelay = this.networkQuality === 'poor' ? 2000 : 
                         this.networkQuality === 'fair' ? 1000 : 500;
        
        return Math.min(baseDelay * Math.pow(1.5, attempt - 1), 8000); // Max 8s delay
    }
    
    async retryImageLoad(imageUrl, attempt) {
        const maxAttempts = this.networkQuality === 'poor' ? 5 : 3;
        
        if (attempt > maxAttempts) {
            this.statusText.textContent = `Failed to load image after ${maxAttempts} attempts`;
            
            // Offer manual retry option
            this.showRetryButton(imageUrl);
            return;
        }
        
        this.statusText.textContent = `Retry attempt ${attempt}/${maxAttempts}... (${this.networkQuality} network)`;
        
        try {
            await this.loadImageWithProgress(imageUrl);
        } catch (error) {
            const delay = this.calculateRetryDelay(attempt + 1);
            console.log(`Retry ${attempt} failed, waiting ${delay}ms before next attempt`);
            setTimeout(() => this.retryImageLoad(imageUrl, attempt + 1), delay);
        }
    }
    
    showRetryButton(imageUrl) {
        // Create retry button in the loading indicator area
        const retryButton = document.createElement('button');
        retryButton.textContent = 'Retry Loading';
        retryButton.className = 'retry-button';
        retryButton.style.cssText = `
            background-color: #0066cc;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
            font-size: 14px;
        `;
        
        retryButton.onclick = () => {
            retryButton.remove();
            this.loadImageWithProgress(imageUrl);
        };
        
        this.loadingIndicator.appendChild(retryButton);
        this.loadingIndicator.style.display = 'block';
    }
    
    displayImage(imgOrEntry, imageUrl) {
        const filename = imageUrl.split('/').pop();
        this.imageNameText.textContent = filename;
        
        // Handle both old cache format (direct img) and new format (entry with metadata)
        let img, metadata;
        if (imgOrEntry.image) {
            img = imgOrEntry.image;
            metadata = imgOrEntry.metadata;
            
            // Update access statistics
            metadata.lastAccessed = Date.now();
            metadata.accessCount++;
        } else {
            // Legacy format support
            img = imgOrEntry;
            metadata = { accessCount: 1, lastAccessed: Date.now() };
        }
        
        // Check if the cached image source is still valid (not a revoked blob URL)
        if (img.src && img.src.startsWith('blob:') && img.complete && img.naturalWidth === 0) {
            console.warn('Cached blob URL is revoked, reloading image:', imageUrl);
            // Remove from cache and reload
            this.imageCache.delete(imageUrl);
            this.loadImageWithProgress(imageUrl);
            return;
        }
        
        // Use the cached image source - for blob URLs, we need to ensure they're still valid
        if (img.src && (img.src.startsWith('data:') || !img.src.startsWith('blob:') || (img.complete && img.naturalWidth > 0))) {
            this.image.src = img.src;
            this.image.dataset.originalUrl = imageUrl;
            console.log('Displaying cached image:', imageUrl);
        } else {
            // If we have an image element but the src is problematic, clone the image data
            if (img.complete && img.naturalWidth > 0) {
                // Create a new blob URL from the image data
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                ctx.drawImage(img, 0, 0);
                
                canvas.toBlob((blob) => {
                    if (blob) {
                        const newBlobUrl = URL.createObjectURL(blob);
                        this.image.src = newBlobUrl;
                        
                        // Clean up the blob URL after the image loads
                        this.image.onload = () => {
                            setTimeout(() => URL.revokeObjectURL(newBlobUrl), 1000);
                        };
                    }
                }, 'image/jpeg', 0.95);
            } else {
                // Fallback: reload the image
                console.warn('Cached image is not valid, reloading:', imageUrl);
                this.imageCache.delete(imageUrl);
                this.loadImageWithProgress(imageUrl);
                return;
            }
        }
        
        // Update status with performance info
        const cacheHitRate = this.cacheMetrics.hits / (this.cacheMetrics.hits + this.cacheMetrics.misses) * 100;
        this.statusText.textContent = `Loaded: ${this.currentImageType}-event image (Cache: ${cacheHitRate.toFixed(1)}%)`;
        
        // Only fit to view if this is the first image load (scale is 1 and no translation)
        if (this.scale === 1 && this.translateX === 0 && this.translateY === 0) {
            this.fitToView();
        } else {
            // Maintain current zoom and pan
            this.updateTransform();
        }
    }
    
    updatePerformanceMetrics() {
        // Update average load time
        if (this.cacheMetrics.misses > 0) {
            this.cacheMetrics.averageLoadTime = this.cacheMetrics.totalLoadTime / this.cacheMetrics.misses;
        }
        
        // Update visual performance indicator
        this.updatePerformanceIndicator();
        
        // Log performance metrics periodically
        if ((this.cacheMetrics.hits + this.cacheMetrics.misses) % 10 === 0) {
            console.log('Performance Metrics:', {
                cacheHitRate: (this.cacheMetrics.hits / (this.cacheMetrics.hits + this.cacheMetrics.misses) * 100).toFixed(1) + '%',
                averageLoadTime: this.cacheMetrics.averageLoadTime.toFixed(0) + 'ms',
                cacheSize: this.imageCache.size,
                memoryUsage: (this.cacheMetrics.totalMemoryUsed / 1024 / 1024).toFixed(1) + 'MB',
                networkQuality: this.networkQuality
            });
        }
    }
    
    updatePerformanceIndicator() {
        const totalRequests = this.cacheMetrics.hits + this.cacheMetrics.misses;
        const cacheHitRate = totalRequests > 0 ? 
            (this.cacheMetrics.hits / totalRequests * 100).toFixed(0) : 0;
        const memoryUsageMB = (this.cacheMetrics.totalMemoryUsed / 1024 / 1024).toFixed(1);
        
        // Update network quality indicator
        this.networkQualityDot.className = `network-quality ${this.networkQuality}`;
        
        // Update metrics text
        this.metricsText.textContent = `Cache: ${cacheHitRate}% | Mem: ${memoryUsageMB}MB | ${this.imageCache.size} imgs`;
        
        // Show indicator during loading or if performance is poor
        const shouldShow = this.isLoading || 
                          this.networkQuality === 'poor' || 
                          parseFloat(memoryUsageMB) > this.maxMemoryMB * 0.7;
        
        if (shouldShow) {
            this.performanceIndicator.classList.add('visible');
        } else {
            // Hide after a delay if performance is good
            setTimeout(() => {
                if (!this.isLoading) {
                    this.performanceIndicator.classList.remove('visible');
                }
            }, 3000);
        }
    }
    
    intelligentPreload() {
        if (this.datasets.length === 0) return;
        
        // Clear existing preload queue
        this.preloadQueue.clear();
        
        const currentDataset = this.datasets[this.currentDatasetIndex];
        const nextIndex = (this.currentDatasetIndex + 1) % this.datasets.length;
        const prevIndex = (this.currentDatasetIndex - 1 + this.datasets.length) % this.datasets.length;
        
        // Priority 1: Current dataset's other image types (highest priority)
        this.addToPreloadQueue(currentDataset.preEvent, 1, 'current-pre');
        this.addToPreloadQueue(currentDataset.postEvent, 1, 'current-post');
        this.addToPreloadQueue(currentDataset.changeDetection, 1, 'current-change');
        
        // Priority 2: Next dataset's current image type (navigation prediction)
        const nextDataset = this.datasets[nextIndex];
        const nextImageProperty = this.getImageProperty(this.currentImageType);
        this.addToPreloadQueue(nextDataset[nextImageProperty], 2, 'next-current');
        
        // Priority 3: Previous dataset's current image type
        const prevDataset = this.datasets[prevIndex];
        this.addToPreloadQueue(prevDataset[nextImageProperty], 3, 'prev-current');
        
        // Priority 4: Next dataset's other image types
        if (this.networkQuality === 'good') {
            this.addToPreloadQueue(nextDataset.preEvent, 4, 'next-pre');
            this.addToPreloadQueue(nextDataset.postEvent, 4, 'next-post');
            this.addToPreloadQueue(nextDataset.changeDetection, 4, 'next-change');
        }
        
        // Priority 5: Adjacent datasets (if network is excellent)
        if (this.networkQuality === 'excellent' && this.datasets.length > 3) {
            const nextNextIndex = (this.currentDatasetIndex + 2) % this.datasets.length;
            const prevPrevIndex = (this.currentDatasetIndex - 2 + this.datasets.length) % this.datasets.length;
            
            const nextNextDataset = this.datasets[nextNextIndex];
            const prevPrevDataset = this.datasets[prevPrevIndex];
            
            this.addToPreloadQueue(nextNextDataset[nextImageProperty], 5, 'next-next');
            this.addToPreloadQueue(prevPrevDataset[nextImageProperty], 5, 'prev-prev');
        }
        
        // Execute preloading with priority order
        this.executePreloadQueue();
    }
    
    getImageProperty(imageType) {
        switch(imageType) {
            case 'pre': return 'preEvent';
            case 'post': return 'postEvent';
            case 'change': return 'changeDetection';
            default: return 'preEvent';
        }
    }
    
    addToPreloadQueue(imageUrl, priority, context) {
        if (!imageUrl || this.imageCache.has(imageUrl) || this.preloadQueue.has(imageUrl)) {
            return;
        }
        
        this.preloadQueue.set(imageUrl, {
            priority,
            context,
            addedAt: Date.now()
        });
    }
    
    async executePreloadQueue() {
        // Sort by priority (lower number = higher priority)
        const sortedUrls = Array.from(this.preloadQueue.entries())
            .sort(([, a], [, b]) => a.priority - b.priority)
            .map(([url]) => url);
        
        // Limit concurrent preloads based on network quality
        const concurrentLimit = this.networkQuality === 'excellent' ? 4 : 
                              this.networkQuality === 'good' ? 3 : 2;
        
        // Process preloads in batches
        for (let i = 0; i < sortedUrls.length; i += concurrentLimit) {
            const batch = sortedUrls.slice(i, i + concurrentLimit);
            await Promise.allSettled(batch.map(url => this.preloadImageWithPriority(url)));
            
            // Small delay between batches to prevent overwhelming the network
            if (i + concurrentLimit < sortedUrls.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }
    
    async preloadImageWithPriority(imageUrl) {
        if (this.imageCache.has(imageUrl) || !this.preloadQueue.has(imageUrl)) return;
        
        const preloadInfo = this.preloadQueue.get(imageUrl);
        
        try {
            // Check memory constraints before preloading
            if (!this.canPreloadMore()) {
                console.log('Skipping preload due to memory constraints:', imageUrl);
                return;
            }
            
            // Create abort controller for this preload
            const abortController = new AbortController();
            this.preloadAbortControllers.set(imageUrl, abortController);
            
            const img = new Image();
            const loadStartTime = Date.now();
            
            await new Promise((resolve, reject) => {
                const cleanup = () => {
                    this.preloadAbortControllers.delete(imageUrl);
                    this.preloadQueue.delete(imageUrl);
                };
                
                // Handle abort
                abortController.signal.addEventListener('abort', () => {
                    cleanup();
                    reject(new Error('Preload aborted'));
                });
                
                img.onload = () => {
                    const loadTime = Date.now() - loadStartTime;
                    this.updateNetworkQuality(loadTime);
                    
                    // Add to cache with LRU metadata
                    this.addToCache(imageUrl, img, {
                        priority: preloadInfo.priority,
                        context: preloadInfo.context,
                        loadTime,
                        lastAccessed: Date.now(),
                        accessCount: 0,
                        blobUrl: img.dataset.blobUrl // Track blob URL for cleanup
                    });
                    
                    cleanup();
                    resolve();
                };
                
                img.onerror = (error) => {
                    console.warn(`Preload failed for ${imageUrl} (${preloadInfo.context}):`, error);
                    cleanup();
                    reject(error);
                };
                
                // Use fetch with cache control for better performance
                fetch(imageUrl, { 
                    signal: abortController.signal,
                    cache: 'force-cache'
                }).then(response => response.blob())
                .then(blob => {
                    const blobUrl = URL.createObjectURL(blob);
                    img.src = blobUrl;
                    
                    // Store blob URL for cleanup when cache is evicted
                    // Don't auto-cleanup - let cache management handle it
                    img.dataset.blobUrl = blobUrl;
                    img.dataset.originalUrl = imageUrl;
                }).catch(reject);
            });
            
        } catch (error) {
            if (error.message !== 'Preload aborted') {
                console.warn(`Preload failed for ${imageUrl} (${preloadInfo?.context}):`, error);
            }
        }
    }
    
    canPreloadMore() {
        // Check memory usage
        if (this.estimateMemoryUsage() > this.maxMemoryMB * 1024 * 1024) {
            return false;
        }
        
        // Check cache size
        if (this.imageCache.size >= this.maxCacheSize) {
            return false;
        }
        
        // Check active preload operations
        if (this.preloadAbortControllers.size > 5) {
            return false;
        }
        
        return true;
    }
    
    addToCache(imageUrl, img, metadata = {}) {
        // Perform circular buffer eviction if needed
        this.performCircularBufferEviction();
        
        // Add metadata for intelligent cache management
        const cacheEntry = {
            image: img,
            metadata: {
                addedAt: Date.now(),
                lastAccessed: Date.now(),
                accessCount: 0,
                priority: metadata.priority || 10,
                context: metadata.context || 'unknown',
                loadTime: metadata.loadTime || 0,
                estimatedSize: this.estimateImageSize(img),
                ...metadata
            }
        };
        
        // Add to cache and track order for circular buffer
        this.imageCache.set(imageUrl, cacheEntry);
        
        // Remove from cacheOrder if already exists (to avoid duplicates when re-accessing)
        const existingIndex = this.cacheOrder.indexOf(imageUrl);
        if (existingIndex !== -1) {
            this.cacheOrder.splice(existingIndex, 1);
        }
        
        // Add to end of queue (most recent)
        this.cacheOrder.push(imageUrl);
        
        this.updateMemoryMetrics();
    }
    
    performCircularBufferEviction() {
        // Simple circular buffer: when cache reaches limit, remove oldest image (FIFO)
        while (this.imageCache.size >= this.maxCacheSize && this.cacheOrder.length > 0) {
            const oldestUrl = this.cacheOrder.shift(); // Remove first (oldest) entry
            const entry = this.imageCache.get(oldestUrl);
            
            if (entry) {
                console.log(`Circular buffer evicting: ${oldestUrl}`);
                
                // Clean up blob URLs when evicting
                if (entry.metadata?.blobUrl) {
                    URL.revokeObjectURL(entry.metadata.blobUrl);
                }
                if (entry.image?.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(entry.image.src);
                }
                
                this.imageCache.delete(oldestUrl);
            }
        }
    }
    
    
    estimateImageSize(img) {
        // Rough estimate: width * height * 4 bytes (RGBA)
        return (img.naturalWidth || img.width || 1000) * 
               (img.naturalHeight || img.height || 1000) * 4;
    }
    
    estimateMemoryUsage() {
        let totalSize = 0;
        for (const [, entry] of this.imageCache) {
            totalSize += entry.metadata.estimatedSize;
        }
        return totalSize;
    }
    
    updateMemoryMetrics() {
        this.cacheMetrics.totalMemoryUsed = this.estimateMemoryUsage();
        this.cacheMetrics.lastMemoryCheck = Date.now();
    }
    
    updateNetworkQuality(loadTime) {
        // Adaptive network quality detection
        if (loadTime < 1000) {
            this.networkQuality = 'excellent';
        } else if (loadTime < 3000) {
            this.networkQuality = 'good';
        } else if (loadTime < 8000) {
            this.networkQuality = 'fair';
        } else {
            this.networkQuality = 'poor';
        }
    }
    
    validateCachedEntry(cachedEntry, imageUrl) {
        try {
            // Handle both old cache format (direct img) and new format (entry with metadata)
            const img = cachedEntry.image || cachedEntry;
            
            if (!img || !img.src) {
                console.warn('Cached entry has no image or src:', imageUrl);
                return false;
            }
            
            // Check if it's a blob URL that might be revoked
            if (img.src.startsWith('blob:')) {
                // For blob URLs, check if the image has loaded properly
                if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
                    console.warn('Cached blob URL appears to be revoked:', imageUrl);
                    return false;
                }
            }
            
            // Check if it's a data URL or regular URL
            if (img.src.startsWith('data:') || img.src.startsWith('http')) {
                return img.complete && img.naturalWidth > 0;
            }
            
            return true;
        } catch (error) {
            console.error('Error validating cached entry:', error);
            return false;
        }
    }
    
    setImageType(type) {
        document.querySelectorAll('.image-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        this.currentImageType = type;
        this.loadCurrentImage();
    }
    
    previousDataset() {
        if (this.currentDatasetIndex > 0) {
            this.currentDatasetIndex--;
            this.datasetSelect.value = this.currentDatasetIndex;
            this.updateDatasetCounter();
            // Reset view when changing datasets
            this.resetView();
            this.loadCurrentImage();
            
            // Cancel unnecessary preloads when navigating
            this.cleanupStalePreloads();
        }
    }
    
    nextDataset() {
        if (this.currentDatasetIndex < this.datasets.length - 1) {
            this.currentDatasetIndex++;
            this.datasetSelect.value = this.currentDatasetIndex;
            this.updateDatasetCounter();
            // Reset view when changing datasets
            this.resetView();
            this.loadCurrentImage();
            
            // Cancel unnecessary preloads when navigating
            this.cleanupStalePreloads();
        }
    }
    
    cleanupStalePreloads() {
        // Cancel preloads that are no longer relevant
        const currentDataset = this.datasets[this.currentDatasetIndex];
        const nextIndex = (this.currentDatasetIndex + 1) % this.datasets.length;
        const prevIndex = (this.currentDatasetIndex - 1 + this.datasets.length) % this.datasets.length;
        
        const relevantUrls = new Set([
            currentDataset.preEvent,
            currentDataset.postEvent,
            currentDataset.changeDetection,
            this.datasets[nextIndex]?.preEvent,
            this.datasets[nextIndex]?.postEvent,
            this.datasets[nextIndex]?.changeDetection,
            this.datasets[prevIndex]?.preEvent,
            this.datasets[prevIndex]?.postEvent,
            this.datasets[prevIndex]?.changeDetection
        ].filter(Boolean));
        
        // Cancel irrelevant preloads
        for (const [url, controller] of this.preloadAbortControllers) {
            if (!relevantUrls.has(url)) {
                controller.abort();
                this.preloadAbortControllers.delete(url);
                this.preloadQueue.delete(url);
            }
        }
    }
    
    updateDatasetCounter() {
        this.datasetCounter.textContent = `${this.currentDatasetIndex + 1} / ${this.datasets.length}`;
    }
    
    updateChangeDetectionButton() {
        const changeBtn = document.querySelector('[data-type="change"]');
        if (this.currentProject === 'coregistered') {
            changeBtn.style.display = 'none';
            if (this.currentImageType === 'change') {
                this.currentImageType = 'pre';
                document.querySelector('[data-type="pre"]').classList.add('active');
                changeBtn.classList.remove('active');
            }
        } else {
            changeBtn.style.display = 'block';
        }
    }
    
    zoom(factor) {
        const newScale = this.scale * factor;
        if (newScale >= this.minScale && newScale <= this.maxScale) {
            this.scale = newScale;
            this.updateTransform();
        }
    }
    
    zoomAtPoint(factor, x, y) {
        const newScale = this.scale * factor;
        if (newScale >= this.minScale && newScale <= this.maxScale) {
            // Get the viewer center point
            const viewerRect = this.viewer.getBoundingClientRect();
            const viewerCenterX = viewerRect.width / 2;
            const viewerCenterY = viewerRect.height / 2;
            
            // Calculate current mouse position in world coordinates
            // (accounting for current scale and translation from center)
            const worldX = (x - viewerCenterX - this.translateX) / this.scale;
            const worldY = (y - viewerCenterY - this.translateY) / this.scale;
            
            // Update scale
            this.scale = newScale;
            
            // Calculate new translation to keep the world point under the cursor
            this.translateX = x - viewerCenterX - worldX * this.scale;
            this.translateY = y - viewerCenterY - worldY * this.scale;
            
            this.updateTransform();
        }
    }
    
    resetView() {
        this.fitToView();
    }
    
    fitToView() {
        const viewerRect = this.viewer.getBoundingClientRect();
        const imgWidth = this.image.naturalWidth;
        const imgHeight = this.image.naturalHeight;
        
        const scaleX = viewerRect.width / imgWidth;
        const scaleY = viewerRect.height / imgHeight;
        
        this.scale = Math.min(scaleX, scaleY) * 0.95; // 95% to add some padding
        this.translateX = 0;
        this.translateY = 0;
        this.updateTransform();
    }
    
    startDrag(e) {
        this.isDragging = true;
        this.startX = e.clientX - this.translateX;
        this.startY = e.clientY - this.translateY;
        this.viewer.style.cursor = 'grabbing';
    }
    
    drag(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        this.translateX = e.clientX - this.startX;
        this.translateY = e.clientY - this.startY;
        this.updateTransform();
    }
    
    endDrag() {
        this.isDragging = false;
        this.viewer.style.cursor = 'grab';
    }
    
    updateTransform() {
        this.image.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        this.zoomLevelText.textContent = `${Math.round(this.scale * 100)}%`;
    }
    
    // Touch event handlers for mobile support
    handleTouchStart(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);
        
        if (this.touches.length === 1) {
            // Single touch - start dragging
            const touch = this.touches[0];
            this.isDragging = true;
            this.startX = touch.clientX - this.translateX;
            this.startY = touch.clientY - this.translateY;
        } else if (this.touches.length === 2) {
            // Two finger touch - prepare for pinch zoom
            this.isDragging = false;
            const touch1 = this.touches[0];
            const touch2 = this.touches[1];
            this.lastTouchDistance = Math.sqrt(
                Math.pow(touch2.clientX - touch1.clientX, 2) +
                Math.pow(touch2.clientY - touch1.clientY, 2)
            );
        }
    }
    
    handleTouchMove(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);
        
        if (this.touches.length === 1 && this.isDragging) {
            // Single touch drag
            const touch = this.touches[0];
            this.translateX = touch.clientX - this.startX;
            this.translateY = touch.clientY - this.startY;
            this.updateTransform();
        } else if (this.touches.length === 2) {
            // Two finger pinch zoom
            const touch1 = this.touches[0];
            const touch2 = this.touches[1];
            const currentDistance = Math.sqrt(
                Math.pow(touch2.clientX - touch1.clientX, 2) +
                Math.pow(touch2.clientY - touch1.clientY, 2)
            );
            
            if (this.lastTouchDistance > 0) {
                const delta = currentDistance / this.lastTouchDistance;
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                
                const rect = this.viewer.getBoundingClientRect();
                const x = centerX - rect.left;
                const y = centerY - rect.top;
                
                this.zoomAtPoint(delta, x, y);
            }
            
            this.lastTouchDistance = currentDistance;
        }
    }
    
    handleTouchEnd(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);
        
        if (this.touches.length === 0) {
            this.isDragging = false;
            this.lastTouchDistance = 0;
        } else if (this.touches.length === 1) {
            // Switched from two finger to one finger - restart single touch drag
            const touch = this.touches[0];
            this.isDragging = true;
            this.startX = touch.clientX - this.translateX;
            this.startY = touch.clientY - this.translateY;
            this.lastTouchDistance = 0;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ImageViewer();
});