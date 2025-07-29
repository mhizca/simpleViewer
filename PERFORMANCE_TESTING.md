# Performance Testing Suite

This comprehensive performance testing suite evaluates both server-side and client-side performance of the image viewer webapp, providing detailed metrics and optimization recommendations.

## 🚀 Quick Start

### 1. Basic Performance Test
```bash
npm run perf-test-basic
```
Runs the original simple performance test focusing on server response times and cache efficiency.

### 2. Comprehensive Server Test
```bash
npm run perf-test-server
```
Runs detailed server performance analysis including:
- Concurrent user simulation
- Range request testing
- Network condition simulation
- Memory usage monitoring
- Cache efficiency analysis

### 3. Full Performance Suite
```bash
npm run perf-test
```
Runs both server and browser tests with automated report generation.

## 📊 What Gets Tested

### Server Performance
- **Response Times**: Min, max, average, P95, P99 response times
- **Concurrency**: Performance under 1, 5, 10, 20, and 50 concurrent users
- **Cache Efficiency**: HTTP cache hit rates, ETag validation, 304 responses
- **Range Requests**: Partial content delivery for large images (20-30MB)
- **Memory Usage**: Server memory consumption patterns under load
- **Network Simulation**: Performance under different connection conditions (3G, 4G, WiFi)

### Frontend Performance
- **Core Web Vitals**: LCP (Largest Contentful Paint), FID (First Input Delay), CLS (Cumulative Layout Shift)
- **Image Loading**: Load times, progressive loading effectiveness
- **Client-side Caching**: Cache hit rates, intelligent preloading effectiveness
- **Navigation Speed**: Dataset switching, image type changes
- **Memory Management**: Browser memory usage, garbage collection patterns
- **User Interactions**: Response times to zoom, pan, navigation actions

## 🔧 Advanced Usage

### Command Line Options

```bash
# Run only server tests
node run-performance-tests.js --no-browser

# Run only browser tests  
node run-performance-tests.js --no-server

# Custom test duration (in seconds)
node run-performance-tests.js --duration 120

# Custom output directory
node run-performance-tests.js --output ./my-reports

# Custom server port
node run-performance-tests.js --port 3001
```

### Browser Automation

For automated browser testing, install Puppeteer:
```bash
npm install puppeteer
```

Without Puppeteer, the test runner provides manual testing instructions.

### Environment Variables

Set these environment variables for authentication:
```bash
export LOGIN_USERNAME=your_username
export LOGIN_PASSWORD=your_password
```

## 📈 Understanding Results

### Performance Scores
- **90-100**: Excellent performance
- **70-89**: Good performance  
- **50-69**: Needs improvement
- **Below 50**: Poor performance, immediate optimization needed

### Key Metrics

#### Server Metrics
- **Response Time**: Target < 2000ms for image loads
- **Cache Hit Rate**: Target > 80% for optimal performance
- **Requests/Second**: Throughput capacity
- **Memory Usage**: Server resource consumption

#### Frontend Metrics
- **LCP (Largest Contentful Paint)**: Target < 2.5s
- **FID (First Input Delay)**: Target < 100ms  
- **CLS (Cumulative Layout Shift)**: Target < 0.1
- **Image Load Time**: Target < 3000ms for large images
- **Cache Efficiency**: Target > 70% hit rate

## 🛠️ Browser Performance Monitor

### Real-time Monitoring

The webapp includes a built-in performance monitor that provides:
- Live performance metrics overlay
- Real-time cache statistics
- Memory usage tracking
- Network quality indicators
- Performance issue alerts

### Keyboard Shortcuts
- **Ctrl+Shift+P**: Toggle performance overlay
- **F12 → Console**: View detailed performance logs

### Console Commands
```javascript
// Export performance metrics
exportPerformanceMetrics()

// Reset performance tracking
resetPerformanceMetrics()

// Get current metrics
window.performanceMonitor.getMetrics()
```

## 📋 Test Scenarios

