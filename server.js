const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // set to true if using https
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/login.html');
  }
};

// Helper function to get MIME type based on file extension
const getMimeType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff'
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

// Helper function to generate both full and downsampled image URLs with vegetation filter support
const generateImageUrls = (basePath, filename, hasVegFilter = false) => {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const downsampledFilename = `${base}_2x${ext}`;
  
  const urls = {
    full: `/api/image/${basePath}/${filename}`,
    downsampled: `/api/image/${basePath}/${downsampledFilename}`
  };
  
  // Add vegetation filter variants if available
  if (hasVegFilter) {
    urls.vegFilter = {
      full: `/api/image/${basePath}/no_veg_filter/${filename}`,
      downsampled: `/api/image/${basePath}/no_veg_filter/${downsampledFilename}`
    };
  }
  
  return urls;
};

// Helper function to check if downsampled version exists
const hasDownsampledVersion = (fullPath) => {
  const dir = path.dirname(fullPath);
  const filename = path.basename(fullPath);
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const downsampledFilename = `${base}_2x${ext}`;
  const downsampledPath = path.join(dir, downsampledFilename);
  
  return fs.existsSync(downsampledPath);
};

// Helper function to check if vegetation filter version exists
const hasVegetationFilter = (basePath, filename) => {
  const vegFilterDir = path.join(__dirname, basePath, 'no_veg_filter');
  if (!fs.existsSync(vegFilterDir)) {
    return false;
  }
  
  const vegFilterFile = path.join(vegFilterDir, filename);
  return fs.existsSync(vegFilterFile);
};

// Helper function to detect if a dataset folder has vegetation filter variants
const detectVegetationFilterSupport = (folderPath) => {
  const vegFilterPath = path.join(folderPath, 'no_veg_filter');
  return fs.existsSync(vegFilterPath) && fs.statSync(vegFilterPath).isDirectory();
};

// Add progressive JPEG hint for browsers
const getImageHeaders = (mimeType, stats, etag) => {
  const headers = {
    'Cache-Control': 'public, max-age=604800, immutable', // 7 days cache
    'ETag': etag,
    'Last-Modified': stats.mtime.toUTCString(),
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeType,
    'Vary': 'Accept-Encoding'
  };
  
  // Add hint for progressive JPEG rendering
  if (mimeType === 'image/jpeg') {
    headers['X-Content-Type-Options'] = 'nosniff';
    headers['X-Progressive'] = 'true'; // Hint for CDNs and browsers
  }
  
  return headers;
};

// Optimized image serving function
const serveOptimizedImage = async (req, res, imagePath) => {
  const fullPath = path.resolve(__dirname, imagePath);
  
  // Security check - ensure path is within project directory
  if (!fullPath.startsWith(path.resolve(__dirname))) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    // Check if file exists and get stats
    const stats = await fs.promises.stat(fullPath);
    
    // Generate strong ETag using file stats and content hash for better cache validation
    const etag = `"${stats.mtime.getTime()}-${stats.size}"`;
    const lastModified = stats.mtime.toUTCString();
    const mimeType = getMimeType(path.basename(fullPath));
    
    // Set comprehensive caching headers
    res.set(getImageHeaders(mimeType, stats, etag));
    
    // Handle conditional requests (304 Not Modified)
    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];
    
    if ((ifNoneMatch && ifNoneMatch === etag) || 
        (ifModifiedSince && new Date(ifModifiedSince) >= stats.mtime)) {
      return res.status(304).end();
    }
    
    // Handle range requests for partial content delivery
    const range = req.headers.range;
    if (range) {
      const ranges = range.replace(/bytes=/, '').split('-');
      const start = parseInt(ranges[0], 10) || 0;
      const end = ranges[1] ? parseInt(ranges[1], 10) : stats.size - 1;
      
      // Validate range
      if (start >= stats.size || end >= stats.size || start > end) {
        res.set('Content-Range', `bytes */${stats.size}`);
        return res.status(416).json({ error: 'Range Not Satisfiable' });
      }
      
      const chunkSize = (end - start) + 1;
      
      res.set({
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Content-Length': chunkSize.toString()
      });
      
      res.status(206);
      
      // Create read stream with proper error handling
      const stream = fs.createReadStream(fullPath, { start, end });
      
      // Handle stream errors
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to read file' });
        }
      });
      
      // Handle client disconnect
      req.on('close', () => {
        stream.destroy();
      });
      
      return stream.pipe(res);
    }
    
    // For full file requests, set content length and use sendFile for better performance
    res.set('Content-Length', stats.size.toString());
    
    // Use sendFile with proper error handling for full file delivery
    res.sendFile(fullPath, (err) => {
      if (err) {
        console.error('SendFile error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to serve file' });
        }
      }
    });
    
  } catch (error) {
    console.error('File access error:', error);
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Image not found' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Serve login page without authentication
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === process.env.LOGIN_USERNAME && password === process.env.LOGIN_PASSWORD) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Protect main app
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static files with authentication
app.use('/styles.css', requireAuth, express.static('public/styles.css'));
app.use('/app.js', requireAuth, express.static('public/app.js'));

// Serve panorama files
app.get('/panorama.png', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'panorama.png'));
});

app.get('/highlighted_box_centers.csv', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'highlighted_box_centers.csv'));
});

