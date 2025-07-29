#!/usr/bin/env node

/**
 * Performance Testing Script for Image Viewer
 * Tests server response times and concurrent load handling
 */

const http = require('http');
const { performance } = require('perf_hooks');

const config = {
    host: 'localhost',
    port: 3000,
    concurrentUsers: 5,
    requestsPerUser: 10,
    testImagePath: '/api/image/analysis/1/DJI_20250520101901_0001.JPG'
};

class PerformanceTester {
    constructor() {
        this.results = {
            requests: [],
            errors: [],
            cacheHits: 0,
            totalRequests: 0
        };
    }

    async login() {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                username: process.env.LOGIN_USERNAME || 'admin',
                password: process.env.LOGIN_PASSWORD || 'password'
            });

            const options = {
                hostname: config.host,
                port: config.port,
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

    async makeRequest(sessionCookie, path) {
        return new Promise((resolve) => {
            const startTime = performance.now();
            
            const options = {
                hostname: config.host,
                port: config.port,
                path: path,
                method: 'GET',
                headers: {
                    'Cookie': sessionCookie,
                    'Cache-Control': 'no-cache' // Force fresh request for initial test
                }
            };

            const req = http.request(options, (res) => {
                const endTime = performance.now();
                const responseTime = endTime - startTime;
                
                let dataSize = 0;
                res.on('data', chunk => {
                    dataSize += chunk.length;
                });
                
                res.on('end', () => {
                    const result = {
                        statusCode: res.statusCode,
                        responseTime: responseTime,
                        dataSize: dataSize,
                        cached: res.headers['x-cache'] === 'HIT' || res.statusCode === 304,
                        timestamp: Date.now()
                    };
                    
                    if (res.statusCode === 304) {
                        this.results.cacheHits++;
                    }
                    
                    this.results.totalRequests++;
                    resolve(result);
                });
            });

            req.on('error', (error) => {
                const endTime = performance.now();
                const result = {
                    error: error.message,
                    responseTime: endTime - startTime,
                    timestamp: Date.now()
                };
                this.results.errors.push(result);
                resolve(result);
            });

            req.end();
        });
    }

    async runConcurrentTest(sessionCookie) {
        console.log(`\n🔄 Running concurrent test: ${config.concurrentUsers} users, ${config.requestsPerUser} requests each`);
        
        const startTime = performance.now();
        const promises = [];

        for (let user = 0; user < config.concurrentUsers; user++) {
            const userPromises = [];
            
            for (let req = 0; req < config.requestsPerUser; req++) {
                // Add some randomness to simulate real usage
                const delay = Math.random() * 1000;
                const promise = new Promise(resolve => setTimeout(resolve, delay))
                    .then(() => this.makeRequest(sessionCookie, config.testImagePath));
                userPromises.push(promise);
            }
            
            promises.push(Promise.all(userPromises));
        }

        const results = await Promise.all(promises);
        const endTime = performance.now();
        
        // Flatten results
        const allResults = results.flat().filter(r => !r.error);
        this.results.requests = allResults;
        
        return {
            totalTime: endTime - startTime,
            results: allResults
        };
    }

    async runCacheTest(sessionCookie) {
        console.log('\n🔄 Testing cache performance...');
        
        // First request (cache miss)
        const firstRequest = await this.makeRequest(sessionCookie, config.testImagePath);
        console.log(`   Cache MISS: ${firstRequest.responseTime.toFixed(2)}ms`);
        
        // Second request (should be cache hit)
        const options = {
            hostname: config.host,
            port: config.port,
            path: config.testImagePath,
            method: 'GET',
            headers: {
                'Cookie': sessionCookie,
                'If-Modified-Since': new Date().toUTCString() // Should trigger 304
            }
        };
        
        const secondRequest = await this.makeRequest(sessionCookie, config.testImagePath);
        console.log(`   Cache HIT:  ${secondRequest.responseTime.toFixed(2)}ms`);
        
        return {
            cacheMiss: firstRequest.responseTime,
            cacheHit: secondRequest.responseTime,
            improvement: ((firstRequest.responseTime - secondRequest.responseTime) / firstRequest.responseTime * 100).toFixed(1)
        };
    }

    generateReport(testResults, cacheResults) {
        const requests = this.results.requests;
        const errors = this.results.errors;
        
        if (requests.length === 0) {
            console.log('\n❌ No successful requests to analyze');
            return;
        }

        const responseTimes = requests.map(r => r.responseTime);
        const dataSizes = requests.map(r => r.dataSize);
        
        const stats = {
            totalRequests: this.results.totalRequests,
            successfulRequests: requests.length,
            failedRequests: errors.length,
            cacheHitRate: ((this.results.cacheHits / this.results.totalRequests) * 100).toFixed(1),
            
            responseTime: {
                min: Math.min(...responseTimes).toFixed(2),
                max: Math.max(...responseTimes).toFixed(2),
                avg: (responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(2),
                p95: this.percentile(responseTimes, 95).toFixed(2),
                p99: this.percentile(responseTimes, 99).toFixed(2)
            },
            
            throughput: {
                requestsPerSecond: (requests.length / (testResults.totalTime / 1000)).toFixed(2),
                avgDataSize: (dataSizes.reduce((a, b) => a + b, 0) / dataSizes.length / 1024 / 1024).toFixed(2)
            }
        };

        console.log('\n📊 PERFORMANCE TEST RESULTS');
        console.log('=====================================');
        console.log(`Total Requests:      ${stats.totalRequests}`);
        console.log(`Successful:          ${stats.successfulRequests}`);
        console.log(`Failed:              ${stats.failedRequests}`);
        console.log(`Cache Hit Rate:      ${stats.cacheHitRate}%`);
        console.log('');
        console.log('Response Times (ms):');
        console.log(`  Min:               ${stats.responseTime.min}ms`);
        console.log(`  Average:           ${stats.responseTime.avg}ms`);
        console.log(`  Max:               ${stats.responseTime.max}ms`);
        console.log(`  95th percentile:   ${stats.responseTime.p95}ms`);
        console.log(`  99th percentile:   ${stats.responseTime.p99}ms`);
        console.log('');
        console.log('Throughput:');
        console.log(`  Requests/sec:      ${stats.throughput.requestsPerSecond}`);
        console.log(`  Avg image size:    ${stats.throughput.avgDataSize}MB`);
        console.log('');
        console.log('Cache Performance:');
        console.log(`  Cache miss time:   ${cacheResults.cacheMiss.toFixed(2)}ms`);
        console.log(`  Cache hit time:    ${cacheResults.cacheHit.toFixed(2)}ms`);
        console.log(`  Cache improvement: ${cacheResults.improvement}%`);
        
        // Performance recommendations
        console.log('\n💡 PERFORMANCE RECOMMENDATIONS');
        console.log('=====================================');
        
        if (parseFloat(stats.responseTime.avg) > 2000) {
            console.log('⚠️  Average response time > 2s - consider image compression');
        }
        
        if (parseFloat(stats.cacheHitRate) < 50) {
            console.log('⚠️  Low cache hit rate - check cache headers');
        }
        
        if (parseFloat(stats.throughput.requestsPerSecond) < 10) {
            console.log('⚠️  Low throughput - consider adding a reverse proxy (nginx)');
        }
        
        if (errors.length > 0) {
            console.log(`⚠️  ${errors.length} failed requests - check server stability`);
        }
        
        console.log('✅ Performance analysis complete');
    }

    percentile(arr, p) {
        const sorted = arr.slice().sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[index];
    }

    async run() {
        try {
            console.log('🚀 Starting Image Viewer Performance Test');
            console.log(`Target: http://${config.host}:${config.port}`);
            
            // Login
            console.log('\n🔐 Authenticating...');
            const sessionCookie = await this.login();
            console.log('✅ Authentication successful');
            
            // Run cache test
            const cacheResults = await this.runCacheTest(sessionCookie);
            
            // Run concurrent load test
            const testResults = await this.runConcurrentTest(sessionCookie);
            
            // Generate report
            this.generateReport(testResults, cacheResults);
            
        } catch (error) {
            console.error('❌ Test failed:', error.message);
            process.exit(1);
        }
    }
}

// Run the test
if (require.main === module) {
    const tester = new PerformanceTester();
    tester.run();
}

module.exports = PerformanceTester;