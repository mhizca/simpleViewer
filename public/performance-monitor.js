/**
 * Browser-based Performance Monitor for ImageViewer
 * Integrates with the existing ImageViewer class to provide detailed performance metrics
 * 
 * Features:
 * - Real-time performance tracking
 * - Core Web Vitals measurement (LCP, FID, CLS)
 * - Image loading performance analysis
 * - Cache efficiency monitoring
 * - Memory usage tracking
 * - Network timing analysis
 * - Progressive loading effectiveness
 * - Performance regression detection
 */

class PerformanceMonitor {
    constructor(imageViewer) {
        this.imageViewer = imageViewer;
        this.metrics = {
            coreWebVitals: {},
            imageLoadings: [],
            cacheStats: { hits: 0, misses: 0, hitRate: 0 },
            memoryUsage: [],
            networkTimings: [],
            userInteractions: [],
            progressiveLoadings: [],
            sessionStart: Date.now()
        };
        
        this.observers = new Map();
        this.isMonitoring = false;
        this.reportingInterval = null;
        this.memoryCheckInterval = null;
        
        // Performance thresholds (in milliseconds)
        this.thresholds = {
            imageLoad: 3000,      // Max acceptable image load time
            firstByte: 1000,      // Max acceptable TTFB
            cacheHit: 100,        // Max acceptable cache hit time
            memoryGrowth: 50,     // Max acceptable memory growth (MB)
            fps: 55,              // Min acceptable FPS
            largestContentfulPaint: 2500, // Core Web Vital threshold
            firstInputDelay: 100,         // Core Web Vital threshold
            cumulativeLayoutShift: 0.1    // Core Web Vital threshold
        };

        this.init();
    }

    init() {
        console.log('🔧 Initializing Performance Monitor');
        this.setupWebVitalsTracking();
        this.setupImageLoadTracking();
        this.setupNetworkTimingTracking();
        this.setupMemoryTracking();
        this.setupUserInteractionTracking();
        this.setupProgressiveLoadingTracking();
        this.setupPerformanceUI();
        
        // Hook into ImageViewer events
        this.integrateWithImageViewer();
        
        this.startMonitoring();
    }

    setupWebVitalsTracking() {
        // Track Largest Contentful Paint (LCP)
        if ('PerformanceObserver' in window) {
            try {
                const lcpObserver = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    const lastEntry = entries[entries.length - 1];
                    this.metrics.coreWebVitals.lcp = {
                        value: lastEntry.startTime,
                        element: lastEntry.element?.tagName || 'unknown',
                        timestamp: Date.now()
                    };
                    this.checkWebVitalThreshold('lcp', lastEntry.startTime);
                });
                lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
                this.observers.set('lcp', lcpObserver);
            } catch (e) {
                console.warn('LCP tracking not supported');
            }

            // Track First Input Delay (FID)
            try {
                const fidObserver = new PerformanceObserver((list) => {
                    const firstInput = list.getEntries()[0];
                    this.metrics.coreWebVitals.fid = {
                        value: firstInput.processingStart - firstInput.startTime,
                        inputType: firstInput.name,
                        timestamp: Date.now()
                    };
                    this.checkWebVitalThreshold('fid', firstInput.processingStart - firstInput.startTime);
                });
                fidObserver.observe({ entryTypes: ['first-input'] });
                this.observers.set('fid', fidObserver);
            } catch (e) {
                console.warn('FID tracking not supported');
            }

