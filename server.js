const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
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
          
          const imageFiles = files.filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png'));
          const ssiFile = files.find(f => f.startsWith('SSI_coeff_'));
          
          if (imageFiles.length >= 2) {
            const sortedImages = imageFiles.filter(f => !f.startsWith('SSI_')).sort();
            datasets.push({
              id: folder,
              preEvent: `/api/image/analysis/${folder}/${sortedImages[0]}`,
              postEvent: `/api/image/analysis/${folder}/${sortedImages[1]}`,
              changeDetection: ssiFile ? `/api/image/analysis/${folder}/${ssiFile}` : null
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
            .filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png'));
          
          if (files.length >= 2) {
            const sortedImages = files.sort();
            datasets.push({
              id: folder,
              preEvent: `/api/image/coregistered-only/${folder}/${sortedImages[0]}`,
              postEvent: `/api/image/coregistered-only/${folder}/${sortedImages[1]}`,
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

app.get('/api/image/:folder/:subfolder/:filename', requireAuth, (req, res) => {
  const { folder, subfolder, filename } = req.params;
  const imagePath = path.join(folder, subfolder, filename);
  const fullPath = path.join(__dirname, imagePath);
  
  if (!fullPath.startsWith(__dirname)) {
    return res.status(403).send('Access denied');
  }
  
  if (fs.existsSync(fullPath)) {
    res.sendFile(fullPath);
  } else {
    res.status(404).send('Image not found');
  }
});

// Route for co-registered images in results folder
app.get('/api/image/:folder/:subfolder/:subsubfolder/:filename', requireAuth, (req, res) => {
  const { folder, subfolder, subsubfolder, filename } = req.params;
  const imagePath = path.join(folder, subfolder, subsubfolder, filename);
  const fullPath = path.join(__dirname, imagePath);
  
  if (!fullPath.startsWith(__dirname)) {
    return res.status(403).send('Access denied');
  }
  
  if (fs.existsSync(fullPath)) {
    res.sendFile(fullPath);
  } else {
    res.status(404).send('Image not found');
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});