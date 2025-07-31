import { Utils } from './Utils.js';
import { PerformanceManager } from './PerformanceManager.js';
import { ImageCache } from './ImageCache.js';
import { ViewportManager } from './ViewportManager.js';
import { PanoramaManager } from './PanoramaManager.js';
import { UIManager } from './UIManager.js';

/**
 * Main ImageViewer class that orchestrates all modules
 */
export class ImageViewer {
    constructor() {
        // Application state
        this.datasets = [];
        this.currentDatasetIndex = 0;
        this.currentImageType = 'pre';
        this.currentProject = 'analysis';
        this.useFullResolution = false;
        this.useVegetationFilter = false;
        this.vegetationFilterAvailable = false;
        
        // Initialize modules
        this.performanceManager = new PerformanceManager();
        this.imageCache = new ImageCache(this.performanceManager);
        this.uiManager = new UIManager();
        
        // Setup viewport manager after UI is ready
        const viewerElement = this.uiManager.getElement('viewer');
        const imageElement = this.uiManager.getElement('image');
        const zoomLevelElement = this.uiManager.getElement('zoomLevelText');
        this.viewportManager = new ViewportManager(viewerElement, imageElement, zoomLevelElement);
        
        // Setup panorama manager
        this.panoramaManager = new PanoramaManager();
        
        this.init();
    }

    /**
     * Initialize the application
     */
    init() {
        this.setupCallbacks();
        this.setupCleanup();
        this.updateResolutionStatus();
        this.updateVegetationStatus();
        this.viewportManager.updateMaxZoom();
        this.loadDatasets();
        
        console.log('ImageViewer initialized with modular architecture');
    }

    /**
     * Setup callbacks between modules
     */
    setupCallbacks() {
        // UI callbacks
        this.uiManager.setCallbacks({
            onPreviousDataset: () => this.previousDataset(),
            onNextDataset: () => this.nextDataset(),
            onZoom: (factor) => this.viewportManager.zoom(factor),
            onResetZoom: () => this.viewportManager.resetView(),
            onProjectChange: (project) => this.handleProjectChange(project),
            onDatasetChange: (index) => this.handleDatasetChange(index),
            onImageTypeChange: (type) => this.handleImageTypeChange(type),
            onResolutionChange: (useFullResolution) => this.handleResolutionChange(useFullResolution),
            onVegetationFilterChange: (useVegetationFilter) => this.handleVegetationFilterChange(useVegetationFilter),
            onKeyDown: (e) => this.handleKeyDown(e),
            onImageError: (e) => this.handleImageError(e),
            onImageLoad: () => this.viewportManager.onImageDisplayed()
        });

        // Panorama callbacks
        this.panoramaManager.setImagePairSelectedCallback((imageNumber) => {
            this.selectImagePair(imageNumber);
        });
    }

    /**
     * Setup cleanup on page unload
     */
    setupCleanup() {
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    /**
     * Handle project change
     */
    handleProjectChange(project) {
        this.currentProject = project;
        this.currentDatasetIndex = 0;
        this.viewportManager.markFirstLoad();
        this.loadDatasets();
        this.uiManager.updateChangeDetectionButton(this.currentProject, this.currentImageType);
    }

    /**
     * Handle dataset change via dropdown
     */
    handleDatasetChange(index) {
        this.currentDatasetIndex = index;
        this.checkVegetationFilterAvailability();
        this.viewportManager.resetView(); // Reset view when jumping to specific dataset
        this.loadCurrentImage();
    }

    /**
     * Handle image type change
     */
    handleImageTypeChange(type) {
        this.currentImageType = type;
        this.loadCurrentImage();
    }

    /**
     * Handle resolution change
     */
    handleResolutionChange(useFullResolution) {
        this.useFullResolution = useFullResolution;
        this.imageCache.updateCacheSize();
        this.updateResolutionStatus();
        this.viewportManager.updateMaxZoom();
        this.viewportManager.markResolutionChanged();
        this.loadCurrentImage();
    }

    /**
     * Handle vegetation filter change
     */
    handleVegetationFilterChange(useVegetationFilter) {
        this.useVegetationFilter = useVegetationFilter;
        this.updateVegetationStatus();
        this.imageCache.updateCacheSize();
        this.loadCurrentImage();
    }

    /**
     * Handle keyboard shortcuts
     */
    handleKeyDown(e) {
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
                this.viewportManager.resetView();
                break;
        }
    }

