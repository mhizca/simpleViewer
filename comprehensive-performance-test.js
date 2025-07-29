#!/usr/bin/env node

/**
 * Comprehensive Performance Testing Script for Image Viewer
 * Tests both server performance and simulates frontend behavior
 * 
 * Features:
 * - Server performance metrics (response times, cache hits, concurrent handling)
 * - Memory usage monitoring
 * - Range request performance testing
 * - Cache efficiency analysis
 * - Network simulation with different connection speeds
 * - Progressive loading simulation
 * - Detailed bottleneck identification
 */

const http = require('http');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const CONFIG = {
    host: 'localhost',
    port: 3000,
    testDuration: 60000, // 1 minute test
    warmupDuration: 10000, // 10 second warmup
    concurrentUsers: [1, 5, 10, 20, 50], // Progressive load testing
    networkProfiles: {
        fast: { delay: 0, bandwidth: Infinity },
        3g: { delay: 100, bandwidth: 1.6 * 1024 * 1024 }, // 1.6 Mbps
        4g: { delay: 50, bandwidth: 10 * 1024 * 1024 }, // 10 Mbps
        wifi: { delay: 10, bandwidth: 50 * 1024 * 1024 }, // 50 Mbps
    },
    testImages: [
        '/api/image/analysis/1/DJI_20250520101901_0001.JPG',
        '/api/image/analysis/1/DJI_20250726105126_0001.JPG',
        '/api/image/analysis/1/SSI_coeff_DJI_20250726105126_0001__vs__DJI_20250520101901_0001.jpg'
    ],
    rangeRequestSizes: [64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024] // Different chunk sizes
};

class ComprehensivePerformanceTester {
    constructor() {
        this.results = new Map();
        this.sessionCookie = null;
        this.memoryBaseline = process.memoryUsage();
        this.startTime = Date.now();
    }

