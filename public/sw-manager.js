/**
 * Service Worker Manager - Integration with SimpleViewer
 * 
 * Handles:
 * - Service Worker registration and lifecycle
 * - Installation prompts and update notifications
 * - Communication between main thread and Service Worker
 * - Integration with existing CDN and caching systems
 * - Offline capability detection and UI updates
 */

class ServiceWorkerManager {
    constructor() {
        this.isSupported = 'serviceWorker' in navigator;
        this.registration = null;
        this.swReady = false;
        this.updateAvailable = false;
        this.isOnline = navigator.onLine;
        this.installPromptDeferred = null;
        
        // Performance metrics
        this.metrics = {
            installTime: null,
            activationTime: null,
            firstCacheHit: null,
            offlineRequests: 0,
            preloadRequests: 0
        };
        
        // Configuration
        this.config = {
            enableInstallPrompt: true,
            enableUpdateNotifications: true,
            preloadStrategy: 'intelligent', // 'aggressive', 'intelligent', 'minimal'
            maxPreloadConcurrency: 3,
            updateCheckInterval: 30 * 60 * 1000, // 30 minutes
            offlineIndicatorDelay: 2000 // Show offline indicator after 2s
        };
        
        // Event callbacks
        this.callbacks = {
            onInstalled: null,
            onUpdateAvailable: null,
            onOffline: null,
            onOnline: null,
            onCacheUpdate: null
        };
        
        this.init();
    }
    
    /**
     * Initialize Service Worker Manager
     */
    async init() {
        if (!this.isSupported) {
            console.warn('[SWM] Service Workers not supported');
            this.showFallbackMessage();
            return;
        }
        
        try {
            // Register Service Worker
            await this.register();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Setup installation prompt handling
            this.setupInstallPrompt();
            
            // Setup update checking
            this.setupUpdateChecking();
            
            // Setup offline/online handling
            this.setupNetworkHandling();
            
            // Integration with existing systems
            this.integrateWithApp();
            
            console.log('[SWM] Service Worker Manager initialized');
            
        } catch (error) {
            console.error('[SWM] Initialization failed:', error);
            this.showErrorMessage(error);
        }
    }
    
    /**
     * Register Service Worker
     */
    async register() {
        try {
            const registrationOptions = {
                scope: '/',
                updateViaCache: 'imports' // Better caching for SW updates
            };
            
            this.registration = await navigator.serviceWorker.register('/sw.js', registrationOptions);
            
            console.log('[SWM] Service Worker registered:', this.registration.scope);
            
            // Wait for SW to be ready
            await navigator.serviceWorker.ready;
            this.swReady = true;
            this.metrics.installTime = Date.now();
            
            // Check if SW is already active
            if (this.registration.active) {
                this.metrics.activationTime = Date.now();
                this.onServiceWorkerReady();
            }
            
        } catch (error) {
            console.error('[SWM] Service Worker registration failed:', error);
            throw error;
        }
    }
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        if (!this.registration) return;
        