app.get('/api/datasets/:project', requireAuth, (req, res) => {
  const { project } = req.params;
  
  try {
    const datasets = [];
    
    if (project === 'analysis') {
      const analysisPath = path.join(__dirname, 'analysis');
      
      if (fs.existsSync(analysisPath)) {
        const folders = fs.readdirSync(analysisPath)
          .filter(file => fs.statSync(path.join(analysisPath, file)).isDirectory())
          .sort((a, b) => parseInt(a) - parseInt(b));
        
        folders.forEach(folder => {
          const folderPath = path.join(analysisPath, folder);
          const files = fs.readdirSync(folderPath);
          
          // Filter out downsampled images (_2x suffix) from main image list
          const imageFiles = files.filter(f => 
            (f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png')) &&
            !f.includes('_2x.')
          );
          const ssiFile = files.find(f => f.startsWith('SSI_coeff_'));
          
          if (imageFiles.length >= 2) {
            const sortedImages = imageFiles.filter(f => !f.startsWith('SSI_')).sort();
            
            // Check if this dataset has vegetation filter support
            const hasVegFilterSupport = detectVegetationFilterSupport(folderPath);
            
            // Check if SSI file has vegetation filter variant
            const ssiHasVegFilter = ssiFile ? hasVegetationFilter(`analysis/${folder}`, ssiFile) : false;
            
            // Generate URLs for both full and downsampled versions
            const preEventUrls = generateImageUrls(`analysis/${folder}`, sortedImages[0]);
            const postEventUrls = generateImageUrls(`analysis/${folder}`, sortedImages[1]);
            
            // Generate change detection URLs with vegetation filter support
            const changeDetectionUrls = ssiFile ? generateImageUrls(`analysis/${folder}`, ssiFile, ssiHasVegFilter) : null;
            
            datasets.push({
              id: folder,
              preEvent: preEventUrls,
              postEvent: postEventUrls,
              changeDetection: changeDetectionUrls,
              hasVegetationFilter: hasVegFilterSupport,
              vegetationFilterAvailable: {
                changeDetection: ssiHasVegFilter
              }
            });
          }
        });
      }
    } else if (project === 'coregistered') {
      const coregisteredPath = path.join(__dirname, 'coregistered-only');
      
      if (fs.existsSync(coregisteredPath)) {
        const folders = fs.readdirSync(coregisteredPath)
          .filter(file => fs.statSync(path.join(coregisteredPath, file)).isDirectory())
          .sort((a, b) => {
            const aNum = parseInt(a);
            const bNum = parseInt(b);
            if (isNaN(aNum) || isNaN(bNum)) return a.localeCompare(b);
            return aNum - bNum;
          });
        
        folders.forEach(folder => {
          const folderPath = path.join(coregisteredPath, folder);
          const files = fs.readdirSync(folderPath)
            .filter(f => 
              (f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png')) &&
              !f.includes('_2x.')
            );
          
          if (files.length >= 2) {
            const sortedImages = files.sort();
            
            // Generate URLs for both full and downsampled versions
            const preEventUrls = generateImageUrls(`coregistered-only/${folder}`, sortedImages[0]);
            const postEventUrls = generateImageUrls(`coregistered-only/${folder}`, sortedImages[1]);
            
            datasets.push({
              id: folder,
              preEvent: preEventUrls,
              postEvent: postEventUrls,
              changeDetection: null
            });
          }
        });
      }
    }
    
    res.json(datasets);
  } catch (error) {
    console.error('Error reading datasets:', error);
    res.status(500).json({ error: 'Failed to read datasets' });
  }
});

// Enhanced image serving route with resolution support
app.get('/api/image/:folder/:subfolder/:filename', requireAuth, async (req, res) => {
  const { folder, subfolder, filename } = req.params;
  const { resolution } = req.query;
  
  let actualFilename = filename;
  
  // If downsampled version is requested, modify filename
  if (resolution === 'downsampled' || resolution === '2x') {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    
    // Check if it already has _2x suffix (direct access)
    if (!base.endsWith('_2x')) {
      actualFilename = `${base}_2x${ext}`;
    }
  }
  
  const imagePath = path.join(folder, subfolder, actualFilename);
  await serveOptimizedImage(req, res, imagePath);
});

// Route for vegetation filter images (no_veg_filter subdirectory)
app.get('/api/image/:folder/:subfolder/no_veg_filter/:filename', requireAuth, async (req, res) => {
  const { folder, subfolder, filename } = req.params;
  const { resolution } = req.query;
  
  let actualFilename = filename;
  
  // If downsampled version is requested, modify filename
  if (resolution === 'downsampled' || resolution === '2x') {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    
    // Check if it already has _2x suffix (direct access)
    if (!base.endsWith('_2x')) {
      actualFilename = `${base}_2x${ext}`;
    }
  }
  
  const imagePath = path.join(folder, subfolder, 'no_veg_filter', actualFilename);
  
  // Check if the vegetation filter version exists, fallback to normal version if not
  const fullVegFilterPath = path.resolve(__dirname, imagePath);
  const normalImagePath = path.join(folder, subfolder, actualFilename);
  
  try {
    await fs.promises.access(fullVegFilterPath);
    await serveOptimizedImage(req, res, imagePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`Vegetation filter image not found: ${imagePath}, falling back to normal version`);
      await serveOptimizedImage(req, res, normalImagePath);
    } else {
      console.error('Error accessing vegetation filter image:', error);
      res.status(500).json({ error: 'Failed to access image' });
    }
  }
});

// Route for co-registered images in results folder (enhanced with resolution support)
app.get('/api/image/:folder/:subfolder/:subsubfolder/:filename', requireAuth, async (req, res) => {
  const { folder, subfolder, subsubfolder, filename } = req.params;
  const { resolution } = req.query;
  
  let actualFilename = filename;
  
  // If downsampled version is requested, modify filename
  if (resolution === 'downsampled' || resolution === '2x') {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    
    // Check if it already has _2x suffix (direct access)
    if (!base.endsWith('_2x')) {
      actualFilename = `${base}_2x${ext}`;
    }
  }
  
  const imagePath = path.join(folder, subfolder, subsubfolder, actualFilename);
  await serveOptimizedImage(req, res, imagePath);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});