    async login() {
        console.log('🔐 Authenticating...');
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                username: process.env.LOGIN_USERNAME || 'admin',
                password: process.env.LOGIN_PASSWORD || 'password'
            });

            const options = {
                hostname: CONFIG.host,
                port: CONFIG.port,
                path: '/api/login',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        const sessionCookie = res.headers['set-cookie']?.[0];
                        resolve(sessionCookie);
                    } else {
                        reject(new Error(`Login failed: ${res.statusCode}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    async makeRequest(url, options = {}) {
        return new Promise((resolve) => {
            const startTime = performance.now();
            const startMemory = process.memoryUsage();

            const requestOptions = {
                hostname: CONFIG.host,
                port: CONFIG.port,
                path: url,
                method: 'GET',
                headers: {
                    'Cookie': this.sessionCookie,
                    'User-Agent': 'Performance-Test-Client/1.0',
                    ...options.headers
                }
            };

            // Simulate network delay if specified
            const networkProfile = options.networkProfile || CONFIG.networkProfiles.fast;
            const delayStart = networkProfile.delay > 0 ? 
                () => new Promise(r => setTimeout(r, networkProfile.delay)) : 
                () => Promise.resolve();

            delayStart().then(() => {
                const req = http.request(requestOptions, (res) => {
                    let dataSize = 0;
                    let chunks = [];
                    let firstByteTime = null;
                    let lastByteTime = null;

                    res.on('data', (chunk) => {
                        if (firstByteTime === null) {
                            firstByteTime = performance.now();
                        }
                        lastByteTime = performance.now();
                        dataSize += chunk.length;
                        chunks.push(chunk);

                        // Simulate bandwidth throttling
                        if (networkProfile.bandwidth < Infinity) {
                            const currentBandwidth = dataSize / ((lastByteTime - startTime) / 1000);
                            if (currentBandwidth > networkProfile.bandwidth) {
                                // Add artificial delay to throttle
                                const delay = (dataSize / networkProfile.bandwidth) * 1000 - (lastByteTime - startTime);
                                if (delay > 0) {
                                    res.pause();
                                    setTimeout(() => res.resume(), delay);
                                }
                            }
                        }
                    });

                    res.on('end', () => {
                        const endTime = performance.now();
                        const endMemory = process.memoryUsage();

                        const result = {
                            url,
                            statusCode: res.statusCode,
                            headers: res.headers,
                            timing: {
                                total: endTime - startTime,
                                firstByte: firstByteTime ? firstByteTime - startTime : null,
                                lastByte: lastByteTime ? lastByteTime - startTime : null,
                                download: lastByteTime && firstByteTime ? lastByteTime - firstByteTime : null
                            },
                            data: {
                                size: dataSize,
                                transferRate: dataSize / ((endTime - startTime) / 1000) // bytes per second
                            },
                            cache: {
                                hit: res.statusCode === 304,
                                etag: res.headers.etag,
                                lastModified: res.headers['last-modified'],
                                cacheControl: res.headers['cache-control']
                            },
                            memory: {
                                heapUsed: endMemory.heapUsed - startMemory.heapUsed,
                                heapTotal: endMemory.heapTotal - startMemory.heapTotal,
                                external: endMemory.external - startMemory.external
                            },
                            timestamp: Date.now(),
                            networkProfile: options.networkProfile?.name || 'fast'
                        };

                        resolve(result);
                    });
                });

                req.on('error', (error) => {
                    const endTime = performance.now();
                    resolve({
                        url,
                        error: error.message,
                        timing: { total: endTime - startTime },
                        timestamp: Date.now(),
                        networkProfile: options.networkProfile?.name || 'fast'
                    });
                });

                req.setTimeout(30000, () => {
                    req.destroy();
                    resolve({
                        url,
                        error: 'Request timeout',
                        timing: { total: 30000 },
                        timestamp: Date.now(),
                        networkProfile: options.networkProfile?.name || 'fast'
                    });
                });

                req.end();
            });
        });
    }

    async testRangeRequests(imageUrl) {
        console.log('🔄 Testing range request performance...');
        const results = [];

        for (const chunkSize of CONFIG.rangeRequestSizes) {
            const rangeHeader = `bytes=0-${chunkSize - 1}`;
            const result = await this.makeRequest(imageUrl, {
                headers: { 'Range': rangeHeader }
            });

            results.push({
                chunkSize,
                ...result,
                isPartialContent: result.statusCode === 206
            });

            console.log(`   ${(chunkSize / 1024).toFixed(0)}KB chunk: ${result.timing.total.toFixed(2)}ms (${result.statusCode})`);
        }

        return results;
    }

    async testCacheEfficiency() {
        console.log('🔄 Testing cache efficiency...');
        const testUrl = CONFIG.testImages[0];
        const results = [];

        // First request (cache miss)
        const coldRequest = await this.makeRequest(testUrl, {
            headers: { 'Cache-Control': 'no-cache' }
        });
        results.push({ type: 'cold', ...coldRequest });

        // Second request (should hit cache or return 304)
        const warmRequest = await this.makeRequest(testUrl);
        results.push({ type: 'warm', ...warmRequest });

        // Third request with if-none-match (should return 304)
        const conditionalRequest = await this.makeRequest(testUrl, {
            headers: { 'If-None-Match': coldRequest.cache.etag }
        });
        results.push({ type: 'conditional', ...conditionalRequest });

        // Calculate cache efficiency
        const cacheHitRate = results.filter(r => r.cache?.hit).length / results.length * 100;
        const averageLoadTime = results.reduce((sum, r) => sum + r.timing.total, 0) / results.length;
        const coldVsWarmImprovement = coldRequest.timing.total > 0 ? 
            ((coldRequest.timing.total - warmRequest.timing.total) / coldRequest.timing.total * 100) : 0;

        return {
            requests: results,
            metrics: {
                cacheHitRate,
                averageLoadTime,
                coldVsWarmImprovement,
                coldLoadTime: coldRequest.timing.total,
                warmLoadTime: warmRequest.timing.total
            }
        };
    }

    async testConcurrentLoad(userCount, duration = 30000) {
        console.log(`🔄 Testing concurrent load: ${userCount} users for ${duration/1000}s`);
        
        const startTime = Date.now();
        const endTime = startTime + duration;
        const workers = [];
        const results = [];

        // Create worker threads for concurrent testing
        for (let i = 0; i < userCount; i++) {
            const worker = new Worker(__filename, {
                workerData: {
                    isWorker: true,
                    workerId: i,
                    sessionCookie: this.sessionCookie,
                    endTime,
                    testImages: CONFIG.testImages,
                    host: CONFIG.host,
                    port: CONFIG.port
                }
            });

            workers.push(worker);

            worker.on('message', (result) => {
                results.push(result);
            });
        }

        // Wait for all workers to complete
        await new Promise(resolve => {
            let completedWorkers = 0;
            workers.forEach(worker => {
                worker.on('exit', () => {
                    completedWorkers++;
                    if (completedWorkers === userCount) {
                        resolve();
                    }
                });
            });
        });

        return this.analyzeResults(results, userCount, duration);
    }

    async testNetworkProfiles() {
        console.log('🔄 Testing different network conditions...');
        const results = new Map();
        const testUrl = CONFIG.testImages[0]; // Use largest image for network testing

        for (const [profileName, profile] of Object.entries(CONFIG.networkProfiles)) {
            console.log(`   Testing ${profileName} network...`);
            const networkResults = [];

            // Run 5 requests for each network profile
            for (let i = 0; i < 5; i++) {
                const result = await this.makeRequest(testUrl, {
                    networkProfile: { ...profile, name: profileName }
                });
                networkResults.push(result);
            }

            const avgTime = networkResults.reduce((sum, r) => sum + r.timing.total, 0) / networkResults.length;
            const avgTransferRate = networkResults.reduce((sum, r) => sum + r.data.transferRate, 0) / networkResults.length;

            results.set(profileName, {
                requests: networkResults,
                averageTime: avgTime,
                averageTransferRate: avgTransferRate,
                profile
            });

            console.log(`      Avg time: ${avgTime.toFixed(2)}ms, Transfer rate: ${(avgTransferRate / 1024 / 1024).toFixed(2)} MB/s`);
        }

        return results;
    }

    async testMemoryUsage() {
        console.log('🔄 Testing memory usage under load...');
        const initialMemory = process.memoryUsage();
        const memorySnapshots = [{ time: 0, ...initialMemory }];

        // Load multiple large images simultaneously
        const promises = CONFIG.testImages.map(async (imageUrl) => {
            for (let i = 0; i < 10; i++) {
                await this.makeRequest(imageUrl);
                memorySnapshots.push({
                    time: Date.now() - this.startTime,
                    ...process.memoryUsage()
                });
            }
        });

        await Promise.all(promises);

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            memorySnapshots.push({
                time: Date.now() - this.startTime,
                afterGC: true,
                ...process.memoryUsage()
            });
        }

        return {
            baseline: initialMemory,
            snapshots: memorySnapshots,
            peak: {
                heapUsed: Math.max(...memorySnapshots.map(s => s.heapUsed)),
                heapTotal: Math.max(...memorySnapshots.map(s => s.heapTotal)),
                external: Math.max(...memorySnapshots.map(s => s.external))
            }
        };
    }

    analyzeResults(results, userCount, duration) {
        const successful = results.filter(r => !r.error);
        const failed = results.filter(r => r.error);
        const cached = results.filter(r => r.cache?.hit);

        if (successful.length === 0) {
            return { error: 'No successful requests' };
        }

        const responseTimes = successful.map(r => r.timing.total);
        const transferRates = successful.map(r => r.data.transferRate).filter(r => r > 0);
        
        return {
            summary: {
                duration: duration,
                userCount: userCount,
                totalRequests: results.length,
                successfulRequests: successful.length,
                failedRequests: failed.length,
                requestsPerSecond: (successful.length / (duration / 1000)).toFixed(2),
                cacheHitRate: ((cached.length / successful.length) * 100).toFixed(1)
            },
            performance: {
                responseTime: {
                    min: Math.min(...responseTimes).toFixed(2),
                    max: Math.max(...responseTimes).toFixed(2),
                    avg: (responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(2),
                    p50: this.percentile(responseTimes, 50).toFixed(2),
                    p90: this.percentile(responseTimes, 90).toFixed(2),
                    p95: this.percentile(responseTimes, 95).toFixed(2),
                    p99: this.percentile(responseTimes, 99).toFixed(2)
                },
                throughput: {
                    avgTransferRate: transferRates.length > 0 ? 
                        (transferRates.reduce((a, b) => a + b, 0) / transferRates.length / 1024 / 1024).toFixed(2) : '0',
                    totalDataTransferred: (successful.reduce((sum, r) => sum + r.data.size, 0) / 1024 / 1024).toFixed(2)
                }
            },
            errors: failed.map(r => ({ url: r.url, error: r.error, time: r.timestamp }))
        };
    }

    percentile(arr, p) {
        const sorted = arr.slice().sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    generateComprehensiveReport(allResults) {
        console.log('\n' + '='.repeat(60));
        console.log('📊 COMPREHENSIVE PERFORMANCE TEST RESULTS');
        console.log('='.repeat(60));

        // Server Performance Summary
        if (allResults.concurrentTests) {
            console.log('\n🔧 SERVER PERFORMANCE ANALYSIS');
            console.log('-'.repeat(40));
            
            allResults.concurrentTests.forEach((test, index) => {
                console.log(`\n${test.summary.userCount} Concurrent Users:`);
                console.log(`  Requests/sec:     ${test.summary.requestsPerSecond}`);
                console.log(`  Success rate:     ${((test.summary.successfulRequests / test.summary.totalRequests) * 100).toFixed(1)}%`);
                console.log(`  Cache hit rate:   ${test.summary.cacheHitRate}%`);
                console.log(`  Avg response:     ${test.performance.responseTime.avg}ms`);
                console.log(`  95th percentile:  ${test.performance.responseTime.p95}ms`);
                
                if (test.errors.length > 0) {
                    console.log(`  ⚠️  Errors:        ${test.errors.length}`);
                }
            });
        }

        // Cache Performance
        if (allResults.cacheTest) {
            console.log('\n💾 CACHE PERFORMANCE ANALYSIS');
            console.log('-'.repeat(40));
            console.log(`Cache hit rate:       ${allResults.cacheTest.metrics.cacheHitRate.toFixed(1)}%`);
            console.log(`Cold load time:       ${allResults.cacheTest.metrics.coldLoadTime.toFixed(2)}ms`);
            console.log(`Warm load time:       ${allResults.cacheTest.metrics.warmLoadTime.toFixed(2)}ms`);
            console.log(`Cache improvement:    ${allResults.cacheTest.metrics.coldVsWarmImprovement.toFixed(1)}%`);
        }

        // Range Request Performance
        if (allResults.rangeRequests) {
            console.log('\n📡 RANGE REQUEST PERFORMANCE');
            console.log('-'.repeat(40));
            allResults.rangeRequests.forEach(result => {
                const chunkSizeKB = (result.chunkSize / 1024).toFixed(0);
                const status = result.isPartialContent ? '✅ 206' : '❌ ' + result.statusCode;
                console.log(`${chunkSizeKB.padStart(4)}KB chunk:     ${result.timing.total.toFixed(2).padStart(8)}ms ${status}`);
            });
        }

        // Network Performance
        if (allResults.networkTests) {
            console.log('\n🌐 NETWORK CONDITION ANALYSIS');
            console.log('-'.repeat(40));
            for (const [profile, data] of allResults.networkTests) {
                const bandwidth = data.profile.bandwidth === Infinity ? 'Unlimited' : 
                    `${(data.profile.bandwidth / 1024 / 1024).toFixed(1)}Mbps`;
                console.log(`${profile.padEnd(8)}: ${data.averageTime.toFixed(2).padStart(8)}ms avg (${bandwidth})`);
            }
        }

        // Memory Usage
        if (allResults.memoryTest) {
            const memory = allResults.memoryTest;
            console.log('\n🧠 MEMORY USAGE ANALYSIS');
            console.log('-'.repeat(40));
            console.log(`Baseline heap:        ${(memory.baseline.heapUsed / 1024 / 1024).toFixed(2)}MB`);
            console.log(`Peak heap:            ${(memory.peak.heapUsed / 1024 / 1024).toFixed(2)}MB`);
            console.log(`Memory growth:        ${((memory.peak.heapUsed - memory.baseline.heapUsed) / 1024 / 1024).toFixed(2)}MB`);
            console.log(`External memory:      ${(memory.peak.external / 1024 / 1024).toFixed(2)}MB`);
        }

        // Performance Recommendations
        console.log('\n💡 PERFORMANCE RECOMMENDATIONS');
        console.log('-'.repeat(40));
        this.generateRecommendations(allResults);

        console.log('\n✅ Comprehensive performance analysis complete');
        console.log('='.repeat(60));
    }

    generateRecommendations(results) {
        const recommendations = [];

        // Analyze concurrent performance
        if (results.concurrentTests) {
            const highestLoad = results.concurrentTests[results.concurrentTests.length - 1];
            if (parseFloat(highestLoad.performance.responseTime.p95) > 5000) {
                recommendations.push('⚠️  High response times under load - consider server scaling');
            }
            if (parseFloat(highestLoad.summary.requestsPerSecond) < 10) {
                recommendations.push('⚠️  Low throughput - consider adding a reverse proxy (nginx/Apache)');
            }
            if (highestLoad.errors.length > 0) {
                recommendations.push('⚠️  Errors under load - check server stability and resource limits');
            }
        }

        // Analyze cache performance
        if (results.cacheTest && results.cacheTest.metrics.cacheHitRate < 50) {
            recommendations.push('⚠️  Low cache hit rate - verify ETags and cache headers are working');
        }

        // Analyze range requests
        if (results.rangeRequests) {
            const rangeSupported = results.rangeRequests.some(r => r.isPartialContent);
            if (!rangeSupported) {
                recommendations.push('⚠️  Range requests not working - check Accept-Ranges header');
            }
        }

        // Analyze memory usage
        if (results.memoryTest) {
            const memoryGrowthMB = (results.memoryTest.peak.heapUsed - results.memoryTest.baseline.heapUsed) / 1024 / 1024;
            if (memoryGrowthMB > 100) {
                recommendations.push('⚠️  High memory usage - check for memory leaks');
            }
        }

        if (recommendations.length === 0) {
            recommendations.push('✅ All performance metrics look good!');
        }

        recommendations.forEach(rec => console.log(rec));
    }

    async run() {
        try {
            console.log('🚀 Starting Comprehensive Performance Testing');
            console.log(`Target: http://${CONFIG.host}:${CONFIG.port}`);
            console.log(`Test duration: ${CONFIG.testDuration / 1000}s`);

            // Authentication
            this.sessionCookie = await this.login();
            console.log('✅ Authentication successful');

            const allResults = {};

            // 1. Cache efficiency test
            allResults.cacheTest = await this.testCacheEfficiency();

            // 2. Range request test
            allResults.rangeRequests = await this.testRangeRequests(CONFIG.testImages[0]);

            // 3. Network condition tests
            allResults.networkTests = await this.testNetworkProfiles();

            // 4. Memory usage test
            allResults.memoryTest = await this.testMemoryUsage();

            // 5. Concurrent load tests
            allResults.concurrentTests = [];
            for (const userCount of CONFIG.concurrentUsers) {
                const result = await this.testConcurrentLoad(userCount, CONFIG.testDuration / CONFIG.concurrentUsers.length);
                allResults.concurrentTests.push(result);
            }

            // Generate comprehensive report
            this.generateComprehensiveReport(allResults);

            // Save detailed results to file
            await this.saveResultsToFile(allResults);

        } catch (error) {
            console.error('❌ Test failed:', error.message);
            if (error.stack) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    }

    async saveResultsToFile(results) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `performance-results-${timestamp}.json`;
        
        try {
            await fs.writeFile(filename, JSON.stringify(results, null, 2));
            console.log(`\n📄 Detailed results saved to: ${filename}`);
        } catch (error) {
            console.error('Failed to save results file:', error.message);
        }
    }
}