            // Track Cumulative Layout Shift (CLS)
            try {
                let clsValue = 0;
                const clsObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (!entry.hadRecentInput) {
                            clsValue += entry.value;
                        }
                    }
                    this.metrics.coreWebVitals.cls = {
                        value: clsValue,
                        timestamp: Date.now()
                    };
                    this.checkWebVitalThreshold('cls', clsValue);
                });
                clsObserver.observe({ entryTypes: ['layout-shift'] });
                this.observers.set('cls', clsObserver);
            } catch (e) {
                console.warn('CLS tracking not supported');
            }
        }
    }

    setupImageLoadTracking() {
        // Enhanced image load tracking
        const originalLoadImage = this.imageViewer.loadImageWithProgress;
        this.imageViewer.loadImageWithProgress = async function(imageUrl) {
            const monitor = this.performanceMonitor || window.performanceMonitor;
            const loadStart = performance.now();
            const loadStartTime = Date.now();
            
            // Track load start
            monitor.trackImageLoadStart(imageUrl, loadStart);
            
            try {
                const result = await originalLoadImage.call(this, imageUrl);
                
                // Track successful load
                const loadEnd = performance.now();
                monitor.trackImageLoadComplete(imageUrl, loadStart, loadEnd, false);
                
                return result;
            } catch (error) {
                // Track failed load
                const loadEnd = performance.now();
                monitor.trackImageLoadComplete(imageUrl, loadStart, loadEnd, true, error);
                throw error;
            }
        }.bind(this.imageViewer);
    }

    setupNetworkTimingTracking() {
        if ('PerformanceObserver' in window) {
            try {
                const networkObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.initiatorType === 'img' || entry.initiatorType === 'fetch') {
                            this.trackNetworkTiming(entry);
                        }
                    }
                });
                networkObserver.observe({ entryTypes: ['resource'] });
                this.observers.set('network', networkObserver);
            } catch (e) {
                console.warn('Network timing tracking not supported');
            }
        }
    }

    setupMemoryTracking() {
        if ('memory' in performance) {
            this.memoryCheckInterval = setInterval(() => {
                const memInfo = performance.memory;
                const memoryData = {
                    used: memInfo.usedJSHeapSize,
                    total: memInfo.totalJSHeapSize,
                    limit: memInfo.jsHeapSizeLimit,
                    timestamp: Date.now(),
                    utilizationPercent: (memInfo.usedJSHeapSize / memInfo.jsHeapSizeLimit) * 100
                };
                
                this.metrics.memoryUsage.push(memoryData);
                
                // Keep only last 100 measurements
                if (this.metrics.memoryUsage.length > 100) {
                    this.metrics.memoryUsage.shift();
                }
                
                // Check for memory issues
                this.checkMemoryHealth(memoryData);
            }, 5000); // Check every 5 seconds
        }
    }

    setupUserInteractionTracking() {
        const interactionTypes = ['click', 'keydown', 'touchstart', 'wheel'];
        
        interactionTypes.forEach(eventType => {
            document.addEventListener(eventType, (event) => {
                this.trackUserInteraction(eventType, event);
            }, { passive: true });
        });
    }

    setupProgressiveLoadingTracking() {
        // Hook into the existing progress loading functionality
        const originalUpdateProgress = this.imageViewer.updateLoadingProgress;
        this.imageViewer.updateLoadingProgress = function(progress, eta, speed, total) {
            const monitor = this.performanceMonitor || window.performanceMonitor;
            monitor.trackProgressiveLoading(progress, eta, speed, total);
            return originalUpdateProgress.call(this, progress, eta, speed, total);
        }.bind(this.imageViewer);
    }

    setupPerformanceUI() {
        // Create performance overlay
        this.createPerformanceOverlay();
        
        // Add keyboard shortcut to toggle performance overlay
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'P') {
                e.preventDefault();
                this.togglePerformanceOverlay();
            }
        });
    }

    integrateWithImageViewer() {
        // Store reference to performance monitor in ImageViewer
        this.imageViewer.performanceMonitor = this;
        
        // Hook into cache operations
        const originalAddToCache = this.imageViewer.addToCache;
        this.imageViewer.addToCache = function(imageUrl, img, metadata = {}) {
            const monitor = this.performanceMonitor;
            monitor.trackCacheOperation('add', imageUrl, metadata);
            return originalAddToCache.call(this, imageUrl, img, metadata);
        }.bind(this.imageViewer);

        // Hook into cache hits
        const originalLoadCurrentImage = this.imageViewer.loadCurrentImage;
        this.imageViewer.loadCurrentImage = async function() {
            const monitor = this.performanceMonitor;
            const loadStart = performance.now();
            
            // Get current image URL for tracking
            const dataset = this.datasets[this.currentDatasetIndex];
            let imageUrl;
            switch(this.currentImageType) {
                case 'pre': imageUrl = dataset?.preEvent; break;
                case 'post': imageUrl = dataset?.postEvent; break;
                case 'change': imageUrl = dataset?.changeDetection; break;
            }
            
            if (imageUrl && this.imageCache.has(imageUrl)) {
                monitor.trackCacheOperation('hit', imageUrl);
            } else if (imageUrl) {
                monitor.trackCacheOperation('miss', imageUrl);
            }
            
            return await originalLoadCurrentImage.call(this);
        }.bind(this.imageViewer);
    }

    trackImageLoadStart(imageUrl, startTime) {
        const loading = {
            url: imageUrl,
            startTime,
            startTimestamp: Date.now(),
            fileName: imageUrl.split('/').pop(),
            stage: 'loading'
        };
        
        this.metrics.imageLoadings.push(loading);
        this.updatePerformanceUI('imageLoadStart', loading);
    }

    trackImageLoadComplete(imageUrl, startTime, endTime, failed = false, error = null) {
        const loadTime = endTime - startTime;
        const loading = this.metrics.imageLoadings.find(l => l.url === imageUrl && l.stage === 'loading');
        
        if (loading) {
            loading.endTime = endTime;
            loading.loadTime = loadTime;
            loading.failed = failed;
            loading.error = error?.message;
            loading.stage = 'complete';
            loading.endTimestamp = Date.now();
            
            // Performance analysis
            loading.performance = this.analyzeImageLoadPerformance(loading);
            
            this.updatePerformanceUI('imageLoadComplete', loading);
            
            // Check against thresholds
            if (loadTime > this.thresholds.imageLoad) {
                this.reportPerformanceIssue('slow-image-load', {
                    url: imageUrl,
                    loadTime,
                    threshold: this.thresholds.imageLoad
                });
            }
        }
    }

    trackNetworkTiming(entry) {
        const timing = {
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize,
            timing: {
                dns: entry.domainLookupEnd - entry.domainLookupStart,
                connect: entry.connectEnd - entry.connectStart,
                tls: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
                ttfb: entry.responseStart - entry.requestStart,
                download: entry.responseEnd - entry.responseStart
            },
            timestamp: Date.now()
        };
        
        this.metrics.networkTimings.push(timing);
        
        // Keep only last 50 network timings
        if (this.metrics.networkTimings.length > 50) {
            this.metrics.networkTimings.shift();
        }
        
        // Check TTFB threshold
        if (timing.timing.ttfb > this.thresholds.firstByte) {
            this.reportPerformanceIssue('slow-ttfb', {
                url: entry.name,
                ttfb: timing.timing.ttfb,
                threshold: this.thresholds.firstByte
            });
        }
        
        this.updatePerformanceUI('networkTiming', timing);
    }

    trackCacheOperation(operation, imageUrl, metadata = {}) {
        if (operation === 'hit') {
            this.metrics.cacheStats.hits++;
        } else if (operation === 'miss') {
            this.metrics.cacheStats.misses++;
        }
        
        this.metrics.cacheStats.hitRate = this.metrics.cacheStats.hits / 
            (this.metrics.cacheStats.hits + this.metrics.cacheStats.misses) * 100;
        
        this.updatePerformanceUI('cacheStats', this.metrics.cacheStats);
    }

    trackUserInteraction(type, event) {
        const interaction = {
            type,
            timestamp: Date.now(),
            target: event.target?.tagName || 'unknown',
            performanceNow: performance.now()
        };
        
        this.metrics.userInteractions.push(interaction);
        
        // Keep only last 20 interactions
        if (this.metrics.userInteractions.length > 20) {
            this.metrics.userInteractions.shift();
        }
    }

    trackProgressiveLoading(progress, eta, speed, total) {
        const progressData = {
            progress,
            eta,
            speed,
            total,
            timestamp: Date.now(),
            speedMBps: speed / (1024 * 1024)
        };
        
        this.metrics.progressiveLoadings.push(progressData);
        
        // Keep only last 20 progress updates
        if (this.metrics.progressiveLoadings.length > 20) {
            this.metrics.progressiveLoadings.shift();
        }
        
        this.updatePerformanceUI('progressiveLoading', progressData);
    }

    analyzeImageLoadPerformance(loading) {
        const analysis = {
            rating: 'good',
            issues: [],
            recommendations: []
        };
        
        // Analyze load time
        if (loading.loadTime > this.thresholds.imageLoad) {
            analysis.rating = 'poor';
            analysis.issues.push('slow-load');
            analysis.recommendations.push('Consider image compression or CDN');
        } else if (loading.loadTime > this.thresholds.imageLoad * 0.7) {
            analysis.rating = 'needs-improvement';
            analysis.issues.push('moderate-load');
        }
        
        // Check if it was a cache hit (should be very fast)
        const wasFromCache = loading.loadTime < this.thresholds.cacheHit;
        if (wasFromCache) {
            analysis.cached = true;
        }
        
        return analysis;
    }

    checkWebVitalThreshold(vital, value) {
        let threshold, rating;
        
        switch (vital) {
            case 'lcp':
                threshold = this.thresholds.largestContentfulPaint;
                rating = value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor';
                break;
            case 'fid':
                threshold = this.thresholds.firstInputDelay;
                rating = value <= 100 ? 'good' : value <= 300 ? 'needs-improvement' : 'poor';
                break;
            case 'cls':
                threshold = this.thresholds.cumulativeLayoutShift;
                rating = value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor';
                break;
        }
        
        this.metrics.coreWebVitals[vital].rating = rating;
        
        if (rating === 'poor') {
            this.reportPerformanceIssue(`poor-${vital}`, {
                vital,
                value,
                threshold,
                rating
            });
        }
    }

    checkMemoryHealth(memoryData) {
        const utilizationThreshold = 80; // 80% utilization
        const growthThreshold = this.thresholds.memoryGrowth * 1024 * 1024; // Convert to bytes
        
        if (memoryData.utilizationPercent > utilizationThreshold) {
            this.reportPerformanceIssue('high-memory-usage', {
                utilization: memoryData.utilizationPercent,
                threshold: utilizationThreshold
            });
        }
        
        // Check for rapid memory growth
        if (this.metrics.memoryUsage.length > 5) {
            const recent = this.metrics.memoryUsage.slice(-5);
            const growth = recent[4].used - recent[0].used;
            const timeSpan = recent[4].timestamp - recent[0].timestamp;
            
            if (growth > growthThreshold && timeSpan < 30000) { // 30 seconds
                this.reportPerformanceIssue('rapid-memory-growth', {
                    growth: growth / 1024 / 1024,
                    timeSpan: timeSpan / 1000,
                    threshold: this.thresholds.memoryGrowth
                });
            }
        }
    }

    reportPerformanceIssue(type, data) {
        console.warn(`⚠️ Performance Issue (${type}):`, data);
        
        // Store in session metrics for reporting
        if (!this.metrics.issues) {
            this.metrics.issues = [];
        }
        
        this.metrics.issues.push({
            type,
            data,
            timestamp: Date.now()
        });
        
        // Update UI to show issue
        this.updatePerformanceUI('issue', { type, data });
    }

    createPerformanceOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'performance-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            width: 350px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            z-index: 10000;
            display: none;
            max-height: 70vh;
            overflow-y: auto;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;
        
        overlay.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #4CAF50;">Performance Monitor</h3>
                <button id="close-perf-overlay" style="background: none; border: none; color: white; cursor: pointer; font-size: 16px;">×</button>
            </div>
            <div id="perf-content">
                <div id="core-web-vitals">
                    <h4 style="margin: 5px 0; color: #2196F3;">Core Web Vitals</h4>
                    <div id="lcp-metric">LCP: <span>-</span></div>
                    <div id="fid-metric">FID: <span>-</span></div>
                    <div id="cls-metric">CLS: <span>-</span></div>
                </div>
                
                <div id="image-performance">
                    <h4 style="margin: 5px 0; color: #FF9800;">Image Performance</h4>
                    <div id="current-load">Current: <span>-</span></div>
                    <div id="avg-load-time">Avg Load: <span>-</span></div>
                    <div id="cache-hit-rate">Cache Hit Rate: <span>-</span></div>
                </div>
                
                <div id="memory-usage">
                    <h4 style="margin: 5px 0; color: #9C27B0;">Memory Usage</h4>
                    <div id="heap-used">Heap Used: <span>-</span></div>
                    <div id="heap-utilization">Utilization: <span>-</span></div>
                </div>
                
                <div id="network-performance">
                    <h4 style="margin: 5px 0; color: #00BCD4;">Network</h4>
                    <div id="avg-ttfb">Avg TTFB: <span>-</span></div>
                    <div id="avg-download">Avg Download: <span>-</span></div>
                </div>
                
                <div id="performance-issues">
                    <h4 style="margin: 5px 0; color: #F44336;">Recent Issues</h4>
                    <div id="issues-list" style="max-height: 100px; overflow-y: auto;">No issues</div>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Close button handler
        document.getElementById('close-perf-overlay').addEventListener('click', () => {
            overlay.style.display = 'none';
        });
        
        this.performanceOverlay = overlay;
    }

    togglePerformanceOverlay() {
        if (this.performanceOverlay) {
            const isVisible = this.performanceOverlay.style.display !== 'none';
            this.performanceOverlay.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Refresh data when showing
                this.updatePerformanceOverlay();
            }
        }
    }

    updatePerformanceUI(eventType, data) {
        // Update the existing performance indicator
        if (this.imageViewer.performanceIndicator) {
            this.updateExistingIndicator();
        }
        
        // Update overlay if visible
        if (this.performanceOverlay && this.performanceOverlay.style.display !== 'none') {
            this.updatePerformanceOverlay();
        }
    }

    updateExistingIndicator() {
        // Update the existing performance indicator with our enhanced metrics
        const hitRate = this.metrics.cacheStats.hitRate || 0;
        const memoryUsage = this.metrics.memoryUsage.length > 0 ? 
            this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1].used / 1024 / 1024 : 0;
        
        if (this.imageViewer.metricsText) {
            this.imageViewer.metricsText.textContent = 
                `Cache: ${hitRate.toFixed(0)}% | Mem: ${memoryUsage.toFixed(1)}MB | ${this.metrics.imageLoadings.length} loads`;
        }
        
        // Update network quality based on recent timings
        if (this.metrics.networkTimings.length > 0) {
            const recentTimings = this.metrics.networkTimings.slice(-5);
            const avgTTFB = recentTimings.reduce((sum, t) => sum + t.timing.ttfb, 0) / recentTimings.length;
            
            let quality = 'excellent';
            if (avgTTFB > 2000) quality = 'poor';
            else if (avgTTFB > 1000) quality = 'fair';
            else if (avgTTFB > 500) quality = 'good';
            
            if (this.imageViewer.networkQualityDot) {
                this.imageViewer.networkQualityDot.className = `network-quality ${quality}`;
            }
        }
    }

    updatePerformanceOverlay() {
        if (!this.performanceOverlay) return;
        
        // Update Core Web Vitals
        if (this.metrics.coreWebVitals.lcp) {
            document.getElementById('lcp-metric').innerHTML = 
                `LCP: <span style="color: ${this.getVitalColor(this.metrics.coreWebVitals.lcp.rating)}">${this.metrics.coreWebVitals.lcp.value.toFixed(0)}ms</span>`;
        }
        if (this.metrics.coreWebVitals.fid) {
            document.getElementById('fid-metric').innerHTML = 
                `FID: <span style="color: ${this.getVitalColor(this.metrics.coreWebVitals.fid.rating)}">${this.metrics.coreWebVitals.fid.value.toFixed(0)}ms</span>`;
        }
        if (this.metrics.coreWebVitals.cls) {
            document.getElementById('cls-metric').innerHTML = 
                `CLS: <span style="color: ${this.getVitalColor(this.metrics.coreWebVitals.cls.rating)}">${this.metrics.coreWebVitals.cls.value.toFixed(3)}</span>`;
        }
        
        // Update Image Performance
        const completedLoads = this.metrics.imageLoadings.filter(l => l.stage === 'complete' && !l.failed);
        if (completedLoads.length > 0) {
            const avgLoadTime = completedLoads.reduce((sum, l) => sum + l.loadTime, 0) / completedLoads.length;
            const currentLoad = completedLoads[completedLoads.length - 1];
            
            document.getElementById('current-load').innerHTML = 
                `Current: <span>${currentLoad.loadTime.toFixed(0)}ms</span>`;
            document.getElementById('avg-load-time').innerHTML = 
                `Avg Load: <span>${avgLoadTime.toFixed(0)}ms</span>`;
        }
        
        document.getElementById('cache-hit-rate').innerHTML = 
            `Cache Hit Rate: <span>${this.metrics.cacheStats.hitRate.toFixed(1)}%</span>`;
        
        // Update Memory Usage
        if (this.metrics.memoryUsage.length > 0) {
            const latestMemory = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1];
            document.getElementById('heap-used').innerHTML = 
                `Heap Used: <span>${(latestMemory.used / 1024 / 1024).toFixed(1)}MB</span>`;
            document.getElementById('heap-utilization').innerHTML = 
                `Utilization: <span style="color: ${latestMemory.utilizationPercent > 80 ? '#F44336' : '#4CAF50'}">${latestMemory.utilizationPercent.toFixed(1)}%</span>`;
        }
        
        // Update Network Performance
        if (this.metrics.networkTimings.length > 0) {
            const recentTimings = this.metrics.networkTimings.slice(-10);
            const avgTTFB = recentTimings.reduce((sum, t) => sum + t.timing.ttfb, 0) / recentTimings.length;
            const avgDownload = recentTimings.reduce((sum, t) => sum + t.timing.download, 0) / recentTimings.length;
            
            document.getElementById('avg-ttfb').innerHTML = 
                `Avg TTFB: <span>${avgTTFB.toFixed(0)}ms</span>`;
            document.getElementById('avg-download').innerHTML = 
                `Avg Download: <span>${avgDownload.toFixed(0)}ms</span>`;
        }
        
        // Update Issues
        const issuesList = document.getElementById('issues-list');
        if (this.metrics.issues && this.metrics.issues.length > 0) {
            const recentIssues = this.metrics.issues.slice(-5);
            issuesList.innerHTML = recentIssues.map(issue => 
                `<div style="font-size: 10px; margin: 2px 0; color: #F44336;">${issue.type}: ${JSON.stringify(issue.data).substring(0, 50)}...</div>`
            ).join('');
        } else {
            issuesList.innerHTML = '<div style="color: #4CAF50;">No issues</div>';
        }
    }

    getVitalColor(rating) {
        switch (rating) {
            case 'good': return '#4CAF50';
            case 'needs-improvement': return '#FF9800';
            case 'poor': return '#F44336';
            default: return '#999';
        }
    }

    startMonitoring() {
        if (this.isMonitoring) return;
        
        this.isMonitoring = true;
        console.log('✅ Performance monitoring started');
        
        // Start periodic reporting
        this.reportingInterval = setInterval(() => {
            this.generatePerformanceReport();
        }, 30000); // Report every 30 seconds
        
        // Log session start
        console.log('📊 Performance Monitor Session Started');
        console.log('   Press Ctrl+Shift+P to toggle performance overlay');
    }

    stopMonitoring() {
        if (!this.isMonitoring) return;
        
        this.isMonitoring = false;
        
        // Clear intervals
        if (this.reportingInterval) {
            clearInterval(this.reportingInterval);
            this.reportingInterval = null;
        }
        
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
            this.memoryCheckInterval = null;
        }
        
        // Disconnect observers
        for (const [name, observer] of this.observers) {
            observer.disconnect();
        }
        this.observers.clear();
        
        console.log('🔌 Performance monitoring stopped');
    }

    generatePerformanceReport() {
        const sessionDuration = (Date.now() - this.metrics.sessionStart) / 1000 / 60; // minutes
        const completedLoads = this.metrics.imageLoadings.filter(l => l.stage === 'complete' && !l.failed);
        
        const report = {
            session: {
                duration: sessionDuration.toFixed(1) + ' minutes',
                totalImageLoads: this.metrics.imageLoadings.length,
                successfulLoads: completedLoads.length,
                failedLoads: this.metrics.imageLoadings.filter(l => l.failed).length
            },
            performance: {
                avgImageLoadTime: completedLoads.length > 0 ? 
                    (completedLoads.reduce((sum, l) => sum + l.loadTime, 0) / completedLoads.length).toFixed(0) + 'ms' : 'N/A',
                cacheHitRate: this.metrics.cacheStats.hitRate.toFixed(1) + '%',
                memoryUsage: this.metrics.memoryUsage.length > 0 ? 
                    (this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1].used / 1024 / 1024).toFixed(1) + 'MB' : 'N/A'
            },
            coreWebVitals: {
                lcp: this.metrics.coreWebVitals.lcp ? 
                    `${this.metrics.coreWebVitals.lcp.value.toFixed(0)}ms (${this.metrics.coreWebVitals.lcp.rating})` : 'N/A',
                fid: this.metrics.coreWebVitals.fid ? 
                    `${this.metrics.coreWebVitals.fid.value.toFixed(0)}ms (${this.metrics.coreWebVitals.fid.rating})` : 'N/A',
                cls: this.metrics.coreWebVitals.cls ? 
                    `${this.metrics.coreWebVitals.cls.value.toFixed(3)} (${this.metrics.coreWebVitals.cls.rating})` : 'N/A'
            },
            issues: this.metrics.issues ? this.metrics.issues.length : 0
        };
        
        console.group('📊 Performance Report');
        console.table(report.session);
        console.table(report.performance);
        console.table(report.coreWebVitals);
        if (report.issues > 0) {
            console.warn(`⚠️ ${report.issues} performance issues detected`);
        }
        console.groupEnd();
    }

    exportMetrics() {
        const exportData = {
            ...this.metrics,
            sessionDuration: Date.now() - this.metrics.sessionStart,
            exportTimestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            }
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `performance-metrics-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('📁 Performance metrics exported');
    }

    // Public API
    getMetrics() {
        return { ...this.metrics };
    }

    reset() {
        this.metrics = {
            coreWebVitals: {},
            imageLoadings: [],
            cacheStats: { hits: 0, misses: 0, hitRate: 0 },
            memoryUsage: [],
            networkTimings: [],
            userInteractions: [],
            progressiveLoadings: [],
            sessionStart: Date.now()
        };
        
        console.log('🔄 Performance metrics reset');
    }
}

// Auto-initialize when ImageViewer is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for ImageViewer to be initialized
    const checkImageViewer = () => {
        if (window.imageViewer || (window.ImageViewer && document.querySelector('.image-viewer'))) {
            const viewer = window.imageViewer || new ImageViewer();
            window.performanceMonitor = new PerformanceMonitor(viewer);
            
            // Make it globally accessible for debugging
            window.exportPerformanceMetrics = () => window.performanceMonitor.exportMetrics();
            window.resetPerformanceMetrics = () => window.performanceMonitor.reset();
            
            console.log('🚀 Performance Monitor initialized');
            console.log('   Available commands: exportPerformanceMetrics(), resetPerformanceMetrics()');
        } else {
            setTimeout(checkImageViewer, 100);
        }
    };
    
    checkImageViewer();
});