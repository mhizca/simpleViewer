/**
 * Memory Leak Test for ImageViewer
 * 
 * This test simulates the freezing scenario by loading multiple images
 * and monitoring memory usage to verify that the memory leaks are fixed
 */

// Memory monitoring utilities
function getMemoryUsage() {
    if ('memory' in performance) {
        return {
            used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
            total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
            limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
        };
    }
    return null;
}

function logMemoryState(phase) {
    const memory = getMemoryUsage();
    if (memory) {
        console.log(`${phase}: ${memory.used}MB used, ${memory.total}MB total (${((memory.used/memory.limit)*100).toFixed(1)}% of limit)`);
        return memory;
    }
    return null;
}

// Test configuration
const TEST_CONFIG = {
    imageLoadDelay: 2000, // ms between image loads
    maxImages: 15, // Load more than the freezing threshold
    memoryCheckInterval: 1000, // ms
    maxMemoryGrowth: 100 // MB - fail test if memory grows more than this
};

class MemoryLeakTest {
    constructor() {
        this.testResults = {
            startTime: Date.now(),
            startMemory: null,
            peakMemory: null,
            endMemory: null,
            memoryHistory: [],
            errors: [],
            cacheStats: [],
            passed: false
        };
        this.imageViewer = null;
        this.testInterval = null;
        this.imageLoadCount = 0;
    }

    async runTest() {
        console.log('🧪 Starting Memory Leak Test');
        console.log(`Configuration: ${TEST_CONFIG.maxImages} images, ${TEST_CONFIG.imageLoadDelay}ms delay`);
        
        try {
            await this.initializeTest();
            await this.performImageLoadTest();
            await this.analyzeResults();
        } catch (error) {
            console.error('❌ Test failed with error:', error);
            this.testResults.errors.push(error.message);
        } finally {
            this.cleanup();
        }
        
        return this.testResults;
    }

    async initializeTest() {
        // Record initial memory state
        this.testResults.startMemory = logMemoryState('Test Start');
        
        // Wait for ImageViewer to be ready
        await this.waitForImageViewer();
        
        // Start memory monitoring
        this.startMemoryMonitoring();
        
        console.log('✅ Test initialization complete');
    }

