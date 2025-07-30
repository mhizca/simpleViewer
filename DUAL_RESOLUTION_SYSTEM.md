# Dual-Resolution Image System

## Overview

The Simple Image Viewer now includes a sophisticated dual-resolution image system designed to significantly improve performance while maintaining the ability to view images at full resolution when needed. This system creates downsampled (2x smaller) versions of all images and intelligently switches between resolutions based on user needs.

### Key Benefits

- **Faster Initial Loading**: Downsampled images load 4x faster on average
- **Reduced Memory Usage**: Lower memory footprint with smart caching
- **Better User Experience**: Responsive interface with quick navigation
- **Preserve Quality**: Full resolution available on-demand
- **Automatic Management**: Seamless switching with visual indicators

## How the System Works

### Backend Components

1. **Downsampling Script** (`create-downsampled-images.js`)
   - Processes existing images to create 2x downsampled versions
   - Uses Sharp library with high-quality Lanczos3 kernel
   - Saves downsampled images with `_2x` suffix
   - Optimizes with progressive JPEG and mozjpeg compression

2. **Server Integration** (`server.js`)
   - Automatically detects and serves appropriate resolution
   - Filters out downsampled images from main directory listings
   - Provides resolution-aware image URLs
   - Supports resolution query parameter (`?resolution=full` or `?resolution=downsampled`)

### Frontend Components

1. **Image Viewer** (`public/app.js`)
   - Smart resolution switching with visual indicators
   - Adaptive zoom limits based on current resolution
   - Memory-efficient caching with circular buffer
   - Performance monitoring and automatic optimization

2. **User Interface**
   - Resolution toggle button in top-right corner
   - Visual status indicator (Full/Fast)
   - Smooth transitions between resolutions
   - Responsive controls for all devices

## Setup Instructions

### Prerequisites

Ensure you have the required dependencies installed:

```bash
npm install sharp
```

### Initial Setup for Existing Images

1. **First Time Setup**: Run the downsampling script on your existing image collection:

```bash
node create-downsampled-images.js
```

This will:
- Scan the `analysis` and `coregistered-only` directories
- Create downsampled versions of all images
- Show progress and space savings
- Skip images that already have downsampled versions

### Command Line Options

The downsampling script supports several options:

```bash
# Show what would be done without creating files
node create-downsampled-images.js --dry-run

# Force recreation of existing downsampled images
node create-downsampled-images.js --force

# Suppress detailed output (show only summary)
node create-downsampled-images.js --quiet

# Show help message
node create-downsampled-images.js --help
```

## Common Usage Scenarios

### Scenario 1: Running the Script Multiple Times

**What happens**: The script intelligently skips images that already have downsampled versions.

```bash
# First run - processes all images
node create-downsampled-images.js
# Output: ✓ Processed: 150 images, ⊝ Skipped: 0 images

# Second run - skips existing downsampled images
node create-downsampled-images.js
# Output: ✓ Processed: 0 images, ⊝ Skipped: 150 images
```

### Scenario 2: Adding New Images After Initial Setup

**What happens**: Only new images without downsampled versions are processed.

```bash
# Add new images to your directories, then run:
node create-downsampled-images.js
# Output: ✓ Processed: 25 images (new), ⊝ Skipped: 150 images (existing)
```

### Scenario 3: Force Recreating Downsampled Images

**When to use**: When you want to update compression settings or fix corrupted downsampled images.

```bash
# Recreate ALL downsampled images
node create-downsampled-images.js --force
# This will overwrite existing downsampled versions
```

## Technical Details

### Image Processing

- **Algorithm**: Lanczos3 resampling for high-quality downscaling
- **Dimensions**: Exactly 50% of original width and height
- **Format**: Progressive JPEG with mozjpeg encoder
- **Quality**: 90% to balance size and quality
- **Naming**: Original filename with `_2x` suffix before extension

### File Organization

```
your-images/
├── image1.jpg           # Original full resolution
├── image1_2x.jpg        # Downsampled version (auto-generated)
├── image2.png           # Original full resolution  
├── image2_2x.jpg        # Downsampled as JPEG (auto-generated)
└── subfolder/
    ├── image3.tiff      # Original full resolution
    └── image3_2x.jpg    # Downsampled as JPEG (auto-generated)
```

### Supported Formats

**Input formats**: JPG, JPEG, PNG, GIF, WebP, TIFF, TIF
**Output format**: Always JPEG (optimized for web delivery)

### Performance Characteristics

- **Loading Speed**: Downsampled images load ~4x faster
- **Memory Usage**: ~75% reduction in memory footprint
- **File Size**: Typically 80-90% smaller than originals
- **Quality**: Visually equivalent for most viewing scenarios

## Frontend Usage

### Resolution Switching

Users can switch between resolutions using:

1. **Toggle Button**: Click the "Full/Fast" button in the top-right
2. **Keyboard Shortcut**: Press 'R' key to toggle resolution
3. **URL Parameter**: Add `?resolution=full` or `?resolution=downsampled`

### Visual Indicators