### Automated Test Scenarios
1. **Initial Load**: First image loading performance
2. **Navigation**: Dataset switching and image type changes  
3. **Zoom Operations**: UI responsiveness during zoom/pan
4. **Cache Testing**: Effectiveness of browser and server caching
5. **Concurrent Operations**: Multiple rapid interactions

### Manual Test Scenarios
1. Navigate through all datasets
2. Switch between pre/post/change detection images
3. Perform zoom and pan operations
4. Test on different network conditions
5. Monitor memory usage over extended use

## 🎯 Optimization Targets

### Current Optimizations
- **Server**: HTTP caching, ETags, range requests, async operations
- **Frontend**: Intelligent preloading, client-side caching, progress indicators

### Performance Goals
- Image serving: < 2s for 20-30MB images
- Cache hit rate: > 80%  
- Navigation responsiveness: < 200ms
- Memory growth: < 50MB per hour
- Core Web Vitals: All "Good" ratings

## 📊 Report Generation

### Automated Reports
Tests generate both JSON and HTML reports:
- **JSON**: Detailed metrics for programmatic analysis
- **HTML**: Visual dashboard with charts and recommendations

### Report Location
Reports are saved to `./performance-reports/` by default.

### Report Contents
- Performance score and health status
- Key metrics dashboard
- Optimization recommendations (prioritized)
- Test execution details
- Historical comparison (when available)

## 🔍 Troubleshooting

### Common Issues

**Server not responding**
```bash
# Check if server is running
curl http://localhost:3000/api/datasets/analysis
```

**Authentication errors**
```bash
# Set credentials
export LOGIN_USERNAME=admin  
export LOGIN_PASSWORD=password
```

**Browser tests failing**
```bash
# Install Puppeteer for automated testing
npm install puppeteer

# Or run manual browser tests
node run-performance-tests.js --no-browser
```

**Memory issues during testing**
```bash
# Run with increased memory limit
node --max-old-space-size=4096 run-performance-tests.js
```

### Debug Mode

Enable detailed logging:
```bash
DEBUG=* node run-performance-tests.js
```

## 🚨 Performance Alerts

The system automatically detects and reports:
- Response times > 2000ms
- Cache hit rates < 50%
- Memory usage > 80% of limit
- Core Web Vitals failing thresholds
- Network timeouts or errors

## 📈 Monitoring Integration

### Production Monitoring

For production deployments, consider integrating:
- Application Performance Monitoring (APM) tools
- Real User Monitoring (RUM)
- Server monitoring (CPU, memory, disk)
- CDN analytics
- Database performance metrics

### Continuous Testing

Set up automated performance testing:
```bash
# Add to CI/CD pipeline
npm run perf-test-server
```

## 🎨 Customization

### Custom Metrics

Extend the performance monitor with custom metrics:

```javascript
// Add custom tracking
window.performanceMonitor.trackCustomMetric('myMetric', value);

// Custom performance threshold
window.performanceMonitor.thresholds.customThreshold = 1000;
```

### Test Configuration

Modify test parameters in the configuration files:
- `comprehensive-performance-test.js`: Server test settings
- `performance-monitor.js`: Frontend monitoring settings  
- `run-performance-tests.js`: Test orchestration settings

## 🔗 Related Documentation

- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Server Configuration](./server.js)
- [Frontend Architecture](./public/app.js)

## 📝 Contributing

When adding new performance tests:
1. Follow existing naming conventions
2. Include both positive and negative test cases
3. Add appropriate thresholds and alerts
4. Update this documentation
5. Test on multiple network conditions

## 🏆 Performance Benchmarks

### Target Performance (20-30MB images)
- **Initial Load**: < 3s (cold cache)
- **Cached Load**: < 100ms
- **Navigation**: < 500ms
- **Zoom Response**: < 50ms
- **Memory Growth**: < 2MB per image

### Optimization Impact
Expected improvements from implemented optimizations:
- Server caching: 70-90% faster repeated loads
- Range requests: 50% faster progressive loading
- Client preloading: 80% faster navigation
- Memory management: 60% reduction in memory growth