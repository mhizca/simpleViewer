const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Configuration
const DOWNSAMPLED_SUFFIX = '_2x';
const DIRECTORIES = ['analysis', 'coregistered-only'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif'];

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  dim: '\x1b[2m'
};

// Check if file is an image
function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

// Get downsampled filename
function getDownsampledFilename(filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  return `${base}${DOWNSAMPLED_SUFFIX}${ext}`;
}

// Check if downsampled version already exists
function hasDownsampledVersion(filePath) {
  const dir = path.dirname(filePath);
  const downsampledName = getDownsampledFilename(path.basename(filePath));
  const downsampledPath = path.join(dir, downsampledName);
  return fs.existsSync(downsampledPath);
}

// Create downsampled version of an image
async function createDownsampledImage(sourcePath, options = {}) {
  const dir = path.dirname(sourcePath);
  const downsampledName = getDownsampledFilename(path.basename(sourcePath));
  const targetPath = path.join(dir, downsampledName);
  
  try {
    // Get original image metadata
    const metadata = await sharp(sourcePath).metadata();
    
    // Calculate new dimensions (2x downsampled = half width and height)
    const newWidth = Math.round(metadata.width / 2);
    const newHeight = Math.round(metadata.height / 2);
    
    // Process the image
    await sharp(sourcePath)
      .resize(newWidth, newHeight, {
        kernel: sharp.kernel.lanczos3, // High quality downsampling
        fastShrinkOnLoad: true
      })
      .jpeg({
        quality: 90, // High quality
        progressive: true, // Progressive JPEG for better loading
        mozjpeg: true // Use mozjpeg encoder for better compression
      })
      .toFile(targetPath);
    
    // Get file sizes for comparison
    const originalStats = await fs.promises.stat(sourcePath);
    const downsampledStats = await fs.promises.stat(targetPath);
    
    return {
      success: true,
      original: {
        path: sourcePath,
        size: originalStats.size,
        dimensions: `${metadata.width}x${metadata.height}`
      },
      downsampled: {
        path: targetPath,
        size: downsampledStats.size,
        dimensions: `${newWidth}x${newHeight}`,
        reduction: ((1 - downsampledStats.size / originalStats.size) * 100).toFixed(1)
      }
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      path: sourcePath
    };
  }
}

// Process a directory recursively
async function processDirectory(dirPath, options = {}) {
  const results = {
    processed: 0,
    skipped: 0,
    errors: 0,
    totalOriginalSize: 0,
    totalDownsampledSize: 0
  };
  
  async function walkDir(currentPath) {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile() && isImageFile(entry.name)) {
        // Skip if it's already a downsampled image
        if (entry.name.includes(DOWNSAMPLED_SUFFIX)) {
          continue;
        }
        
        // Check if downsampled version already exists
        if (hasDownsampledVersion(fullPath) && !options.force) {
          if (!options.quiet) {
            console.log(`${colors.yellow}⊝ Skipped:${colors.reset} ${fullPath} ${colors.dim}(downsampled version exists)${colors.reset}`);
          }
          results.skipped++;
          continue;
        }
        
        // Create downsampled version
        if (!options.dryRun) {
          const result = await createDownsampledImage(fullPath, options);
          
          if (result.success) {
            results.processed++;
            results.totalOriginalSize += result.original.size;
            results.totalDownsampledSize += result.downsampled.size;
            
            if (!options.quiet) {
              console.log(`${colors.green}✓ Processed:${colors.reset} ${result.original.path}`);
              console.log(`  ${colors.dim}Original: ${result.original.dimensions} (${formatBytes(result.original.size)})${colors.reset}`);
              console.log(`  ${colors.dim}Downsampled: ${result.downsampled.dimensions} (${formatBytes(result.downsampled.size)}) -${result.downsampled.reduction}%${colors.reset}`);
            }
          } else {
            results.errors++;
            console.error(`${colors.red}✗ Error:${colors.reset} ${result.path} - ${result.error}`);
          }
        } else {
          // Dry run - just show what would be done
          console.log(`${colors.blue}◯ Would process:${colors.reset} ${fullPath}`);
          results.processed++;
        }
      }
    }
  }
  
  await walkDir(dirPath);
  return results;
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Main function
async function main() {
  console.log(`${colors.blue}Image Downsampling Tool${colors.reset}`);
  console.log('========================\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    quiet: args.includes('--quiet')
  };
  
  if (args.includes('--help')) {
    console.log('Usage: node create-downsampled-images.js [options]');
    console.log('\nOptions:');
    console.log('  --dry-run    Show what would be done without actually doing it');
    console.log('  --force      Recreate downsampled images even if they exist');
    console.log('  --quiet      Suppress detailed output');
    console.log('  --help       Show this help message');
    return;
  }
  
  if (options.dryRun) {
    console.log(`${colors.yellow}DRY RUN MODE - No files will be created${colors.reset}\n`);
  }
  
  const overallResults = {
    processed: 0,
    skipped: 0,
    errors: 0,
    totalOriginalSize: 0,
    totalDownsampledSize: 0
  };
  
  // Process each directory
  for (const dir of DIRECTORIES) {
    if (fs.existsSync(dir)) {
      console.log(`\nProcessing directory: ${colors.blue}${dir}${colors.reset}`);
      const results = await processDirectory(dir, options);
      
      // Aggregate results
      overallResults.processed += results.processed;
      overallResults.skipped += results.skipped;
      overallResults.errors += results.errors;
      overallResults.totalOriginalSize += results.totalOriginalSize;
      overallResults.totalDownsampledSize += results.totalDownsampledSize;
    } else {
      console.log(`${colors.yellow}Directory not found: ${dir}${colors.reset}`);
    }
  }
  
  // Print summary
  console.log(`\n${colors.blue}Summary${colors.reset}`);
  console.log('=======');
  console.log(`${colors.green}✓ Processed:${colors.reset} ${overallResults.processed} images`);
  console.log(`${colors.yellow}⊝ Skipped:${colors.reset} ${overallResults.skipped} images`);
  if (overallResults.errors > 0) {
    console.log(`${colors.red}✗ Errors:${colors.reset} ${overallResults.errors} images`);
  }
  
  if (!options.dryRun && overallResults.processed > 0) {
    const reduction = ((1 - overallResults.totalDownsampledSize / overallResults.totalOriginalSize) * 100).toFixed(1);
    console.log(`\n${colors.blue}Space Savings:${colors.reset}`);
    console.log(`Original total: ${formatBytes(overallResults.totalOriginalSize)}`);
    console.log(`Downsampled total: ${formatBytes(overallResults.totalDownsampledSize)}`);
    console.log(`Space saved: ${formatBytes(overallResults.totalOriginalSize - overallResults.totalDownsampledSize)} (${reduction}% reduction)`);
  }
  
  const totalTime = process.uptime();
  console.log(`\nTotal time: ${totalTime.toFixed(2)} seconds`);
}

// Run the script
main().catch(console.error);