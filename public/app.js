class ImageViewer {
    constructor() {
        this.datasets = [];
        this.currentDatasetIndex = 0;
        this.currentImageType = 'pre';
        this.currentProject = 'analysis';
        this.useFullResolution = false; // Default to downsampled resolution
        this.useVegetationFilter = false; // Default to normal (no vegetation filter)
        this.vegetationFilterAvailable = false; // Track if current dataset supports vegetation filtering
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 10; // Will be updated dynamically based on resolution
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.translateX = 0;
        this.translateY = 0;
        
        // Panorama and box highlighting
        this.boxMappings = []; // Will store the box center mappings from CSV
        this.panoramaImage = { width: 1347, height: 386 }; // From CSV header
        this.boxDimensions = { width: 190.25, height: 190.39 }; // From CSV header
        
        // Touch tracking
        this.touches = [];
        this.lastTouchDistance = 0;
        
        // Zoom state tracking
        this.isFirstLoad = true; // Track if this is the first image load
        this.wasResolutionChanged = false; // Track if resolution was just changed
        
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
        this.maxCacheSize = 8; // Consistent cache size for both resolutions
        this.maxMemoryMB = 500; // Max memory usage in MB
        this.preloadAbortControllers = new Map(); // Track preload operations
        this.networkQuality = 'good'; // Track network performance
        this.loadStartTimes = new Map(); // Track load performance
        
        this.init();
    }
    
    init() {
        this.setupElements();
        this.setupEventListeners();
        this.updateResolutionStatus(); // Initialize resolution status display
        this.updateVegetationStatus(); // Initialize vegetation filter status display
        this.updateMaxZoom(); // Initialize zoom limits based on current resolution
        this.loadDatasets();
        this.loadBoxMappings(); // Load the panorama box mappings
        
        // Setup performance monitoring
        this.setupPerformanceMonitoring();
        
        // Create panorama grid overlay
        this.createPanoramaGridOverlay();
        
        // Setup cleanup on page unload
        window.addEventListener('beforeunload', () => this.cleanup());
        
        // Update panorama highlight on window resize
        window.addEventListener('resize', () => {
            // Debounce the resize event
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                this.updatePanoramaHighlight();
            }, 100);
        });
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
            const oldestKey = this.cacheOrder.shift();
            const entry = this.imageCache.get(oldestKey);
            if (entry) {
                // Clean up blob URLs
                if (entry.metadata?.blobUrl) {
                    URL.revokeObjectURL(entry.metadata.blobUrl);
                }
                if (entry.image?.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(entry.image.src);
                }
                this.imageCache.delete(oldestKey);
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
        for (const [cacheKey, entry] of this.imageCache) {
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
    
    async loadBoxMappings() {
        try {
            const response = await fetch('highlighted_box_centers.csv');
            const csvText = await response.text();
            this.parseBoxMappings(csvText);
        } catch (error) {
            console.error('Error loading box mappings:', error);
        }
    }
    
    parseBoxMappings(csvText) {
        const lines = csvText.split('\n');
        this.boxMappings = [];
        
        // Parse header information
        this.parseCSVHeader(lines);
        
        // Find the JSON section in the CSV
        let jsonStartIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '# JSON format:') {
                jsonStartIndex = i + 1;
                break;
            }
        }
        
        if (jsonStartIndex !== -1) {
            // Extract JSON data
            let jsonText = '';
            for (let i = jsonStartIndex; i < lines.length; i++) {
                if (lines[i].trim()) {
                    jsonText += lines[i] + '\n';
                }
            }
            
            try {
                this.boxMappings = JSON.parse(jsonText);
                console.log(`Loaded ${this.boxMappings.length} box mappings`);
            } catch (error) {
                console.error('Error parsing box mappings JSON:', error);
                // Fallback to CSV parsing
                this.parseCSVBoxMappings(lines);
            }
        } else {
            // Fallback to CSV parsing
            this.parseCSVBoxMappings(lines);
        }
    }
    
    parseCSVBoxMappings(lines) {
        // Parse CSV format as fallback
        this.boxMappings = [];
        let imageNumber = 1; // Start numbering from 1
        
        for (let i = 8; i < lines.length; i++) { // Start after header
            const line = lines[i].trim();
            if (line && !line.startsWith('#') && line.includes(',')) {
                const parts = line.split(',');
                if (parts.length >= 5) {
                    const mapping = {
                        numero: imageNumber++, // Assign sequential numbers
                        x: parseFloat(parts[1]),
                        y: parseFloat(parts[2]),
                        col: parseInt(parts[3]),
                        row: parseInt(parts[4])
                    };
                    if (!isNaN(mapping.x) && !isNaN(mapping.y)) {
                        this.boxMappings.push(mapping);
                    }
                }
            }
        }
        console.log(`Parsed ${this.boxMappings.length} box mappings from CSV`);
    }
    
    parseCSVHeader(lines) {
        // Parse header information to extract dimensions dynamically
        for (let i = 0; i < Math.min(10, lines.length); i++) {
            const line = lines[i].trim();
            
            // Parse panorama image dimensions
            if (line.startsWith('# Image:')) {
                const match = line.match(/(\d+)x(\d+)/);
                if (match) {
                    this.panoramaImage.width = parseInt(match[1]);
                    this.panoramaImage.height = parseInt(match[2]);
                    console.log(`Panorama dimensions: ${this.panoramaImage.width}x${this.panoramaImage.height}`);
                }
            }
            
            // Parse box dimensions
            if (line.startsWith('# Box dimensions:')) {
                const match = line.match(/([\d.]+)x([\d.]+)/);
                if (match) {
                    this.boxDimensions.width = parseFloat(match[1]);
                    this.boxDimensions.height = parseFloat(match[2]);
                    console.log(`Box dimensions: ${this.boxDimensions.width}x${this.boxDimensions.height}`);
                }
            }
        }
    }
    
    updatePanoramaHighlight() {
        if (!this.datasets.length || !this.boxMappings.length) return;
        
        const currentDataset = this.datasets[this.currentDatasetIndex];
        const imageNumber = parseInt(currentDataset.id);
        
        // Find the mapping for current image number
        const mapping = this.boxMappings.find(m => m.numero === imageNumber);
        
        if (mapping) {
            // Calculate the highlight box position and size
            // The panorama overlay is 300x86px (or 200x57px on mobile), scaling the 1347x386px panorama
            const panoramaRect = this.panoramaImageElement.getBoundingClientRect();
            const scaleX = panoramaRect.width / this.panoramaImage.width;
            const scaleY = panoramaRect.height / this.panoramaImage.height;
            
            // Calculate box position (center the box around the coordinates)
            const boxLeft = (mapping.x - this.boxDimensions.width / 2) * scaleX;
            const boxTop = (mapping.y - this.boxDimensions.height / 2) * scaleY;
            const boxWidth = this.boxDimensions.width * scaleX;
            const boxHeight = this.boxDimensions.height * scaleY;
            
            // Update highlight box
            this.highlightBox.style.left = `${boxLeft}px`;
            this.highlightBox.style.top = `${boxTop}px`;
            this.highlightBox.style.width = `${boxWidth}px`;
            this.highlightBox.style.height = `${boxHeight}px`;
            this.highlightBox.style.display = 'block';
            
            console.log(`Highlighting box for image ${imageNumber} at (${mapping.x}, ${mapping.y})`);
        } else {
            // Hide highlight box if no mapping found
            this.highlightBox.style.display = 'none';
            console.log(`No mapping found for image ${imageNumber}`);
        }
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
        this.resolutionToggle = document.getElementById('resolutionToggle');
        this.resolutionStatus = document.getElementById('resolutionStatus');
        this.vegetationToggle = document.getElementById('vegetationToggle');
        this.vegetationStatus = document.getElementById('vegetationStatus');
        this.vegetationControls = document.querySelector('.vegetation-controls');
        
        // Panorama elements
        this.panoramaOverlay = document.getElementById('panoramaOverlay');
        this.panoramaImageElement = document.getElementById('panoramaImage');
        this.highlightBox = document.getElementById('highlightBox');
        
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
            this.isFirstLoad = true; // Reset first load flag when changing projects
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
            // Check vegetation filter availability for new dataset
            this.checkVegetationFilterAvailability();
            // Reset view when changing datasets via dropdown (user expects fresh view when jumping)
            this.resetView();
            this.loadCurrentImage();
        });
        
        this.resolutionToggle.addEventListener('change', (e) => {
            this.useFullResolution = e.target.checked;
            this.updateCacheSize();
            this.updateResolutionStatus();
            this.updateMaxZoom(); // Update zoom limits based on resolution
            this.wasResolutionChanged = true; // Mark that resolution was changed
            this.loadCurrentImage();
        });
        
        this.vegetationToggle.addEventListener('change', (e) => {
            this.useVegetationFilter = e.target.checked;
            this.updateVegetationStatus();
            this.updateCacheSize(); // Vegetation filter affects cache organization
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
        
        // Panorama click event for image pair selection
        this.panoramaImageElement.addEventListener('click', (e) => this.handlePanoramaClick(e));
        
        // Add mouseover effect to show available areas
        this.panoramaImageElement.addEventListener('mousemove', (e) => this.handlePanoramaMouseMove(e));
        
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
    
    updateCacheSize() {
        // Use consistent cache size for both resolutions to simplify behavior
        const newCacheSize = 8; // Balanced size that works for both resolutions
        
        // If we're reducing cache size, evict excess images
        if (newCacheSize < this.maxCacheSize) {
            while (this.imageCache.size > newCacheSize && this.cacheOrder.length > 0) {
                const oldestKey = this.cacheOrder.shift();
                const entry = this.imageCache.get(oldestKey);
                if (entry) {
                    // Clean up blob URLs
                    if (entry.metadata?.blobUrl) {
                        URL.revokeObjectURL(entry.metadata.blobUrl);
                    }
                    if (entry.image?.src?.startsWith('blob:')) {
                        URL.revokeObjectURL(entry.image.src);
                    }
                    this.imageCache.delete(oldestKey);
                }
            }
            console.log(`Cache size reduced to ${newCacheSize}, evicted ${this.maxCacheSize - newCacheSize} images`);
        }
        
        this.maxCacheSize = newCacheSize;
        console.log(`Cache size updated: ${this.maxCacheSize} images (${this.useFullResolution ? 'Full' : 'Downsampled'} resolution)`);
    }
    
    updateResolutionStatus() {
        const status = this.useFullResolution ? 'Full Resolution' : 'Downsampled (2x)';
        this.resolutionStatus.textContent = status;
        this.resolutionStatus.className = `resolution-status ${this.useFullResolution ? 'full' : 'downsampled'}`;
    }
    
    updateVegetationStatus() {
        if (!this.vegetationFilterAvailable) {
            this.vegetationStatus.textContent = 'Unavailable';
            this.vegetationStatus.className = 'vegetation-status unavailable';
            return;
        }
        
        const status = this.useVegetationFilter ? 'Active' : 'Inactive';
        this.vegetationStatus.textContent = status;
        this.vegetationStatus.className = `vegetation-status ${this.useVegetationFilter ? 'active' : 'inactive'}`;
    }
    
    checkVegetationFilterAvailability() {
        // Check if current dataset has vegetation filter support
        this.vegetationFilterAvailable = false;
        
        if (this.datasets.length > 0 && this.currentDatasetIndex < this.datasets.length) {
            const dataset = this.datasets[this.currentDatasetIndex];
            
            // Use the backend's hasVegetationFilter flag if available
            if (dataset.hasVegetationFilter) {
                this.vegetationFilterAvailable = true;
            } else {
                // Fallback: check if any image type has vegetation filter structure
                const imageTypes = ['preEvent', 'postEvent', 'changeDetection'];
                for (const imageType of imageTypes) {
                    const imageUrls = dataset[imageType];
                    if (this.hasVegetationFilterStructure(imageUrls)) {
                        this.vegetationFilterAvailable = true;
                        break;
                    }
                }
            }
        }
        
        this.updateVegetationUI();
    }
    
    hasVegetationFilterStructure(imageUrls) {
        return typeof imageUrls === 'object' && 
               imageUrls !== null && 
               imageUrls.vegFilter && 
               typeof imageUrls.vegFilter === 'object';
    }
    
    updateVegetationUI() {
        if (this.vegetationFilterAvailable) {
            this.vegetationControls.classList.remove('vegetation-filter-unavailable');
            this.vegetationToggle.disabled = false;
        } else {
            this.vegetationControls.classList.add('vegetation-filter-unavailable');
            this.vegetationToggle.disabled = true;
            this.vegetationToggle.checked = false;
            this.useVegetationFilter = false;
        }
        
        this.updateVegetationStatus();
    }
    
    generateCacheKey(imageUrl) {
        // Generate a unique cache key that includes resolution and vegetation filter state
        // This ensures different variants of the same image are cached separately
        const resolutionPrefix = this.useFullResolution ? 'full' : 'down';
        // When toggle is inactive (false), we're showing vegetation filtered images
        const filterPrefix = !this.useVegetationFilter && this.vegetationFilterAvailable ? 'veg' : 'norm';
        return `${resolutionPrefix}-${filterPrefix}-${imageUrl}`;
    }
    
    updateMaxZoom() {
        // Use consistent max zoom for both resolutions to simplify behavior
        // Users can zoom as needed regardless of resolution
        this.maxScale = 20;
        
        // If current scale exceeds new max, clamp it
        if (this.scale > this.maxScale) {
            this.scale = this.maxScale;
            this.updateTransform();
        }
    }
    
    getImageUrl(imageUrls) {
        // Handle multiple formats: legacy single URL, dual-resolution format, and vegetation filter format
        if (typeof imageUrls === 'string') {
            // Legacy format - single URL
            return imageUrls;
        } else if (typeof imageUrls === 'object' && imageUrls !== null) {
            // Check if vegetation filter is requested and available
            // When toggle is INACTIVE (false), show filtered images from no_veg_filter folder
            if (!this.useVegetationFilter && imageUrls.vegFilter) {
                // Use vegetation filter variant (from no_veg_filter folder)
                const vegFilterUrls = imageUrls.vegFilter;
                if (typeof vegFilterUrls === 'string') {
                    return vegFilterUrls;
                } else if (typeof vegFilterUrls === 'object' && vegFilterUrls !== null) {
                    return this.useFullResolution ? vegFilterUrls.full : vegFilterUrls.downsampled;
                }
            }
            
            // Use normal (non-filtered) variant when toggle is active
            if (imageUrls.full && imageUrls.downsampled) {
                return this.useFullResolution ? imageUrls.full : imageUrls.downsampled;
            }
        }
        return null;
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
            // Ensure currentDatasetIndex is valid
            if (this.currentDatasetIndex >= this.datasets.length) {
                this.currentDatasetIndex = 0;
            }
            this.checkVegetationFilterAvailability();
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
                imageUrl = this.getImageUrl(dataset.preEvent);
                break;
            case 'post':
                imageUrl = this.getImageUrl(dataset.postEvent);
                break;
            case 'change':
                imageUrl = this.getImageUrl(dataset.changeDetection);
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
        
        // Generate cache key that includes current state
        const cacheKey = this.generateCacheKey(imageUrl);
        
        // Check cache first with metrics tracking
        if (this.imageCache.has(cacheKey)) {
            this.cacheMetrics.hits++;
            const cachedEntry = this.imageCache.get(cacheKey);
            
            // Validate cached entry before using it
            if (this.validateCachedEntry(cachedEntry, imageUrl)) {
                console.log('Using cached image:', imageUrl, 'with key:', cacheKey);
                this.displayImage(cachedEntry, imageUrl);
                this.intelligentPreload(); // Enhanced preloading
                this.updatePerformanceMetrics();
                return;
            } else {
                console.warn('Cached entry is invalid, removing and reloading:', imageUrl);
                this.imageCache.delete(cacheKey);
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
        await this.loadImageWithProgress(imageUrl, cacheKey);
        this.intelligentPreload(); // Enhanced preloading
        this.updatePerformanceMetrics();
    }
    
    async loadImageWithProgress(imageUrl, cacheKey = null) {
        // Generate cache key if not provided
        if (!cacheKey) {
            cacheKey = this.generateCacheKey(imageUrl);
        }
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
                    this.addToCache(cacheKey, img, {
                        priority: 1, // Main image has highest priority
                        context: 'main-load',
                        loadTime,
                        imageSize: total,
                        blobUrl: imageObjectURL, // Store blob URL for cleanup tracking
                        originalUrl: imageUrl // Store the original URL for reference
                    });
                    
                    this.displayImage(this.imageCache.get(cacheKey), imageUrl);
                    
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
                setTimeout(() => this.retryImageLoad(imageUrl, 1, cacheKey), retryDelay);
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
        const resolutionMode = this.useFullResolution ? 'Full' : '2x Downsampled';
        // Show "Automatic Vegetation Filter" only when toggle is active
        const filterMode = this.vegetationFilterAvailable && this.useVegetationFilter ? ' - Automatic Vegetation Filter' : '';
        this.statusText.textContent = `Loading image... ${progress}% (${resolutionMode}${filterMode})`;
        this.progressBarFill.style.width = `${progress}%`;
        
        // Update loading text with enhanced info
        const loadingText = this.loadingIndicator.querySelector('.loading-text');
        let loadingMessage = `Loading ${resolutionMode}${filterMode} image... ${progress}%`;
        
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
                
                // Show estimated savings for downsampled images
                if (!this.useFullResolution) {
                    const estimatedFullSizeMB = totalMB * 4; // Rough estimate: 4x larger for full resolution
                    const savingsMB = estimatedFullSizeMB - totalMB;
                    if (savingsMB > 1) {
                        loadingMessage += ` (saves ~${savingsMB.toFixed(1)} MB)`;
                    }
                }
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
    
    async retryImageLoad(imageUrl, attempt, cacheKey = null) {
        // Generate cache key if not provided
        if (!cacheKey) {
            cacheKey = this.generateCacheKey(imageUrl);
        }
        const maxAttempts = this.networkQuality === 'poor' ? 5 : 3;
        
        if (attempt > maxAttempts) {
            this.statusText.textContent = `Failed to load image after ${maxAttempts} attempts`;
            
            // Offer manual retry option
            this.showRetryButton(imageUrl);
            return;
        }
        
        this.statusText.textContent = `Retry attempt ${attempt}/${maxAttempts}... (${this.networkQuality} network)`;
        
        try {
            await this.loadImageWithProgress(imageUrl, cacheKey);
        } catch (error) {
            const delay = this.calculateRetryDelay(attempt + 1);
            console.log(`Retry ${attempt} failed, waiting ${delay}ms before next attempt`);
            setTimeout(() => this.retryImageLoad(imageUrl, attempt + 1, cacheKey), delay);
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
            const cacheKey = this.generateCacheKey(imageUrl);
            this.loadImageWithProgress(imageUrl, cacheKey);
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
            const cacheKey = this.generateCacheKey(imageUrl);
            this.imageCache.delete(cacheKey);
            this.loadImageWithProgress(imageUrl, cacheKey);
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
                const cacheKey = this.generateCacheKey(imageUrl);
                this.imageCache.delete(cacheKey);
                this.loadImageWithProgress(imageUrl, cacheKey);
                return;
            }
        }
        
        // Update status with performance info including resolution mode and vegetation filter
        const cacheHitRate = this.cacheMetrics.hits / (this.cacheMetrics.hits + this.cacheMetrics.misses) * 100;
        const resolutionMode = this.useFullResolution ? 'Full' : '2x Downsampled';
        // When toggle is active (true), show "Automatic Vegetation Filter", when inactive (false), show nothing
        const filterMode = this.vegetationFilterAvailable && this.useVegetationFilter ? ', Automatic Vegetation Filter' : '';
        this.statusText.textContent = `Loaded: ${this.currentImageType}-event image (${resolutionMode}${filterMode}, Cache: ${cacheHitRate.toFixed(1)}%)`;
        
        // Only fit to view on first load or after resolution change
        if (this.isFirstLoad || this.wasResolutionChanged) {
            // Use a small delay to ensure the image is fully rendered
            setTimeout(() => {
                this.fitToView();
            }, 10);
            this.isFirstLoad = false;
            this.wasResolutionChanged = false;
        }
        
        // Update panorama highlight
        this.updatePanoramaHighlight();
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
        
        // Update metrics text with resolution mode and vegetation filter
        const resMode = this.useFullResolution ? 'Full' : '2x';
        const filterMode = this.vegetationFilterAvailable && this.useVegetationFilter ? ' AVF' : '';
        const modeText = `${resMode}${filterMode}`;
        this.metricsText.textContent = `Cache: ${cacheHitRate}% | Mem: ${memoryUsageMB}MB | ${this.imageCache.size}/${this.maxCacheSize} (${modeText})`;
        
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
        this.addToPreloadQueue(this.getImageUrl(currentDataset.preEvent), 1, 'current-pre');
        this.addToPreloadQueue(this.getImageUrl(currentDataset.postEvent), 1, 'current-post');
        this.addToPreloadQueue(this.getImageUrl(currentDataset.changeDetection), 1, 'current-change');
        
        // If vegetation filter is available, also preload the alternate filter variant for current dataset
        if (this.vegetationFilterAvailable && currentDataset.hasVegetationFilter) {
            const alternateFilterState = !this.useVegetationFilter;
            const originalState = this.useVegetationFilter;
            
            // Temporarily switch filter state to get alternate URLs
            this.useVegetationFilter = alternateFilterState;
            
            // Only preload alternate variants if they actually exist
            if (currentDataset.preEvent?.vegFilter) {
                this.addToPreloadQueue(this.getImageUrl(currentDataset.preEvent), 2, 'current-pre-alt-filter');
            }
            if (currentDataset.postEvent?.vegFilter) {
                this.addToPreloadQueue(this.getImageUrl(currentDataset.postEvent), 2, 'current-post-alt-filter');
            }
            if (currentDataset.changeDetection?.vegFilter) {
                this.addToPreloadQueue(this.getImageUrl(currentDataset.changeDetection), 2, 'current-change-alt-filter');
            }
            
            // Restore original state
            this.useVegetationFilter = originalState;
        }
        
        // Priority 3: Next dataset's current image type (navigation prediction)
        const nextDataset = this.datasets[nextIndex];
        const nextImageProperty = this.getImageProperty(this.currentImageType);
        const nextImageUrl = this.getImageUrl(nextDataset[nextImageProperty]);
        this.addToPreloadQueue(nextImageUrl, 3, 'next-current');
        
        // Priority 4: Previous dataset's current image type
        const prevDataset = this.datasets[prevIndex];
        const prevImageUrl = this.getImageUrl(prevDataset[nextImageProperty]);
        this.addToPreloadQueue(prevImageUrl, 4, 'prev-current');
        
        // Priority 5: Next dataset's other image types
        if (this.networkQuality === 'good') {
            this.addToPreloadQueue(this.getImageUrl(nextDataset.preEvent), 5, 'next-pre');
            this.addToPreloadQueue(this.getImageUrl(nextDataset.postEvent), 5, 'next-post');
            this.addToPreloadQueue(this.getImageUrl(nextDataset.changeDetection), 5, 'next-change');
        }
        
        // Priority 6: Adjacent datasets (if network is excellent)
        if (this.networkQuality === 'excellent' && this.datasets.length > 3) {
            const nextNextIndex = (this.currentDatasetIndex + 2) % this.datasets.length;
            const prevPrevIndex = (this.currentDatasetIndex - 2 + this.datasets.length) % this.datasets.length;
            
            const nextNextDataset = this.datasets[nextNextIndex];
            const prevPrevDataset = this.datasets[prevPrevIndex];
            
            const nextNextImageUrl = this.getImageUrl(nextNextDataset[nextImageProperty]);
            const prevPrevImageUrl = this.getImageUrl(prevPrevDataset[nextImageProperty]);
            
            this.addToPreloadQueue(nextNextImageUrl, 6, 'next-next');
            this.addToPreloadQueue(prevPrevImageUrl, 6, 'prev-prev');
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
        if (!imageUrl) {
            return;
        }
        
        // Generate cache key for this URL with current state
        const cacheKey = this.generateCacheKey(imageUrl);
        
        // Check if already cached or in preload queue
        if (this.imageCache.has(cacheKey) || this.preloadQueue.has(imageUrl)) {
            return;
        }
        
        this.preloadQueue.set(imageUrl, {
            priority,
            context,
            cacheKey,
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
        if (!this.preloadQueue.has(imageUrl)) return;
        
        const preloadInfo = this.preloadQueue.get(imageUrl);
        const cacheKey = preloadInfo.cacheKey;
        
        // Check if already cached with this key
        if (this.imageCache.has(cacheKey)) return;
        
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
                    this.addToCache(cacheKey, img, {
                        priority: preloadInfo.priority,
                        context: preloadInfo.context,
                        loadTime,
                        lastAccessed: Date.now(),
                        accessCount: 0,
                        blobUrl: img.dataset.blobUrl, // Track blob URL for cleanup
                        originalUrl: imageUrl // Store the original URL for reference
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
    
    addToCache(cacheKey, img, metadata = {}) {
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
        this.imageCache.set(cacheKey, cacheEntry);
        
        // Remove from cacheOrder if already exists (to avoid duplicates when re-accessing)
        const existingIndex = this.cacheOrder.indexOf(cacheKey);
        if (existingIndex !== -1) {
            this.cacheOrder.splice(existingIndex, 1);
        }
        
        // Add to end of queue (most recent)
        this.cacheOrder.push(cacheKey);
        
        this.updateMemoryMetrics();
    }
    
    performCircularBufferEviction() {
        // Simple circular buffer: when cache reaches limit, remove oldest image (FIFO)
        while (this.imageCache.size >= this.maxCacheSize && this.cacheOrder.length > 0) {
            const oldestKey = this.cacheOrder.shift(); // Remove first (oldest) entry
            const entry = this.imageCache.get(oldestKey);
            
            if (entry) {
                console.log(`Circular buffer evicting: ${oldestKey}`);
                
                // Clean up blob URLs when evicting
                if (entry.metadata?.blobUrl) {
                    URL.revokeObjectURL(entry.metadata.blobUrl);
                }
                if (entry.image?.src?.startsWith('blob:')) {
                    URL.revokeObjectURL(entry.image.src);
                }
                
                this.imageCache.delete(oldestKey);
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
            // Check vegetation filter availability for new dataset
            this.checkVegetationFilterAvailability();
            // No longer reset view when changing datasets - maintain zoom/pan
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
            // Check vegetation filter availability for new dataset
            this.checkVegetationFilterAvailability();
            // No longer reset view when changing datasets - maintain zoom/pan
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
            this.getImageUrl(currentDataset.preEvent),
            this.getImageUrl(currentDataset.postEvent),
            this.getImageUrl(currentDataset.changeDetection),
            this.getImageUrl(this.datasets[nextIndex]?.preEvent),
            this.getImageUrl(this.datasets[nextIndex]?.postEvent),
            this.getImageUrl(this.datasets[nextIndex]?.changeDetection),
            this.getImageUrl(this.datasets[prevIndex]?.preEvent),
            this.getImageUrl(this.datasets[prevIndex]?.postEvent),
            this.getImageUrl(this.datasets[prevIndex]?.changeDetection)
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
        const imgWidth = this.image.naturalWidth || this.image.width;
        const imgHeight = this.image.naturalHeight || this.image.height;
        
        // Ensure we have valid dimensions
        if (!imgWidth || !imgHeight || !viewerRect.width || !viewerRect.height) {
            console.warn('Cannot fit to view: invalid dimensions', {
                imgWidth, imgHeight, 
                viewerWidth: viewerRect.width, 
                viewerHeight: viewerRect.height
            });
            return;
        }
        
        const scaleX = viewerRect.width / imgWidth;
        const scaleY = viewerRect.height / imgHeight;
        
        // Use consistent scaling for both full resolution and downsampled images
        // Let the images display at their natural size relationship
        const baseScale = Math.min(scaleX, scaleY);
        
        this.scale = baseScale;
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
    
    handlePanoramaClick(e) {
        e.preventDefault();
        
        if (!this.boxMappings.length) {
            console.warn('Box mappings not loaded yet');
            return;
        }
        
        // Get click coordinates relative to the panorama image
        const rect = this.panoramaImageElement.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Convert to panorama coordinates (accounting for scaling)
        const scaleX = this.panoramaImage.width / rect.width;
        const scaleY = this.panoramaImage.height / rect.height;
        
        const panoramaX = clickX * scaleX;
        const panoramaY = clickY * scaleY;
        
        console.log(`Panorama click at: (${panoramaX.toFixed(1)}, ${panoramaY.toFixed(1)})`);
        
        // Find the closest image pair
        const closestMapping = this.findClosestImagePair(panoramaX, panoramaY);
        
        if (closestMapping) {
            console.log(`Closest image pair: ${closestMapping.numero} at (${closestMapping.x}, ${closestMapping.y})`);
            this.selectImagePair(closestMapping.numero);
        }
    }
    
    findClosestImagePair(x, y) {
        if (!this.boxMappings.length) return null;
        
        // First, try to find if click is within any box boundary
        let directMapping = this.findDirectBoxMapping(x, y);
        if (directMapping) {
            console.log(`Direct hit in box for image: ${directMapping.numero}`);
            return directMapping;
        }
        
        // If not in any box, find the closest box center
        let closestMapping = null;
        let minDistance = Infinity;
        
        for (const mapping of this.boxMappings) {
            // Calculate Euclidean distance from click point to box center
            const distance = Math.sqrt(
                Math.pow(x - mapping.x, 2) + Math.pow(y - mapping.y, 2)
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestMapping = mapping;
            }
        }
        
        console.log(`Found closest mapping at distance: ${minDistance.toFixed(1)}px`);
        return closestMapping;
    }
    
    findDirectBoxMapping(x, y) {
        // Check if click is within any box boundaries
        for (const mapping of this.boxMappings) {
            const boxLeft = mapping.x - this.boxDimensions.width / 2;
            const boxRight = mapping.x + this.boxDimensions.width / 2;
            const boxTop = mapping.y - this.boxDimensions.height / 2;
            const boxBottom = mapping.y + this.boxDimensions.height / 2;
            
            if (x >= boxLeft && x <= boxRight && y >= boxTop && y <= boxBottom) {
                return mapping;
            }
        }
        return null;
    }
    
    selectImagePair(imageNumber) {
        // Find the dataset index that corresponds to this image number
        const datasetIndex = this.datasets.findIndex(dataset => 
            parseInt(dataset.id) === imageNumber
        );
        
        if (datasetIndex !== -1 && datasetIndex !== this.currentDatasetIndex) {
            console.log(`Switching to image pair ${imageNumber} (dataset index ${datasetIndex})`);
            
            // Update current dataset index
            this.currentDatasetIndex = datasetIndex;
            
            // Update UI elements
            this.datasetSelect.value = this.currentDatasetIndex;
            this.updateDatasetCounter();
            
            // Check vegetation filter availability for new dataset
            this.checkVegetationFilterAvailability();
            
            // Load the new image (keeping current zoom/pan state)
            this.loadCurrentImage();
            
            // Visual feedback - briefly highlight the selected area
            this.highlightSelectedArea(imageNumber);
        } else if (datasetIndex === this.currentDatasetIndex) {
            console.log(`Already viewing image pair ${imageNumber}`);
            // Still provide visual feedback
            this.highlightSelectedArea(imageNumber);
        } else {
            console.warn(`Image pair ${imageNumber} not found in datasets`);
        }
    }
    
    highlightSelectedArea(imageNumber) {
        // Find the mapping for the selected image
        const mapping = this.boxMappings.find(m => m.numero === imageNumber);
        if (!mapping) return;
        
        // Create temporary highlight effect
        const highlight = document.createElement('div');
        highlight.style.cssText = `
            position: absolute;
            border: 3px solid #00ff00;
            background: rgba(0, 255, 0, 0.2);
            pointer-events: none;
            border-radius: 4px;
            z-index: 1000;
            animation: pulse 0.8s ease-in-out;
        `;
        
        // Calculate position and size relative to panorama container
        const panoramaRect = this.panoramaImageElement.getBoundingClientRect();
        const scaleX = panoramaRect.width / this.panoramaImage.width;
        const scaleY = panoramaRect.height / this.panoramaImage.height;
        
        const boxLeft = (mapping.x - this.boxDimensions.width / 2) * scaleX;
        const boxTop = (mapping.y - this.boxDimensions.height / 2) * scaleY;
        const boxWidth = this.boxDimensions.width * scaleX;
        const boxHeight = this.boxDimensions.height * scaleY;
        
        highlight.style.left = `${boxLeft}px`;
        highlight.style.top = `${boxTop}px`;
        highlight.style.width = `${boxWidth}px`;
        highlight.style.height = `${boxHeight}px`;
        
        // Add to panorama container
        const panoramaContainer = document.querySelector('.panorama-container');
        panoramaContainer.appendChild(highlight);
        
        // Remove after animation
        setTimeout(() => {
            if (highlight.parentNode) {
                highlight.parentNode.removeChild(highlight);
            }
        }, 800);
    }
    
    createPanoramaGridOverlay() {
        // Create a canvas overlay to show available click areas
        this.gridOverlay = document.createElement('canvas');
        this.gridOverlay.className = 'panorama-grid-overlay';
        this.gridOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 1;
        `;
        
        const panoramaContainer = document.querySelector('.panorama-container');
        panoramaContainer.appendChild(this.gridOverlay);
        
        // Set up canvas for grid drawing
        this.updateGridOverlay();
        
        // Show/hide grid on hover
        this.panoramaImageElement.addEventListener('mouseenter', () => {
            this.gridOverlay.style.opacity = '0.6';
        });
        
        this.panoramaImageElement.addEventListener('mouseleave', () => {
            this.gridOverlay.style.opacity = '0';
            this.clearHoverHighlight();
        });
        
        // Update grid on window resize
        window.addEventListener('resize', () => {
            clearTimeout(this.gridResizeTimeout);
            this.gridResizeTimeout = setTimeout(() => {
                this.updateGridOverlay();
            }, 100);
        });
    }
    
    updateGridOverlay() {
        if (!this.gridOverlay || !this.boxMappings.length) return;
        
        const panoramaRect = this.panoramaImageElement.getBoundingClientRect();
        const containerRect = document.querySelector('.panorama-container').getBoundingClientRect();
        
        // Set canvas size to match container
        this.gridOverlay.width = containerRect.width;
        this.gridOverlay.height = containerRect.height;
        
        const ctx = this.gridOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.gridOverlay.width, this.gridOverlay.height);
        
        // Calculate scaling factors
        const scaleX = panoramaRect.width / this.panoramaImage.width;
        const scaleY = panoramaRect.height / this.panoramaImage.height;
        
        // Draw subtle grid boxes for available areas
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        
        for (const mapping of this.boxMappings) {
            const boxLeft = (mapping.x - this.boxDimensions.width / 2) * scaleX;
            const boxTop = (mapping.y - this.boxDimensions.height / 2) * scaleY;
            const boxWidth = this.boxDimensions.width * scaleX;
            const boxHeight = this.boxDimensions.height * scaleY;
            
            ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight);
            
            // Add small dot at center
            ctx.save();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.arc(mapping.x * scaleX, mapping.y * scaleY, 1, 0, 2 * Math.PI);
            ctx.fill();
            ctx.restore();
        }
    }
    
    handlePanoramaMouseMove(e) {
        if (!this.boxMappings.length) return;
        
        // Get hover coordinates
        const rect = this.panoramaImageElement.getBoundingClientRect();
        const hoverX = e.clientX - rect.left;
        const hoverY = e.clientY - rect.top;
        
        // Convert to panorama coordinates
        const scaleX = this.panoramaImage.width / rect.width;
        const scaleY = this.panoramaImage.height / rect.height;
        
        const panoramaX = hoverX * scaleX;
        const panoramaY = hoverY * scaleY;
        
        // Find what would be selected
        const closestMapping = this.findClosestImagePair(panoramaX, panoramaY);
        
        if (closestMapping) {
            this.showHoverHighlight(closestMapping);
        }
    }
    
    showHoverHighlight(mapping) {
        this.clearHoverHighlight();
        
        // Create hover highlight
        this.hoverHighlight = document.createElement('div');
        this.hoverHighlight.style.cssText = `
            position: absolute;
            border: 2px solid rgba(0, 255, 0, 0.8);
            background: rgba(0, 255, 0, 0.1);
            pointer-events: none;
            border-radius: 3px;
            z-index: 2;
            transition: all 0.1s ease;
        `;
        
        // Calculate position and size
        const panoramaRect = this.panoramaImageElement.getBoundingClientRect();
        const scaleX = panoramaRect.width / this.panoramaImage.width;
        const scaleY = panoramaRect.height / this.panoramaImage.height;
        
        const boxLeft = (mapping.x - this.boxDimensions.width / 2) * scaleX;
        const boxTop = (mapping.y - this.boxDimensions.height / 2) * scaleY;
        const boxWidth = this.boxDimensions.width * scaleX;
        const boxHeight = this.boxDimensions.height * scaleY;
        
        this.hoverHighlight.style.left = `${boxLeft}px`;
        this.hoverHighlight.style.top = `${boxTop}px`;
        this.hoverHighlight.style.width = `${boxWidth}px`;
        this.hoverHighlight.style.height = `${boxHeight}px`;
        
        // Add tooltip showing image number
        this.hoverHighlight.title = `Image pair ${mapping.numero}`;
        
        const panoramaContainer = document.querySelector('.panorama-container');
        panoramaContainer.appendChild(this.hoverHighlight);
    }
    
    clearHoverHighlight() {
        if (this.hoverHighlight && this.hoverHighlight.parentNode) {
            this.hoverHighlight.parentNode.removeChild(this.hoverHighlight);
            this.hoverHighlight = null;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ImageViewer();
});