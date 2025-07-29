#!/usr/bin/env node

/**
 * Automated Performance Testing Runner
 * Orchestrates both server-side and browser-side performance testing
 * 
 * Features:
 * - Runs comprehensive server performance tests
 * - Launches browser automation for frontend testing
 * - Generates combined performance reports
 * - Identifies performance regressions
 * - Provides optimization recommendations
 */

const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

class PerformanceTestRunner {
    constructor() {
        this.config = {
            serverHost: 'localhost',
            serverPort: 3000,
            testDuration: 60000, // 1 minute
            outputDir: './performance-reports',
            browserTimeout: 120000, // 2 minutes for browser tests
            enableBrowserTests: true,
            enableServerTests: true
        };
        
        this.results = {
            server: null,
            browser: null,
            combined: null,
            timestamp: new Date().toISOString(),
            testId: `perf-test-${Date.now()}`
        };
    }

    async init() {
        console.log('🚀 Initializing Performance Test Runner');
        console.log(`Test ID: ${this.results.testId}`);
        
        // Create output directory
        try {
            await fs.mkdir(this.config.outputDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
        
        // Check if server is running
        const serverRunning = await this.checkServerHealth();
        if (!serverRunning) {
            console.log('⚠️  Server not running, attempting to start...');
            await this.startServer();
        }
        
        console.log('✅ Initialization complete');
    }

    async checkServerHealth() {
        return new Promise((resolve) => {
            const req = http.request({
                hostname: this.config.serverHost,
                port: this.config.serverPort,
                path: '/api/datasets/analysis',
                method: 'HEAD',
                timeout: 5000
            }, (res) => {
                resolve(res.statusCode < 500);
            });
            
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            
            req.end();
        });
    }

    async startServer() {
        return new Promise((resolve, reject) => {
            console.log('🔄 Starting server...');
            
            const serverProcess = spawn('node', ['server.js'], {
                stdio: 'pipe',
                detached: false
            });
            
            let serverReady = false;
            
            serverProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`Server: ${output.trim()}`);
                
                if (output.includes('Server running at') && !serverReady) {
                    serverReady = true;
                    // Give server a moment to fully initialize
                    setTimeout(() => resolve(serverProcess), 2000);
                }
            });
            
            serverProcess.stderr.on('data', (data) => {
                console.error(`Server Error: ${data.toString()}`);
            });
            
            serverProcess.on('error', (error) => {
                console.error('Failed to start server:', error);
                reject(error);
            });
            
            // Timeout if server doesn't start within 10 seconds
            setTimeout(() => {
                if (!serverReady) {
                    serverProcess.kill();
                    reject(new Error('Server startup timeout'));
                }
            }, 10000);
        });
    }

    async runServerTests() {
        if (!this.config.enableServerTests) {
            console.log('⏭️  Skipping server tests (disabled)');
            return null;
        }

        console.log('\n🔧 Running Server Performance Tests');
        console.log('=' .repeat(50));
        
        return new Promise((resolve, reject) => {
            const testProcess = spawn('node', ['comprehensive-performance-test.js'], {
                stdio: 'pipe',
                env: { ...process.env, NODE_ENV: 'test' }
            });
            
            let output = '';
            let errorOutput = '';
            
            testProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                console.log(text.trim());
            });
            
            testProcess.stderr.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                console.error(text.trim());
            });
            
            testProcess.on('close', (code) => {
                if (code === 0) {
                    resolve({
                        success: true,
                        output,
                        exitCode: code,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    reject(new Error(`Server tests failed with code ${code}: ${errorOutput}`));
                }
            });
            
            testProcess.on('error', (error) => {
                reject(new Error(`Server test process error: ${error.message}`));
            });
            
            // Set timeout for server tests
            setTimeout(() => {
                testProcess.kill('SIGTERM');
                reject(new Error('Server tests timeout'));
            }, this.config.testDuration * 2); // Allow extra time for comprehensive tests
        });
    }

    async runBrowserTests() {
        if (!this.config.enableBrowserTests) {
            console.log('⏭️  Skipping browser tests (disabled)');
            return null;
        }
        
        console.log('\n🌐 Running Browser Performance Tests');
        console.log('=' .repeat(50));
        
        // Check if we have a browser automation tool available
        const puppeteerAvailable = await this.checkPuppeteerInstallation();
        
        if (puppeteerAvailable) {
            return await this.runPuppeteerTests();
        } else {
            console.log('⚠️  Puppeteer not available, running manual browser test instructions');
            return await this.provideBrowserTestInstructions();
        }
    }

    async checkPuppeteerInstallation() {
        try {
            require.resolve('puppeteer');
            return true;
        } catch (error) {
            return false;
        }
    }

    async runPuppeteerTests() {
        const puppeteer = require('puppeteer');
        
        console.log('🔄 Launching browser with Puppeteer...');
        
        const browser = await puppeteer.launch({
            headless: false, // Show browser for debugging
            devtools: true,
            args: [
                '--enable-logging',
                '--disable-web-security',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection'
            ]
        });
        
        const page = await browser.newPage();
        
        // Enable performance monitoring
        await page.setCacheEnabled(true);
        
        // Collect performance metrics
        const metrics = {
            navigationTimings: [],
            resourceTimings: [],
            coreWebVitals: {},
            imageLoadTimes: [],
            cacheHits: 0,
            errors: []
        };
        
        // Listen for console logs from performance monitor
        page.on('console', (msg) => {
            const text = msg.text();
            if (text.includes('Performance Report') || text.includes('Performance Issue')) {
                console.log(`Browser: ${text}`);
            }
        });
        
        // Listen for network events
        page.on('response', (response) => {
            const url = response.url();
            if (url.includes('/api/image/')) {
                metrics.resourceTimings.push({
                    url,
                    status: response.status(),
                    fromCache: response.fromCache(),
                    timestamp: Date.now()
                });
                
                if (response.fromCache() || response.status() === 304) {
                    metrics.cacheHits++;
                }
            }
        });
        
        try {
            console.log('🔄 Navigating to application...');
            
            // Navigate to login page first
            await page.goto(`http://${this.config.serverHost}:${this.config.serverPort}/login.html`, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            // Perform login
            await page.type('input[name="username"]', process.env.LOGIN_USERNAME || 'admin');
            await page.type('input[name="password"]', process.env.LOGIN_PASSWORD || 'password');
            await page.click('button[type="submit"]');
            
            // Wait for redirect to main app
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            
            console.log('🔄 Running browser performance tests...');
            
            // Wait for ImageViewer to initialize
            await page.waitForSelector('#imageViewer', { timeout: 10000 });
            
            // Inject additional performance monitoring
            await page.addScriptTag({
                content: `
                    window.testMetrics = {
                        imageLoadTimes: [],
                        cacheHits: 0,
                        errors: []
                    };
                    
                    // Override image load tracking
                    const originalLog = console.log;
                    console.log = function(...args) {
                        originalLog.apply(console, args);
                        const text = args.join(' ');
                        if (text.includes('Performance Report')) {
                            window.testMetrics.lastReport = text;
                        }
                    };
                `
            });
            
            // Simulate user interactions and measure performance
            const testScenarios = [
                'Test initial image load',
                'Test navigation between images',
                'Test zoom operations',
                'Test cache effectiveness',
                'Test concurrent operations'
            ];
            
            for (const scenario of testScenarios) {
                console.log(`  🔄 ${scenario}...`);
                await this.runBrowserTestScenario(page, scenario, metrics);
                
                // Wait between scenarios
                await page.waitForTimeout(2000);
            }
            
            // Get final performance data from the page
            const finalMetrics = await page.evaluate(async () => {
                // Trigger a final performance report
                if (window.performanceMonitor) {
                    window.performanceMonitor.generatePerformanceReport();
                    return window.performanceMonitor.getMetrics();
                }
                return {};
            });
            
            console.log('✅ Browser tests completed');
            
            return {
                success: true,
                metrics: { ...metrics, ...finalMetrics },
                timestamp: new Date().toISOString(),
                scenarios: testScenarios.length
            };
            
        } catch (error) {
            console.error('Browser test error:', error);
            metrics.errors.push(error.message);
            
            return {
                success: false,
                error: error.message,
                metrics,
                timestamp: new Date().toISOString()
            };
        } finally {
            await browser.close();
        }
    }

    async runBrowserTestScenario(page, scenario, metrics) {
        const startTime = Date.now();
        
        try {
            switch (scenario) {
                case 'Test initial image load':
                    // Wait for first image to load
                    await page.waitForSelector('#mainImage[src]', { timeout: 10000 });
                    break;
                    
                case 'Test navigation between images':
                    // Click next dataset button multiple times
                    for (let i = 0; i < 3; i++) {
                        await page.click('#nextDataset');
                        await page.waitForTimeout(1000);
                        await page.waitForSelector('#mainImage[src]', { timeout: 5000 });
                    }
                    break;
                    
                case 'Test zoom operations':
                    // Test zoom in/out
                    await page.click('#zoomIn');
                    await page.waitForTimeout(500);
                    await page.click('#zoomIn');
                    await page.waitForTimeout(500);
                    await page.click('#zoomOut');
                    await page.waitForTimeout(500);
                    await page.click('#resetZoom');
                    await page.waitForTimeout(500);
                    break;
                    
                case 'Test cache effectiveness':
                    // Navigate back to first image (should be cached)
                    const startDataset = await page.$eval('#datasetSelect', el => el.value);
                    await page.select('#datasetSelect', '0');
                    await page.waitForTimeout(1000);
                    await page.select('#datasetSelect', startDataset);
                    break;
                    
                case 'Test concurrent operations':
                    // Rapid navigation to test concurrent loading
                    for (let i = 0; i < 5; i++) {
                        await page.click('#nextDataset');
                        await page.waitForTimeout(200); // Don't wait for complete load
                    }
                    await page.waitForTimeout(3000); // Wait for all loads to complete
                    break;
            }
            
            const endTime = Date.now();
            metrics.imageLoadTimes.push({
                scenario,
                duration: endTime - startTime,
                timestamp: endTime
            });
            
        } catch (error) {
            console.error(`Scenario "${scenario}" failed:`, error.message);
            metrics.errors.push(`${scenario}: ${error.message}`);
        }
    }

    async provideBrowserTestInstructions() {
        console.log('\n📋 Manual Browser Testing Instructions');
        console.log('-'.repeat(40));
        console.log('1. Open browser and navigate to: http://localhost:3000');
        console.log('2. Login with your credentials');
        console.log('3. Press Ctrl+Shift+P to open performance overlay');
        console.log('4. Navigate through different images and datasets');
        console.log('5. Monitor the performance metrics in real-time');
        console.log('6. Use browser DevTools > Performance tab for additional metrics');
        console.log('7. Export metrics using: exportPerformanceMetrics()');
        console.log('\n⏱️  Let the test run for at least 2 minutes for accurate results');
        console.log('⌨️  Press Enter when manual testing is complete...');
        
        // Wait for user input
        return new Promise((resolve) => {
            process.stdin.resume();
            process.stdin.on('data', () => {
                process.stdin.pause();
                resolve({
                    success: true,
                    type: 'manual',
                    timestamp: new Date().toISOString(),
                    note: 'Manual browser testing completed'
                });
            });
        });
    }

    async combineResults() {
        console.log('\n📊 Combining Test Results');
        console.log('=' .repeat(50));
        
        const combined = {
            testId: this.results.testId,
            timestamp: this.results.timestamp,
            server: this.results.server,
            browser: this.results.browser,
            summary: this.generateCombinedSummary(),
            recommendations: this.generateOptimizationRecommendations()
        };
        
        this.results.combined = combined;
        return combined;
    }

    generateCombinedSummary() {
        const summary = {
            overallHealth: 'unknown',
            criticalIssues: [],
            performanceScore: 0,
            keyMetrics: {}
        };
        
        // Analyze server results
        if (this.results.server && this.results.server.success) {
            // Extract key server metrics from output
            const serverOutput = this.results.server.output;
            
            // Look for performance indicators in output
            if (serverOutput.includes('Cache hit rate') || serverOutput.includes('Cache:')) {
                const cacheMatch = serverOutput.match(/Cache.*?(\d+\.?\d*)%/);
                if (cacheMatch) {
                    summary.keyMetrics.cacheHitRate = parseFloat(cacheMatch[1]);
                }
            }
            
            if (serverOutput.includes('Average:') || serverOutput.includes('avg')) {
                const avgMatch = serverOutput.match(/Average:?\s*(\d+\.?\d*)ms/i);
                if (avgMatch) {
                    summary.keyMetrics.avgResponseTime = parseFloat(avgMatch[1]);
                }
            }
        }
        
        // Analyze browser results
        if (this.results.browser && this.results.browser.success) {
            const browserMetrics = this.results.browser.metrics;
            
            if (browserMetrics.cacheStats) {
                summary.keyMetrics.frontendCacheHitRate = browserMetrics.cacheStats.hitRate;
            }
            
            if (browserMetrics.imageLoadings && browserMetrics.imageLoadings.length > 0) {
                const completedLoads = browserMetrics.imageLoadings.filter(l => l.stage === 'complete' && !l.failed);
                if (completedLoads.length > 0) {
                    const avgLoadTime = completedLoads.reduce((sum, l) => sum + l.loadTime, 0) / completedLoads.length;
                    summary.keyMetrics.avgImageLoadTime = avgLoadTime;
                }
            }
        }
        
        // Calculate overall health score
        let score = 100;
        
        // Deduct points for performance issues
        if (summary.keyMetrics.avgResponseTime > 2000) score -= 20;
        if (summary.keyMetrics.avgImageLoadTime > 3000) score -= 20;
        if (summary.keyMetrics.cacheHitRate < 50) score -= 15;
        if (summary.keyMetrics.frontendCacheHitRate < 70) score -= 15;
        
        summary.performanceScore = Math.max(0, score);
        
        if (score >= 80) {
            summary.overallHealth = 'excellent';
        } else if (score >= 60) {
            summary.overallHealth = 'good';
        } else if (score >= 40) {
            summary.overallHealth = 'needs-improvement';
        } else {
            summary.overallHealth = 'poor';
        }
        
        return summary;
    }

    generateOptimizationRecommendations() {
        const recommendations = [];
        const summary = this.results.combined?.summary || {};
        
        // Server-side recommendations
        if (summary.keyMetrics?.avgResponseTime > 2000) {
            recommendations.push({
                type: 'server',
                priority: 'high',
                issue: 'Slow server response times',
                recommendation: 'Consider implementing a CDN, optimizing image compression, or upgrading server resources'
            });
        }
        
        if (summary.keyMetrics?.cacheHitRate < 50) {
            recommendations.push({
                type: 'server',
                priority: 'high',
                issue: 'Low cache hit rate',
                recommendation: 'Verify cache headers (ETag, Last-Modified) are properly set and client-side caching is working'
            });
        }
        
        // Frontend recommendations
        if (summary.keyMetrics?.avgImageLoadTime > 3000) {
            recommendations.push({
                type: 'frontend',
                priority: 'high',
                issue: 'Slow image loading',
                recommendation: 'Implement image compression, progressive loading, or lazy loading for better user experience'
            });
        }
        
        if (summary.keyMetrics?.frontendCacheHitRate < 70) {
            recommendations.push({
                type: 'frontend',
                priority: 'medium',
                issue: 'Inefficient frontend caching',
                recommendation: 'Optimize the intelligent preloading algorithm and increase cache size if memory allows'
            });
        }
        
        // General recommendations
        recommendations.push({
            type: 'general',
            priority: 'low',
            issue: 'Monitoring',
            recommendation: 'Set up continuous performance monitoring in production to catch regressions early'
        });
        
        return recommendations;
    }

    async generateReport() {
        const report = this.results.combined;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = path.join(this.config.outputDir, `performance-report-${timestamp}.json`);
        const htmlReportPath = path.join(this.config.outputDir, `performance-report-${timestamp}.html`);
        
        // Save JSON report
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        
        // Generate HTML report
        const htmlReport = this.generateHTMLReport(report);
        await fs.writeFile(htmlReportPath, htmlReport);
        
        console.log('\n📄 Performance Reports Generated');
        console.log('-'.repeat(40));
        console.log(`JSON Report: ${reportPath}`);
        console.log(`HTML Report: ${htmlReportPath}`);
        
        return { jsonReport: reportPath, htmlReport: htmlReportPath };
    }

    generateHTMLReport(report) {
        const { summary } = report;
        const healthColor = {
            excellent: '#4CAF50',
            good: '#8BC34A',
            'needs-improvement': '#FF9800',
            poor: '#F44336'
        }[summary.overallHealth] || '#999';
        
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Performance Test Report - ${report.testId}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .health-score { font-size: 48px; font-weight: bold; color: ${healthColor}; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric-card { background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #007bff; }
        .metric-label { font-size: 12px; text-transform: uppercase; color: #666; margin-bottom: 5px; }
        .metric-value { font-size: 24px; font-weight: bold; color: #333; }
        .recommendations { margin-top: 30px; }
        .recommendation { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 10px 0; border-radius: 4px; }
        .priority-high { border-left: 4px solid #dc3545; }
        .priority-medium { border-left: 4px solid #fd7e14; }
        .priority-low { border-left: 4px solid #28a745; }
        .timestamp { color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Performance Test Report</h1>
            <div class="health-score">${summary.performanceScore}/100</div>
            <div style="font-size: 18px; color: ${healthColor}; text-transform: capitalize;">${summary.overallHealth}</div>
            <div class="timestamp">${report.timestamp}</div>
        </div>
        
        <div class="metrics-grid">
            ${Object.entries(summary.keyMetrics).map(([key, value]) => `
                <div class="metric-card">
                    <div class="metric-label">${key.replace(/([A-Z])/g, ' $1').trim()}</div>
                    <div class="metric-value">${typeof value === 'number' ? value.toFixed(1) : value}</div>
                </div>
            `).join('')}
        </div>
        
        <div class="recommendations">
            <h2>Optimization Recommendations</h2>
            ${summary.recommendations?.map(rec => `
                <div class="recommendation priority-${rec.priority}">
                    <h3>${rec.issue}</h3>
                    <p>${rec.recommendation}</p>
                    <small>Priority: ${rec.priority} | Type: ${rec.type}</small>
                </div>
            `).join('') || '<p>No specific recommendations at this time.</p>'}
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <h2>Test Details</h2>
            <p><strong>Test ID:</strong> ${report.testId}</p>
            <p><strong>Server Tests:</strong> ${report.server ? (report.server.success ? '✅ Passed' : '❌ Failed') : '⏭️ Skipped'}</p>
            <p><strong>Browser Tests:</strong> ${report.browser ? (report.browser.success ? '✅ Passed' : '❌ Failed') : '⏭️ Skipped'}</p>
        </div>
    </div>
</body>
</html>`;
    }

    async run() {
        try {
            console.log('🎯 Starting Comprehensive Performance Testing Suite');
            console.log('='.repeat(60));
            
            await this.init();
            
            // Run server tests
            if (this.config.enableServerTests) {
                try {
                    this.results.server = await this.runServerTests();
                    console.log('✅ Server tests completed successfully');
                } catch (error) {
                    console.error('❌ Server tests failed:', error.message);
                    this.results.server = { success: false, error: error.message };
                }
            }
            
            // Run browser tests
            if (this.config.enableBrowserTests) {
                try {
                    this.results.browser = await this.runBrowserTests();
                    console.log('✅ Browser tests completed successfully');
                } catch (error) {
                    console.error('❌ Browser tests failed:', error.message);
                    this.results.browser = { success: false, error: error.message };
                }
            }
            
            // Combine results and generate reports
            await this.combineResults();
            const reportPaths = await this.generateReport();
            
            // Final summary
            console.log('\n🎉 Performance Testing Complete');
            console.log('='.repeat(60));
            console.log(`Overall Performance Score: ${this.results.combined.summary.performanceScore}/100`);
            console.log(`Health Status: ${this.results.combined.summary.overallHealth.toUpperCase()}`);
            
            if (this.results.combined.summary.recommendations.length > 0) {
                console.log(`Recommendations: ${this.results.combined.summary.recommendations.length} optimization opportunities identified`);
            }
            
            console.log(`\n📊 View detailed results:`);
            console.log(`   HTML Report: ${reportPaths.htmlReport}`);
            console.log(`   JSON Report: ${reportPaths.jsonReport}`);
            
            return this.results.combined;
            
        } catch (error) {
            console.error('💥 Performance testing failed:', error);
            throw error;
        }
    }
}

// Command line interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const config = {};
    
    // Parse command line arguments
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace('--', '');
        const value = args[i + 1];
        
        switch (key) {
            case 'no-server':
                config.enableServerTests = false;
                i--; // No value for this flag
                break;
            case 'no-browser':
                config.enableBrowserTests = false;
                i--; // No value for this flag
                break;
            case 'duration':
                config.testDuration = parseInt(value) * 1000;
                break;
            case 'port':
                config.serverPort = parseInt(value);
                break;
            case 'output':
                config.outputDir = value;
                break;
            default:
                console.log(`Unknown option: --${key}`);
        }
    }
    
    const runner = new PerformanceTestRunner();
    Object.assign(runner.config, config);
    
    runner.run()
        .then((results) => {
            console.log('\n✅ All tests completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Tests failed:', error.message);
            process.exit(1);
        });
}

module.exports = PerformanceTestRunner;