    async waitForImageViewer() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('ImageViewer not found')), 10000);
            
            const checkViewer = () => {
                if (window.imageViewer || document.querySelector('.image-viewer')) {
                    clearTimeout(timeout);
                    this.imageViewer = window.imageViewer;
                    resolve();
                } else {
                    setTimeout(checkViewer, 100);
                }
            };
            
            checkViewer();
        });
    }

    startMemoryMonitoring() {
        this.testInterval = setInterval(() => {
            const memory = getMemoryUsage();
            if (memory) {
                this.testResults.memoryHistory.push({
                    timestamp: Date.now(),
                    ...memory
                });
                
                // Track peak memory
                if (!this.testResults.peakMemory || memory.used > this.testResults.peakMemory.used) {
                    this.testResults.peakMemory = memory;
                }
                
                // Record cache stats if available
                if (this.imageViewer && this.imageViewer.imageCache) {
                    this.testResults.cacheStats.push({
                        timestamp: Date.now(),
                        cacheSize: this.imageViewer.imageCache.size,
                        preloadControllers: this.imageViewer.preloadAbortControllers.size,
                        estimatedMemory: Math.round(this.imageViewer.estimateMemoryUsage() / 1024 / 1024)
                    });
                }
            }
        }, TEST_CONFIG.memoryCheckInterval);
    }

    async performImageLoadTest() {
        console.log('🖼️ Starting image load test...');
        
        for (let i = 0; i < TEST_CONFIG.maxImages; i++) {
            console.log(`Loading image ${i + 1}/${TEST_CONFIG.maxImages}`);
            
            try {
                // Navigate to next image
                if (this.imageViewer && typeof this.imageViewer.nextDataset === 'function') {
                    this.imageViewer.nextDataset();
                } else {
                    // Fallback: trigger navigation via button click
                    const nextBtn = document.getElementById('nextDataset');
                    if (nextBtn) {
                        nextBtn.click();
                    }
                }
                
                this.imageLoadCount++;
                
                // Wait for image to load
                await this.waitForImageLoad();
                
                // Add delay between loads
                await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.imageLoadDelay));
                
                // Check for critical memory usage
                const currentMemory = getMemoryUsage();
                if (currentMemory && currentMemory.used > currentMemory.limit * 0.9) {
                    console.warn(`⚠️ Critical memory usage detected at image ${i + 1}: ${currentMemory.used}MB`);
                }
                
            } catch (error) {
                console.error(`Error loading image ${i + 1}:`, error);
                this.testResults.errors.push(`Image ${i + 1}: ${error.message}`);
            }
        }
        
        console.log(`✅ Completed loading ${this.imageLoadCount} images`);
    }

    async waitForImageLoad() {
        return new Promise((resolve) => {
            // Wait for loading indicator to disappear or timeout
            const timeout = setTimeout(resolve, 5000);
            
            const checkLoading = () => {
                const loadingIndicator = document.getElementById('loadingIndicator');
                if (!loadingIndicator || loadingIndicator.style.display === 'none') {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(checkLoading, 100);
                }
            };
            
            checkLoading();
        });
    }

    async analyzeResults() {
        console.log('📊 Analyzing test results...');
        
        this.testResults.endMemory = logMemoryState('Test End');
        
        // Calculate memory growth
        const memoryGrowth = this.testResults.endMemory.used - this.testResults.startMemory.used;
        const peakGrowth = this.testResults.peakMemory.used - this.testResults.startMemory.used;
        
        console.log(`📈 Memory Analysis:`);
        console.log(`   Total Growth: ${memoryGrowth}MB`);
        console.log(`   Peak Growth: ${peakGrowth}MB`);
        console.log(`   Images Loaded: ${this.imageLoadCount}`);
        console.log(`   Memory per Image: ${(memoryGrowth / this.imageLoadCount).toFixed(1)}MB`);
        
        // Check cache effectiveness
        if (this.testResults.cacheStats.length > 0) {
            const finalCacheStats = this.testResults.cacheStats[this.testResults.cacheStats.length - 1];
            console.log(`🗂️ Cache Stats:`);
            console.log(`   Final Cache Size: ${finalCacheStats.cacheSize}`);
            console.log(`   Active Preloads: ${finalCacheStats.preloadControllers}`);
            console.log(`   Estimated Cache Memory: ${finalCacheStats.estimatedMemory}MB`);
        }
        
        // Determine if test passed
        this.testResults.passed = this.evaluateTestResults(memoryGrowth, peakGrowth);
        
        if (this.testResults.passed) {
            console.log('✅ MEMORY LEAK TEST PASSED - No significant memory leaks detected');
        } else {
            console.log('❌ MEMORY LEAK TEST FAILED - Memory growth exceeds threshold');
        }
    }

    evaluateTestResults(memoryGrowth, peakGrowth) {
        // Test passes if:
        // 1. Memory growth is reasonable (< 100MB for 15 images)
        // 2. No errors occurred during loading
        // 3. Cache is working effectively
        
        const criteriaResults = {
            memoryGrowthOK: memoryGrowth < TEST_CONFIG.maxMemoryGrowth,
            peakMemoryOK: peakGrowth < TEST_CONFIG.maxMemoryGrowth * 1.5,
            noErrors: this.testResults.errors.length === 0,
            allImagesLoaded: this.imageLoadCount >= TEST_CONFIG.maxImages * 0.8 // Allow some failures
        };
        
        console.log('🎯 Test Criteria:');
        Object.entries(criteriaResults).forEach(([criterion, passed]) => {
            console.log(`   ${criterion}: ${passed ? '✅' : '❌'}`);
        });
        
        return Object.values(criteriaResults).every(Boolean);
    }

    cleanup() {
        if (this.testInterval) {
            clearInterval(this.testInterval);
            this.testInterval = null;
        }
        
        // Trigger cleanup on ImageViewer if available
        if (this.imageViewer && typeof this.imageViewer.cleanup === 'function') {
            this.imageViewer.cleanup();
        }
        
        console.log('🧹 Test cleanup completed');
    }

    exportResults() {
        const exportData = {
            ...this.testResults,
            testConfig: TEST_CONFIG,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `memory-test-results-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('📁 Test results exported');
    }
}

// Auto-run test when page loads
window.addEventListener('load', async () => {
    // Wait a bit for everything to initialize
    setTimeout(async () => {
        console.log('🚀 Auto-starting memory leak test...');
        
        const test = new MemoryLeakTest();
        const results = await test.runTest();
        
        // Make results available globally
        window.memoryTestResults = results;
        window.exportMemoryTestResults = () => test.exportResults();
        
        console.log('🎯 Memory test completed. Results available in window.memoryTestResults');
        console.log('📁 Export results with: exportMemoryTestResults()');
        
    }, 3000); // 3 second delay
});

// Expose test class globally for manual testing
window.MemoryLeakTest = MemoryLeakTest;