    /**
     * Handle image load errors
     */
    handleImageError(e) {
        // Try to reload the image if it was from cache
        if (e.target.src && (e.target.src.startsWith('blob:') || this.hasImageInCache(e.target.dataset.originalUrl))) {
            console.log('Attempting to reload failed image');
            const originalUrl = e.target.dataset.originalUrl || e.target.src;
            const cacheKey = Utils.generateCacheKey(originalUrl, this.useFullResolution, this.useVegetationFilter, this.vegetationFilterAvailable);
            this.imageCache.delete(cacheKey);
            setTimeout(() => this.loadCurrentImage(), 100);
        }
    }

    /**
     * Check if image is in cache
     */
    hasImageInCache(url) {
        if (!url) return false;
        const cacheKey = Utils.generateCacheKey(url, this.useFullResolution, this.useVegetationFilter, this.vegetationFilterAvailable);
        return this.imageCache.has(cacheKey);
    }

    /**
     * Load datasets from API
     */
    async loadDatasets() {
        try {
            this.uiManager.setStatusText('Loading datasets...');
            const response = await fetch(`/api/datasets/${this.currentProject}`);
            
            // Check for authentication issues
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    console.log('Authentication required, redirecting to login');
                    this.uiManager.setStatusText('Authentication required - redirecting to login...');
                    setTimeout(() => {
                        window.location.href = '/login.html';
                    }, 1500);
                    return;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Check if response is HTML instead of JSON (indicates redirect to login)
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/html')) {
                console.log('Got HTML response instead of JSON - likely redirected to login');
                this.uiManager.setStatusText('Please login to access the application');
                setTimeout(() => {
                    window.location.href = '/login.html';
                }, 2000);
                return;
            }
            
            this.datasets = await response.json();
            
            if (this.datasets.length === 0) {
                this.uiManager.setStatusText('No datasets found');
                this.uiManager.updateDatasetSelector([]);
                return;
            }
            
            this.uiManager.updateDatasetSelector(this.datasets);
            this.updateDatasetCounter();
            this.uiManager.updateChangeDetectionButton(this.currentProject, this.currentImageType);
            
            // Ensure currentDatasetIndex is valid
            if (this.currentDatasetIndex >= this.datasets.length) {
                this.currentDatasetIndex = 0;
            }
            
            this.checkVegetationFilterAvailability();
            this.loadCurrentImage();
        } catch (error) {
            console.error('Error loading datasets:', error);
            this.uiManager.setStatusText('Error loading datasets');
        }
    }

    /**
     * Load current image with caching and progress tracking
     */
    async loadCurrentImage() {
        if (this.datasets.length === 0) return;
        
        const dataset = this.datasets[this.currentDatasetIndex];
        const imageProperty = Utils.getImageProperty(this.currentImageType);
        const imageUrl = Utils.getImageUrl(dataset[imageProperty], this.useFullResolution, this.useVegetationFilter);
        
        console.log(`Loading image: dataset=${this.currentDatasetIndex}, type=${this.currentImageType}, url=${imageUrl}`);
        
        if (!imageUrl) {
            this.uiManager.setStatusText('No image available for current selection');
            this.uiManager.getElement('image').src = '';
            console.warn('No image URL found for current selection');
            return;
        }
        
        // Cancel any ongoing load
        this.imageCache.cancelLoad();
        
        // Generate cache key
        const cacheKey = Utils.generateCacheKey(imageUrl, this.useFullResolution, this.useVegetationFilter, this.vegetationFilterAvailable);
        
        // Check cache first
        if (this.imageCache.has(cacheKey)) {
            this.performanceManager.recordCacheHit();
            const cachedEntry = this.imageCache.get(cacheKey);
            
            if (Utils.validateCachedEntry(cachedEntry, imageUrl)) {
                console.log('Using cached image:', imageUrl, 'with key:', cacheKey);
                this.displayImage(cachedEntry, imageUrl);
                this.intelligentPreload();
                this.updatePerformanceMetrics();
                return;
            } else {
                console.warn('Cached entry is invalid, removing and reloading:', imageUrl);
                this.imageCache.delete(cacheKey);
            }
        }
        
        this.performanceManager.recordCacheMiss();
        
        // Cancel any preload for the same image
        this.imageCache.cancelPreload(imageUrl);
        
        // Load with progress indication
        await this.loadImageWithProgress(imageUrl, cacheKey);
        this.intelligentPreload();
        this.updatePerformanceMetrics();
    }

    /**
     * Load image with progress tracking
     */
    async loadImageWithProgress(imageUrl, cacheKey) {
        this.uiManager.setStatusText('Loading image...');
        this.uiManager.setLoadingVisible(true);
        
        // Extract filename from URL
        const filename = imageUrl.split('/').pop();
        this.uiManager.setImageNameText(filename);
        
        // Progress callback
        const onProgress = (progress, eta, speed, total) => {
            this.uiManager.updateLoadingProgress(progress, eta, speed, total, this.useFullResolution, this.useVegetationFilter, this.vegetationFilterAvailable);
        };
        
        try {
            const cachedEntry = await this.imageCache.loadImageWithProgress(imageUrl, cacheKey, onProgress);
            this.displayImage(cachedEntry, imageUrl);
        } catch (error) {
            if (error.name === 'AbortError') {
                this.uiManager.setStatusText('Loading cancelled');
                console.log('Image loading aborted for:', imageUrl);
            } else {
                console.error('Image loading error for', imageUrl, ':', error);
                this.uiManager.setStatusText('Error loading image - retrying...');
                this.uiManager.setImageNameText('');
                
                // Enhanced retry with network-aware backoff
                this.retryImageLoad(imageUrl, 1, cacheKey);
            }
        } finally {
            this.uiManager.setLoadingVisible(false);
        }
    }

    /**
     * Retry image loading with exponential backoff
     */
    async retryImageLoad(imageUrl, attempt, cacheKey) {
        const maxAttempts = this.performanceManager.getMaxRetryAttempts();
        
        if (attempt > maxAttempts) {
            this.uiManager.setStatusText(`Failed to load image after ${maxAttempts} attempts`);
            this.uiManager.showRetryButton(imageUrl, (url) => {
                this.loadImageWithProgress(url, cacheKey);
            });
            return;
        }
        
        this.uiManager.setStatusText(`Retry attempt ${attempt}/${maxAttempts}... (${this.performanceManager.getNetworkQuality()} network)`);
        
        try {
            const delay = this.performanceManager.calculateRetryDelay(attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            await this.loadImageWithProgress(imageUrl, cacheKey);
        } catch (error) {
            setTimeout(() => this.retryImageLoad(imageUrl, attempt + 1, cacheKey), 100);
        }
    }

    /**
     * Display loaded image
     */
    displayImage(imgOrEntry, imageUrl) {
        const img = imgOrEntry.image || imgOrEntry;
        
        // Check if cached image source is still valid
        if (img.src && img.src.startsWith('blob:') && img.complete && img.naturalWidth === 0) {
            console.warn('Cached blob URL is revoked, reloading image:', imageUrl);
            const cacheKey = Utils.generateCacheKey(imageUrl, this.useFullResolution, this.useVegetationFilter, this.vegetationFilterAvailable);
            this.imageCache.delete(cacheKey);
            this.loadImageWithProgress(imageUrl, cacheKey);
            return;
        }
        
        // Calculate cache hit rate for display
        const cacheMetrics = this.performanceManager.getCacheMetrics();
        const totalRequests = cacheMetrics.hits + cacheMetrics.misses;
        const cacheHitRate = totalRequests > 0 ? (cacheMetrics.hits / totalRequests * 100) : 0;
        
        // Display image via UI manager
        this.uiManager.displayImage(img, imageUrl, this.useFullResolution, this.useVegetationFilter, this.vegetationFilterAvailable, cacheHitRate);
        
        // Notify viewport manager
        this.viewportManager.onImageDisplayed();
        
        // Update panorama highlight
        const currentDataset = this.datasets[this.currentDatasetIndex];
        const imageNumber = parseInt(currentDataset.id);
        this.panoramaManager.updatePanoramaHighlight(imageNumber);
    }

    /**
     * Intelligent preloading based on usage patterns
     */
    intelligentPreload() {
        if (this.datasets.length === 0) return;
        
        const currentDataset = this.datasets[this.currentDatasetIndex];
        const nextIndex = (this.currentDatasetIndex + 1) % this.datasets.length;
        const prevIndex = (this.currentDatasetIndex - 1 + this.datasets.length) % this.datasets.length;
        
        const preloadPromises = [];
        
        // Priority 1: Current dataset's other image types
        const currentImageTypes = ['preEvent', 'postEvent', 'changeDetection'];
        currentImageTypes.forEach((imageType, priority) => {
            const imageUrl = Utils.getImageUrl(currentDataset[imageType], this.useFullResolution, this.useVegetationFilter);
            if (imageUrl) {
                const cacheKey = Utils.generateCacheKey(imageUrl, this.useFullResolution, this.useVegetationFilter, this.vegetationFilterAvailable);
                preloadPromises.push(
                    this.imageCache.preloadImageWithPriority(imageUrl, cacheKey, priority + 1, `current-${imageType}`)
                );
            }
        });
        
        // Priority 2: Next dataset's current image type
        const nextDataset = this.datasets[nextIndex];
        const nextImageProperty = Utils.getImageProperty(this.currentImageType);
        const nextImageUrl = Utils.getImageUrl(nextDataset[nextImageProperty], this.useFullResolution, this.useVegetationFilter);
        if (nextImageUrl) {
            const nextCacheKey = Utils.generateCacheKey(nextImageUrl, this.useFullResolution, this.useVegetationFilter, this.vegetationFilterAvailable);
            preloadPromises.push(
                this.imageCache.preloadImageWithPriority(nextImageUrl, nextCacheKey, 4, 'next-current')
            );
        }
        
        // Priority 3: Previous dataset's current image type
        const prevDataset = this.datasets[prevIndex];
        const prevImageUrl = Utils.getImageUrl(prevDataset[nextImageProperty], this.useFullResolution, this.useVegetationFilter);
        if (prevImageUrl) {
            const prevCacheKey = Utils.generateCacheKey(prevImageUrl, this.useFullResolution, this.useVegetationFilter, this.vegetationFilterAvailable);
            preloadPromises.push(
                this.imageCache.preloadImageWithPriority(prevImageUrl, prevCacheKey, 5, 'prev-current')
            );
        }
        
        // Execute preloads
        Promise.allSettled(preloadPromises);
    }

    /**
     * Update performance metrics display
     */
    updatePerformanceMetrics() {
        const cacheMetrics = this.performanceManager.getCacheMetrics();
        const totalRequests = cacheMetrics.hits + cacheMetrics.misses;
        const cacheHitRate = totalRequests > 0 ? ((cacheMetrics.hits / totalRequests) * 100).toFixed(0) : '0';
        const memoryUsageMB = (cacheMetrics.totalMemoryUsed / 1024 / 1024).toFixed(1);
        
        this.uiManager.updatePerformanceIndicator(
            cacheHitRate,
            memoryUsageMB,
            this.imageCache.size,
            this.imageCache.maxSize,
            this.performanceManager.getNetworkQuality(),
            this.useFullResolution,
            this.useVegetationFilter,
            this.vegetationFilterAvailable,
            this.imageCache.isLoading
        );
    }

    /**
     * Check vegetation filter availability for current dataset
     */
    checkVegetationFilterAvailability() {
        this.vegetationFilterAvailable = false;
        
        if (this.datasets.length > 0 && this.currentDatasetIndex < this.datasets.length) {
            const dataset = this.datasets[this.currentDatasetIndex];
            
            if (dataset.hasVegetationFilter) {
                this.vegetationFilterAvailable = true;
            } else {
                // Fallback: check if any image type has vegetation filter structure
                const imageTypes = ['preEvent', 'postEvent', 'changeDetection'];
                for (const imageType of imageTypes) {
                    const imageUrls = dataset[imageType];
                    if (Utils.hasVegetationFilterStructure(imageUrls)) {
                        this.vegetationFilterAvailable = true;
                        break;
                    }
                }
            }
        }
        
        this.updateVegetationUI();
    }

    /**
     * Update vegetation UI based on availability
     */
    updateVegetationUI() {
        this.uiManager.updateVegetationUI(this.vegetationFilterAvailable);
        
        if (!this.vegetationFilterAvailable) {
            this.useVegetationFilter = false;
        }
        
        this.updateVegetationStatus();
    }

    /**
     * Update resolution status display
     */
    updateResolutionStatus() {
        this.uiManager.updateResolutionStatus(this.useFullResolution);
    }

    /**
     * Update vegetation status display
     */
    updateVegetationStatus() {
        this.uiManager.updateVegetationStatus(this.useVegetationFilter, this.vegetationFilterAvailable);
    }

    /**
     * Set image type programmatically
     */
    setImageType(type) {
        this.uiManager.setActiveImageType(type);
        this.currentImageType = type;
        this.loadCurrentImage();
    }

    /**
     * Navigate to previous dataset
     */
    previousDataset() {
        if (this.currentDatasetIndex > 0) {
            this.currentDatasetIndex--;
            this.uiManager.setDatasetSelectorValue(this.currentDatasetIndex);
            this.updateDatasetCounter();
            this.checkVegetationFilterAvailability();
            this.loadCurrentImage();
            this.cleanupStalePreloads();
        }
    }

    /**
     * Navigate to next dataset
     */
    nextDataset() {
        if (this.currentDatasetIndex < this.datasets.length - 1) {
            this.currentDatasetIndex++;
            this.uiManager.setDatasetSelectorValue(this.currentDatasetIndex);
            this.updateDatasetCounter();
            this.checkVegetationFilterAvailability();
            this.loadCurrentImage();
            this.cleanupStalePreloads();
        }
    }

    /**
     * Update dataset counter display
     */
    updateDatasetCounter() {
        this.uiManager.updateDatasetCounter(this.currentDatasetIndex, this.datasets.length);
    }

    /**
     * Select image pair by number (from panorama)
     */
    selectImagePair(imageNumber) {
        const datasetIndex = this.datasets.findIndex(dataset => 
            parseInt(dataset.id) === imageNumber
        );
        
        if (datasetIndex !== -1 && datasetIndex !== this.currentDatasetIndex) {
            console.log(`Switching to image pair ${imageNumber} (dataset index ${datasetIndex})`);
            
            this.currentDatasetIndex = datasetIndex;
            this.uiManager.setDatasetSelectorValue(this.currentDatasetIndex);
            this.updateDatasetCounter();
            this.checkVegetationFilterAvailability();
            this.loadCurrentImage();
        } else if (datasetIndex === this.currentDatasetIndex) {
            console.log(`Already viewing image pair ${imageNumber}`);
        } else {
            console.warn(`Image pair ${imageNumber} not found in datasets`);
        }
    }

    /**
     * Cleanup stale preloads when navigating
     */
    cleanupStalePreloads() {
        // This would be implemented in ImageCache, but for now we'll keep it simple
        console.log('Cleaning up stale preloads');
    }

    /**
     * Cleanup all resources
     */
    cleanup() {
        console.log('Cleaning up ImageViewer');
        
        this.imageCache.cleanup();
        this.performanceManager.cleanup();
        this.viewportManager.cleanup();
        this.panoramaManager.cleanup();
        this.uiManager.cleanup();
        
        console.log('ImageViewer cleanup completed');
    }
}