        // Service Worker lifecycle events
        this.registration.addEventListener('updatefound', () => {
            const newWorker = this.registration.installing;
            console.log('[SWM] New Service Worker found');
            
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed') {
                    if (navigator.serviceWorker.controller) {
                        // New update available
                        this.updateAvailable = true;
                        this.showUpdateNotification();
                        if (this.callbacks.onUpdateAvailable) {
                            this.callbacks.onUpdateAvailable();
                        }
                    } else {
                        // First install
                        console.log('[SWM] Service Worker installed for the first time');
                        if (this.callbacks.onInstalled) {
                            this.callbacks.onInstalled();
                        }
                    }
                } else if (newWorker.state === 'activated') {
                    this.metrics.activationTime = Date.now();
                    this.onServiceWorkerReady();
                }
            });
        });
        
        // Listen for messages from Service Worker
        navigator.serviceWorker.addEventListener('message', (event) => {
            this.handleServiceWorkerMessage(event);
        });
        
        // Listen for controller changes (SW updates)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('[SWM] Service Worker controller changed');
            window.location.reload(); // Refresh to use new SW
        });
    }
    
    /**
     * Handle messages from Service Worker
     */
    handleServiceWorkerMessage(event) {
        const { type, data } = event.data;
        
        switch (type) {
            case 'PRELOAD_COMPLETE':
                console.log('[SWM] Preload completed:', data);
                this.metrics.preloadRequests++;
                break;
                
            case 'PRELOAD_ERROR':
                console.warn('[SWM] Preload error:', data);
                break;
                
            case 'CACHE_INFO':
                this.updateCacheUI(data);
                break;
                
            case 'METRICS':
                this.updateMetricsUI(data);
                break;
                
            case 'CACHE_CLEARED':
                console.log('[SWM] Cache cleared:', data.cacheType);
                this.showCacheMessage(`${data.cacheType} cache cleared`);
                break;
                
            default:
                console.log('[SWM] Unknown SW message:', type, data);
        }
    }
    
    /**
     * Setup PWA installation prompt
     */
    setupInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            this.installPromptDeferred = event;
            
            if (this.config.enableInstallPrompt) {
                this.showInstallPrompt();
            }
        });
        
        window.addEventListener('appinstalled', () => {
            console.log('[SWM] PWA installed');
            this.hideInstallPrompt();
            this.installPromptDeferred = null;
        });
    }
    
    /**
     * Setup automatic update checking
     */
    setupUpdateChecking() {
        if (!this.registration) return;
        
        // Check for updates periodically
        setInterval(() => {
            if (this.isOnline) {
                this.checkForUpdates();
            }
        }, this.config.updateCheckInterval);
        
        // Check when coming back online
        window.addEventListener('online', () => {
            setTimeout(() => this.checkForUpdates(), 1000);
        });
        
        // Check when page regains focus
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isOnline) {
                this.checkForUpdates();
            }
        });
    }
    
    /**
     * Setup network status handling
     */
    setupNetworkHandling() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            console.log('[SWM] Back online');
            this.hideOfflineIndicator();
            
            if (this.callbacks.onOnline) {
                this.callbacks.onOnline();
            }
            
            // Resume preloading when back online
            this.resumePreloading();
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            console.log('[SWM] Gone offline');
            
            // Show offline indicator after delay
            setTimeout(() => {
                if (!this.isOnline) {
                    this.showOfflineIndicator();
                }
            }, this.config.offlineIndicatorDelay);
            
            if (this.callbacks.onOffline) {
                this.callbacks.onOffline();
            }
            
            this.metrics.offlineRequests = 0; // Reset counter
        });
    }
    
    /**
     * Integration with existing ImageViewer application
     */
    integrateWithApp() {
        // Wait for ImageViewer to be available
        const checkImageViewer = setInterval(() => {
            if (window.ImageViewer || (window.app && window.app.imageViewer)) {
                clearInterval(checkImageViewer);
                this.imageViewer = window.ImageViewer || window.app.imageViewer;
                this.setupImageViewerIntegration();
            }
        }, 100);
        
        // Timeout after 10 seconds
        setTimeout(() => {
            clearInterval(checkImageViewer);
            if (!this.imageViewer) {
                console.warn('[SWM] ImageViewer not found, using fallback integration');
                this.setupFallbackIntegration();
            }
        }, 10000);
    }
    
    /**
     * Setup integration with ImageViewer
     */
    setupImageViewerIntegration() {
        console.log('[SWM] Integrating with ImageViewer');
        
        // Hook into image loading to enhance with SW preloading
        const originalLoadCurrentImage = this.imageViewer.loadCurrentImage;
        this.imageViewer.loadCurrentImage = async function(...args) {
            // Call original method
            const result = await originalLoadCurrentImage.apply(this, args);
            
            // Trigger intelligent preloading via SW
            if (window.swManager && window.swManager.swReady) {
                window.swManager.triggerIntelligentPreload(this);
            }
            
            return result;
        };
        
        // Hook into dataset navigation for preloading
        const originalNextDataset = this.imageViewer.nextDataset;
        this.imageViewer.nextDataset = function(...args) {
            const result = originalNextDataset.apply(this, args);
            
            if (window.swManager) {
                window.swManager.preloadAdjacentImages(this);
            }
            
            return result;
        };
        
        const originalPreviousDataset = this.imageViewer.previousDataset;
        this.imageViewer.previousDataset = function(...args) {
            const result = originalPreviousDataset.apply(this, args);
            
            if (window.swManager) {
                window.swManager.preloadAdjacentImages(this);
            }
            
            return result;
        };
        
        // Add SW status to performance indicator
        this.enhancePerformanceUI();
    }
    
    /**
     * Setup fallback integration when ImageViewer is not available
     */
    setupFallbackIntegration() {
        // Monitor for image requests and preload adjacent images
        this.observeImageRequests();
        
        // Add basic offline indicator
        this.createOfflineIndicator();
    }
    
    /**
     * Called when Service Worker is ready
     */
    onServiceWorkerReady() {
        console.log('[SWM] Service Worker is ready');
        
        // Request initial cache info
        this.getCacheInfo();
        
        // Setup periodic metrics updates
        setInterval(() => {
            this.getMetrics();
        }, 30000); // Every 30 seconds
        
        // Add SW status to UI
        this.updateServiceWorkerStatus(true);
    }
    
    /**
     * Trigger intelligent preloading based on current context
     */
    async triggerIntelligentPreload(imageViewer) {
        if (!this.swReady || !imageViewer.datasets.length) return;
        
        try {
            const preloadUrls = this.generatePreloadUrls(imageViewer);
            
            if (preloadUrls.length > 0) {
                console.log('[SWM] Triggering preload for', preloadUrls.length, 'images');
                
                await this.sendMessageToSW({
                    type: 'PRELOAD_IMAGES',
                    data: preloadUrls
                });
            }
        } catch (error) {
            console.error('[SWM] Preload triggering failed:', error);
        }
    }
    
    /**
     * Generate URLs for intelligent preloading
     */
    generatePreloadUrls(imageViewer) {
        const urls = [];
        const currentIndex = imageViewer.currentDatasetIndex;
        const datasets = imageViewer.datasets;
        
        if (!datasets.length) return urls;
        
        // Current dataset - other image types
        const currentDataset = datasets[currentIndex];
        if (currentDataset.preEvent && imageViewer.currentImageType !== 'pre') {
            urls.push(this.generateResponsiveUrl(currentDataset.preEvent, imageViewer));
        }
        if (currentDataset.postEvent && imageViewer.currentImageType !== 'post') {
            urls.push(this.generateResponsiveUrl(currentDataset.postEvent, imageViewer));
        }
        if (currentDataset.changeDetection && imageViewer.currentImageType !== 'change') {
            urls.push(this.generateResponsiveUrl(currentDataset.changeDetection, imageViewer));
        }
        
        // Next dataset - current image type
        const nextIndex = (currentIndex + 1) % datasets.length;
        if (nextIndex !== currentIndex) {
            const nextDataset = datasets[nextIndex];
            const imageProperty = this.getImageProperty(imageViewer.currentImageType);
            if (nextDataset[imageProperty]) {
                urls.push(this.generateResponsiveUrl(nextDataset[imageProperty], imageViewer));
            }
        }
        
        // Previous dataset - current image type (lower priority)
        if (this.config.preloadStrategy === 'aggressive') {
            const prevIndex = (currentIndex - 1 + datasets.length) % datasets.length;
            if (prevIndex !== currentIndex) {
                const prevDataset = datasets[prevIndex];
                const imageProperty = this.getImageProperty(imageViewer.currentImageType);
                if (prevDataset[imageProperty]) {
                    urls.push(this.generateResponsiveUrl(prevDataset[imageProperty], imageViewer));
                }
            }
        }
        
        return urls.filter(Boolean).slice(0, this.config.maxPreloadConcurrency);
    }
    
    /**
     * Generate responsive URL for preloading
     */
    generateResponsiveUrl(baseUrl, imageViewer) {
        if (!baseUrl || !imageViewer.responsiveConfig) return baseUrl;
        
        try {
            const responsiveData = imageViewer.generateResponsiveImageUrls(baseUrl);
            return imageViewer.buildResponsiveUrl(
                baseUrl, 
                responsiveData.optimal.breakpoint.suffix, 
                responsiveData.optimal.pixelRatio
            );
        } catch (error) {
            console.warn('[SWM] Failed to generate responsive URL:', error);
            return baseUrl;
        }
    }
    
    /**
     * Get image property name from type
     */
    getImageProperty(imageType) {
        switch(imageType) {
            case 'pre': return 'preEvent';
            case 'post': return 'postEvent';
            case 'change': return 'changeDetection';
            default: return 'preEvent';
        }
    }
    
    /**
     * Preload adjacent images for smooth navigation
     */
    async preloadAdjacentImages(imageViewer) {
        if (!this.swReady || this.config.preloadStrategy === 'minimal') return;
        
        try {
            const urls = this.generatePreloadUrls(imageViewer);
            
            if (urls.length > 0) {
                await this.sendMessageToSW({
                    type: 'PRELOAD_IMAGES',
                    data: urls
                });
            }
        } catch (error) {
            console.error('[SWM] Adjacent preload failed:', error);
        }
    }
    
    /**
     * Send message to Service Worker
     */
    async sendMessageToSW(message) {
        if (!this.swReady || !navigator.serviceWorker.controller) {
            throw new Error('Service Worker not ready');
        }
        
        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();
            
            messageChannel.port1.onmessage = (event) => {
                resolve(event.data);
            };
            
            navigator.serviceWorker.controller.postMessage(message, [messageChannel.port2]);
            
            // Timeout after 10 seconds
            setTimeout(() => reject(new Error('SW message timeout')), 10000);
        });
    }
    
    /**
     * Check for Service Worker updates
     */
    async checkForUpdates() {
        if (!this.registration) return;
        
        try {
            await this.registration.update();
        } catch (error) {
            console.warn('[SWM] Update check failed:', error);
        }
    }
    
    /**
     * Apply available update
     */
    async applyUpdate() {
        if (!this.registration || !this.updateAvailable) return;
        
        try {
            const newWorker = this.registration.waiting;
            if (newWorker) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
        } catch (error) {
            console.error('[SWM] Apply update failed:', error);
        }
    }
    
    /**
     * Show PWA installation prompt
     */
    showInstallPrompt() {
        // Create install prompt UI
        const installBanner = document.createElement('div');
        installBanner.id = 'pwa-install-banner';
        installBanner.className = 'pwa-install-banner';
        installBanner.innerHTML = `
            <div class="install-content">
                <span class="install-icon">📱</span>
                <div class="install-text">
                    <strong>Install ImageViewer</strong>
                    <p>Get the full offline experience</p>
                </div>
                <button class="install-btn" id="pwa-install-btn">Install</button>
                <button class="install-close" id="pwa-install-close">×</button>
            </div>
        `;
        
        document.body.appendChild(installBanner);
        
        // Event handlers
        document.getElementById('pwa-install-btn').addEventListener('click', () => {
            this.triggerInstall();
        });
        
        document.getElementById('pwa-install-close').addEventListener('click', () => {
            this.hideInstallPrompt();
        });
        
        // Auto-hide after 30 seconds
        setTimeout(() => {
            this.hideInstallPrompt();
        }, 30000);
    }
    
    /**
     * Trigger PWA installation
     */
    async triggerInstall() {
        if (!this.installPromptDeferred) return;
        
        try {
            const result = await this.installPromptDeferred.prompt();
            console.log('[SWM] Install prompt result:', result.outcome);
            
            this.installPromptDeferred = null;
            this.hideInstallPrompt();
            
        } catch (error) {
            console.error('[SWM] Install prompt failed:', error);
        }
    }
    
    /**
     * Hide installation prompt
     */
    hideInstallPrompt() {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) {
            banner.remove();
        }
    }
    
    /**
     * Show update notification
     */
    showUpdateNotification() {
        if (!this.config.enableUpdateNotifications) return;
        
        const updateNotification = document.createElement('div');
        updateNotification.id = 'sw-update-notification';
        updateNotification.className = 'sw-update-notification';
        updateNotification.innerHTML = `
            <div class="update-content">
                <span class="update-icon">🔄</span>
                <div class="update-text">
                    <strong>Update Available</strong>
                    <p>A new version is ready</p>
                </div>
                <button class="update-btn" id="sw-update-btn">Update</button>
                <button class="update-close" id="sw-update-close">×</button>
            </div>
        `;
        
        document.body.appendChild(updateNotification);
        
        // Event handlers
        document.getElementById('sw-update-btn').addEventListener('click', () => {
            this.applyUpdate();
        });
        
        document.getElementById('sw-update-close').addEventListener('click', () => {
            updateNotification.remove();
        });
    }
    
    /**
     * Show offline indicator
     */
    showOfflineIndicator() {
        let indicator = document.getElementById('offline-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'offline-indicator';
            indicator.className = 'offline-indicator';
            indicator.innerHTML = `
                <span class="offline-icon">📴</span>
                <span class="offline-text">Offline Mode</span>
            `;
            document.body.appendChild(indicator);
        }
        
        indicator.classList.add('visible');
    }
    
    /**
     * Hide offline indicator
     */
    hideOfflineIndicator() {
        const indicator = document.getElementById('offline-indicator');
        if (indicator) {
            indicator.classList.remove('visible');
        }
    }
    
    /**
     * Get cache information from Service Worker
     */
    async getCacheInfo() {
        try {
            const response = await this.sendMessageToSW({
                type: 'GET_CACHE_INFO'
            });
            this.updateCacheUI(response.data);
        } catch (error) {
            console.warn('[SWM] Failed to get cache info:', error);
        }
    }
    
    /**
     * Get metrics from Service Worker
     */
    async getMetrics() {
        try {
            const response = await this.sendMessageToSW({
                type: 'GET_METRICS'
            });
            this.updateMetricsUI(response.data);
        } catch (error) {
            console.warn('[SWM] Failed to get metrics:', error);
        }
    }
    
    /**
     * Clear cache
     */
    async clearCache(cacheType = 'all') {
        try {
            await this.sendMessageToSW({
                type: 'CLEAR_CACHE',
                data: { cacheType }
            });
        } catch (error) {
            console.error('[SWM] Clear cache failed:', error);
        }
    }
    
    /**
     * Update cache information in UI
     */
    updateCacheUI(cacheInfo) {
        // Update existing performance indicator if available
        const performanceIndicator = document.getElementById('performanceIndicator');
        if (performanceIndicator && cacheInfo) {
            const totalSizeMB = Object.values(cacheInfo)
                .reduce((sum, cache) => sum + (cache.sizeMB || 0), 0);
            
            const totalEntries = Object.values(cacheInfo)
                .reduce((sum, cache) => sum + (cache.entries || 0), 0);
            
            // Add SW cache info to existing metrics
            const metricsText = performanceIndicator.querySelector('.metrics-text');
            if (metricsText) {
                const existingText = metricsText.textContent;
                if (!existingText.includes('SW:')) {
                    metricsText.textContent += ` | SW: ${totalEntries} (${totalSizeMB.toFixed(1)}MB)`;
                }
            }
        }
        
        if (this.callbacks.onCacheUpdate) {
            this.callbacks.onCacheUpdate(cacheInfo);
        }
    }
    
    /**
     * Update metrics in UI
     */
    updateMetricsUI(metrics) {
        // Add to performance logging
        if (metrics.offlineRequests > 0) {
            console.log('[SWM] Offline requests served:', metrics.offlineRequests);
        }
    }
    
    /**
     * Enhance existing performance UI with SW info
     */
    enhancePerformanceUI() {
        const performanceIndicator = document.getElementById('performanceIndicator');
        if (performanceIndicator) {
            // Add SW status indicator
            const swStatus = document.createElement('span');
            swStatus.id = 'sw-status';
            swStatus.className = 'sw-status';
            swStatus.title = 'Service Worker Status';
            performanceIndicator.appendChild(swStatus);
            
            this.updateServiceWorkerStatus(this.swReady);
        }
    }
    
    /**
     * Update Service Worker status in UI
     */
    updateServiceWorkerStatus(isReady) {
        const swStatus = document.getElementById('sw-status');
        if (swStatus) {
            swStatus.className = `sw-status ${isReady ? 'ready' : 'loading'}`;
            swStatus.textContent = isReady ? '⚡' : '⏳';
            swStatus.title = isReady ? 'Service Worker Active' : 'Service Worker Loading';
        }
    }
    
    /**
     * Resume preloading after coming back online
     */
    resumePreloading() {
        if (this.imageViewer) {
            setTimeout(() => {
                this.triggerIntelligentPreload(this.imageViewer);
            }, 1000);
        }
    }
    
    /**
     * Observe image requests for fallback integration
     */
    observeImageRequests() {
        // Monitor image elements being loaded
        const imageObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const images = node.tagName === 'IMG' ? [node] : node.querySelectorAll('img');
                        images.forEach((img) => {
                            if (img.src && !img.dataset.swObserved) {
                                img.dataset.swObserved = 'true';
                                this.observeImageLoad(img);
                            }
                        });
                    }
                });
            });
        });
        
        imageObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    /**
     * Observe individual image load
     */
    observeImageLoad(img) {
        img.addEventListener('load', () => {
            // Image loaded successfully - could trigger related preloading
            if (this.swReady && this.config.preloadStrategy !== 'minimal') {
                // Basic preloading logic for fallback mode
                this.triggerBasicPreload(img.src);
            }
        });
        
        img.addEventListener('error', () => {
            // Image failed to load - might be offline
            if (!this.isOnline) {
                this.metrics.offlineRequests++;
            }
        });
    }
    
    /**
     * Trigger basic preloading for fallback mode
     */
    async triggerBasicPreload(currentUrl) {
        // Very basic preloading - just attempt to preload a few adjacent images
        // This would need more sophisticated logic based on the specific app structure
        console.log('[SWM] Basic preload triggered for:', currentUrl);
    }
    
    /**
     * Create basic offline indicator for fallback mode
     */
    createOfflineIndicator() {
        if (document.getElementById('offline-indicator')) return;
        
        const indicator = document.createElement('div');
        indicator.id = 'offline-indicator';
        indicator.className = 'offline-indicator';
        indicator.innerHTML = `
            <span class="offline-icon">📴</span>
            <span class="offline-text">Offline</span>
        `;
        document.body.appendChild(indicator);
    }
    
    /**
     * Show fallback message when SW not supported
     */
    showFallbackMessage() {
        console.warn('[SWM] Service Workers not supported - offline features unavailable');
        
        // Could show a message to the user about limited offline functionality
        const message = document.createElement('div');
        message.className = 'sw-fallback-message';
        message.innerHTML = `
            <p>⚠️ Your browser doesn't support offline features. Consider upgrading for the best experience.</p>
        `;
        message.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #ff9800;
            color: white;
            padding: 10px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10000;
        `;
        
        document.body.appendChild(message);
        
        // Auto-hide after 10 seconds
        setTimeout(() => message.remove(), 10000);
    }
    
    /**
     * Show error message
     */
    showErrorMessage(error) {
        console.error('[SWM] Error:', error);
        
        const message = document.createElement('div');
        message.className = 'sw-error-message';
        message.innerHTML = `
            <p>⚠️ Offline features may not work properly: ${error.message}</p>
        `;
        message.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #f44336;
            color: white;
            padding: 10px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10000;
        `;
        
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 15000);
    }
    
    /**
     * Show cache message
     */
    showCacheMessage(message) {
        const notification = document.createElement('div');
        notification.className = 'cache-message';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #4caf50;
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            font-size: 14px;
            z-index: 10000;
        `;
        
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
    
    /**
     * Public API methods
     */
    
    // Set callback functions
    on(event, callback) {
        if (this.callbacks.hasOwnProperty(`on${event.charAt(0).toUpperCase() + event.slice(1)}`)) {
            this.callbacks[`on${event.charAt(0).toUpperCase() + event.slice(1)}`] = callback;
        }
    }
    
    // Update configuration
    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        
        if (this.swReady) {
            this.sendMessageToSW({
                type: 'UPDATE_CONFIG',
                data: newConfig
            }).catch(error => {
                console.warn('[SWM] Config update failed:', error);
            });
        }
    }
    
    // Get current status
    getStatus() {
        return {
            supported: this.isSupported,
            registered: !!this.registration,
            ready: this.swReady,
            online: this.isOnline,
            updateAvailable: this.updateAvailable,
            metrics: this.metrics
        };
    }
    
    // Manual preload trigger
    async preloadImages(urls) {
        if (!this.swReady) {
            throw new Error('Service Worker not ready');
        }
        
        return await this.sendMessageToSW({
            type: 'PRELOAD_IMAGES',
            data: urls
        });
    }
}

// Initialize Service Worker Manager
const swManager = new ServiceWorkerManager();

// Make it globally available
window.swManager = swManager;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ServiceWorkerManager;
}