- **"Full" Badge**: Green badge indicates full resolution mode
- **"Fast" Badge**: Blue badge indicates downsampled/fast mode
- **Zoom Limits**: Automatically adjusted based on current resolution
- **Loading States**: Smooth transitions with loading indicators

### Zoom Behavior

- **Full Resolution**: Max zoom 10x for detailed inspection
- **Downsampled**: Max zoom 5x (appropriate for the resolution)
- **Auto-adjustment**: Zoom level maintained when switching resolutions

## Troubleshooting

### Common Issues

#### 1. "Sharp not found" Error
```bash
Error: Cannot find module 'sharp'
```

**Solution**: Install the Sharp library:
```bash
npm install sharp
```

#### 2. Permission Errors
```bash
Error: EACCES: permission denied
```

**Solution**: Check file permissions and ensure the script can write to image directories:
```bash
chmod 755 analysis coregistered-only
```

#### 3. Out of Memory Errors
```bash
Error: Cannot allocate memory
```

**Solution**: Process large image collections in batches or increase Node.js memory:
```bash
node --max-old-space-size=4096 create-downsampled-images.js
```

#### 4. Images Not Switching Resolution
**Symptoms**: Resolution toggle doesn't change image quality

**Solution**: 
1. Verify downsampled images exist in the same directory
2. Check browser developer console for network errors
3. Ensure server is serving the correct resolution URLs

#### 5. Downsampled Images Look Poor Quality
**Symptoms**: Significant quality loss in downsampled versions

**Investigation**: Check the generated downsampled files. The script uses high-quality settings, but some images may need manual adjustment.

**Solution**: For critical images, you can exclude them from downsampling or adjust quality settings in the script.

### Script-Specific Issues

#### Skipping Files Unexpectedly
```bash
# Check what files would be processed
node create-downsampled-images.js --dry-run

# Force processing if needed
node create-downsampled-images.js --force
```

#### Large Processing Times
- **Normal**: Large images (>50MB) may take 10-30 seconds each
- **Optimization**: Use SSD storage for faster I/O
- **Monitoring**: Script shows progress for each file

### Performance Monitoring

The frontend includes built-in performance monitoring:

- **Memory Usage**: Tracked and logged every 30 seconds
- **Network Performance**: Automatic detection of slow connections
- **Cache Efficiency**: Hit/miss ratios logged every 60 seconds
- **Load Times**: Individual image load performance tracking

Check browser console (F12) for performance reports and optimization suggestions.

## Directory Structure

The system expects images to be organized in these directories:

```
simpleViewer/
├── analysis/           # Analysis images
│   └── [folders]/      # Event folders
│       ├── *.jpg       # Original images
│       └── *.jpg_2x    # Generated downsampled images
├── coregistered-only/  # Coregistered images  
│   └── [folders]/      # Event folders
│       ├── *.jpg       # Original images
│       └── *.jpg_2x    # Generated downsampled images
└── create-downsampled-images.js  # Processing script
```

## Configuration

### Modifying the Script

You can customize the downsampling behavior by editing `create-downsampled-images.js`:

```javascript
// Configuration section (lines 5-8)
const DOWNSAMPLED_SUFFIX = '_2x';        // Suffix for downsampled files
const DIRECTORIES = ['analysis', 'coregistered-only'];  // Directories to process
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif'];

// Quality settings (lines 61-65)
.jpeg({
  quality: 90,           // JPEG quality (80-95 recommended)
  progressive: true,     // Progressive loading
  mozjpeg: true         // Use mozjpeg encoder
})
```

### Server Configuration

Resolution behavior can be modified in `server.js`:

```javascript
// Default resolution (line 7 in app.js)
this.useFullResolution = false; // false = start with fast/downsampled

// Cache settings (lines 40-42 in app.js)
this.maxCacheSize = 8;          // Number of images to cache
this.maxMemoryMB = 500;         // Memory limit in MB
```

## Best Practices

### When to Use Full Resolution
- **Detailed Analysis**: When examining fine details or annotations
- **Printing**: When preparing images for print output
- **Measurements**: When precise measurements are needed
- **Final Review**: When making final quality assessments

### When to Use Downsampled Resolution
- **Quick Navigation**: When browsing through many images
- **Overview Tasks**: When getting general sense of image content
- **Slow Connections**: When bandwidth is limited
- **Mobile Devices**: When conserving data usage

### Maintenance

1. **Regular Updates**: Run the downsampling script when adding new images
2. **Storage Monitoring**: Monitor disk usage as downsampled images add ~10-20% to total storage
3. **Performance Review**: Check browser console logs periodically for optimization opportunities
4. **Cache Clearing**: Browser may cache old versions; use Ctrl+F5 to force refresh if needed

## Migration Guide

### From Single Resolution System

If migrating from a previous version:

1. **Backup**: Create backup of your image directories
2. **Run Script**: Execute `node create-downsampled-images.js`
3. **Test**: Verify both resolutions work correctly
4. **Clean Up**: Remove any temporary files if needed

The system is backward compatible - existing functionality continues to work while adding the new dual-resolution capabilities.

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review browser console for error messages
3. Test with `--dry-run` flag to diagnose script issues
4. Verify all dependencies are properly installed