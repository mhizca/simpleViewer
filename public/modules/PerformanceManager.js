/**
 * Performance monitoring and network quality management
 */
export class PerformanceManager {
    constructor() {
        this.cacheMetrics = {
            hits: 0,
            misses: 0,
            totalLoadTime: 0,
            averageLoadTime: 0,
            totalMemoryUsed: 0,
            lastMemoryCheck: Date.now()
        };
        this.networkQuality = 'good';
        this.loadStartTimes = new Map();
        this.performanceObserver = null;
        this.maxMemoryMB = 500;
        
        this.init();
    }

    init() {
        this.setupPerformanceMonitoring();
    }

    setupPerformanceMonitoring() {
        // Monitor memory usage periodically
        setInterval(() => {
            this.monitorMemoryUsage();
        }, 30000);
        
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
        
        // Log performance metrics periodically
        setInterval(() => {
            this.logPerformanceReport();
        }, 60000);
    }

    monitorMemoryUsage() {
        const memoryUsage = this.estimateMemoryUsage();
        const memoryUsageMB = memoryUsage / (1024 * 1024);
        
        if (memoryUsageMB > this.maxMemoryMB * 0.8) {
            console.warn(`High memory usage detected: ${memoryUsageMB.toFixed(1)}MB`);
            // Emit event for aggressive cleanup
            this.emit('aggressive-cleanup-needed');
        }
        
        if ('memory' in performance) {
            const browserMemory = performance.memory;
            if (browserMemory.usedJSHeapSize > browserMemory.jsHeapSizeLimit * 0.9) {
                console.warn('Browser memory limit approaching, performing cleanup');
                this.emit('aggressive-cleanup-needed');
            }
        }
    }

    recordNetworkTiming(entry) {
        const timing = {
            duration: entry.duration,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize,
            timestamp: entry.startTime
        };
        
        if (timing.transferSize > 0 && timing.duration > 0) {
            const speed = timing.transferSize / timing.duration;
            const speedMBps = speed / 1024;
            
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

    updateNetworkQuality(loadTime) {
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

    recordCacheHit() {
        this.cacheMetrics.hits++;
    }

    recordCacheMiss() {
        this.cacheMetrics.misses++;
    }

    recordLoadTime(loadTime) {
        this.cacheMetrics.totalLoadTime += loadTime;
        if (this.cacheMetrics.misses > 0) {
            this.cacheMetrics.averageLoadTime = this.cacheMetrics.totalLoadTime / this.cacheMetrics.misses;
        }
    }

    updateMemoryMetrics(totalMemoryUsed) {
        this.cacheMetrics.totalMemoryUsed = totalMemoryUsed;
        this.cacheMetrics.lastMemoryCheck = Date.now();
    }

    estimateMemoryUsage() {
        return this.cacheMetrics.totalMemoryUsed;
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
                estimatedMemoryMB: (this.cacheMetrics.totalMemoryUsed / 1024 / 1024).toFixed(1) + 'MB',
                maxMemoryMB: this.maxMemoryMB + 'MB'
            },
            networkQuality: this.networkQuality
        };
        
        console.group('=€ ImageViewer Performance Report');
        console.table(report.cachePerformance);
        console.table(report.memoryUsage);
        console.log('Network Quality:', report.networkQuality);
        console.groupEnd();
    }

    getNetworkQuality() {
        return this.networkQuality;
    }

    getCacheMetrics() {
        return { ...this.cacheMetrics };
    }

    calculateRetryDelay(attempt) {
        const baseDelay = this.networkQuality === 'poor' ? 2000 : 
                         this.networkQuality === 'fair' ? 1000 : 500;
        
        return Math.min(baseDelay * Math.pow(1.5, attempt - 1), 8000);
    }

    getMaxRetryAttempts() {
        return this.networkQuality === 'poor' ? 5 : 3;
    }

    cleanup() {
        if (this.performanceObserver) {
            this.performanceObserver.disconnect();
        }
        this.loadStartTimes.clear();
    }

    // Simple event emitter functionality
    emit(event, data) {
        if (this.listeners && this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }

    on(event, callback) {
        if (!this.listeners) {
            this.listeners = {};
        }
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }
}