// Worker thread code for concurrent testing
if (!isMainThread && workerData && workerData.isWorker) {
    const { workerId, sessionCookie, endTime, testImages, host, port } = workerData;
    
    const makeWorkerRequest = async (url) => {
        return new Promise((resolve) => {
            const startTime = performance.now();
            
            const options = {
                hostname: host,
                port: port,
                path: url,
                method: 'GET',
                headers: {
                    'Cookie': sessionCookie,
                    'User-Agent': `Performance-Test-Worker-${workerId}/1.0`
                }
            };

            const req = http.request(options, (res) => {
                let dataSize = 0;
                res.on('data', chunk => dataSize += chunk.length);
                res.on('end', () => {
                    const endTime = performance.now();
                    resolve({
                        workerId,
                        url,
                        statusCode: res.statusCode,
                        timing: { total: endTime - startTime },
                        data: { size: dataSize },
                        cache: { hit: res.statusCode === 304 },
                        timestamp: Date.now()
                    });
                });
            });

            req.on('error', (error) => {
                resolve({
                    workerId,
                    url,
                    error: error.message,
                    timing: { total: performance.now() - startTime },
                    timestamp: Date.now()
                });
            });

            req.setTimeout(10000, () => {
                req.destroy();
                resolve({
                    workerId,
                    url,
                    error: 'Timeout',
                    timing: { total: 10000 },
                    timestamp: Date.now()
                });
            });

            req.end();
        });
    };

    // Worker main loop
    (async () => {
        let requestCount = 0;
        
        while (Date.now() < endTime) {
            const randomImage = testImages[Math.floor(Math.random() * testImages.length)];
            const result = await makeWorkerRequest(randomImage);
            parentPort.postMessage(result);
            
            requestCount++;
            
            // Add small random delay to simulate real user behavior
            await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
        }
        
        process.exit(0);
    })();
}

// Run the test if this is the main thread
if (isMainThread && require.main === module) {
    const tester = new ComprehensivePerformanceTester();
    tester.run();
}

module.exports = ComprehensivePerformanceTester;