import { Utils } from './Utils.js';

/**
 * Panorama overlay management and navigation
 */
export class PanoramaManager {
    constructor() {
        // Panorama configuration
        this.boxMappings = [];
        this.panoramaImage = { width: 1347, height: 386 };
        this.boxDimensions = { width: 190.25, height: 190.39 };
        
        // DOM elements
        this.panoramaImageElement = null;
        this.highlightBox = null;
        this.gridOverlay = null;
        this.hoverHighlight = null;
        
        // Event callbacks
        this.onImagePairSelected = null;
        
        this.setupElements();
        this.loadBoxMappings();
    }

    /**
     * Setup panorama DOM elements
     */
    setupElements() {
        this.panoramaImageElement = document.getElementById('panoramaImage');
        this.highlightBox = document.getElementById('highlightBox');
        
        if (!this.panoramaImageElement || !this.highlightBox) {
            console.error('Panorama elements not found in DOM');
            return;
        }
        
        this.setupEventListeners();
        this.createPanoramaGridOverlay();
    }

    /**
     * Setup panorama event listeners
     */
    setupEventListeners() {
        // Click event for image pair selection
        this.panoramaImageElement.addEventListener('click', (e) => this.handlePanoramaClick(e));
        
        // Mouse move for hover effects
        this.panoramaImageElement.addEventListener('mousemove', (e) => this.handlePanoramaMouseMove(e));
        
        // Show/hide grid on hover
        this.panoramaImageElement.addEventListener('mouseenter', () => {
            if (this.gridOverlay) {
                this.gridOverlay.style.opacity = '0.6';
            }
        });
        
        this.panoramaImageElement.addEventListener('mouseleave', () => {
            if (this.gridOverlay) {
                this.gridOverlay.style.opacity = '0';
            }
            this.clearHoverHighlight();
        });
        
        // Update highlight and grid on window resize
        window.addEventListener('resize', Utils.debounce(() => {
            this.updatePanoramaHighlight();
            this.updateGridOverlay();
        }, 100));
    }

    /**
     * Load panorama box mappings from CSV
     */
    async loadBoxMappings() {
        try {
            const response = await fetch('highlighted_box_centers.csv');
            const csvText = await response.text();
            this.parseBoxMappings(csvText);
        } catch (error) {
            console.error('Error loading box mappings:', error);
        }
    }

    /**
     * Parse box mappings from CSV text
     */
    parseBoxMappings(csvText) {
        const lines = csvText.split('\n');
        this.boxMappings = [];
        
        // Parse header information
        this.parseCSVHeader(lines);
        
        // Find the JSON section in the CSV
        let jsonStartIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '# JSON format:') {
                jsonStartIndex = i + 1;
                break;
            }
        }
        
        if (jsonStartIndex !== -1) {
            // Extract JSON data
            let jsonText = '';
            for (let i = jsonStartIndex; i < lines.length; i++) {
                if (lines[i].trim()) {
                    jsonText += lines[i] + '\n';
                }
            }
            
            try {
                this.boxMappings = JSON.parse(jsonText);
                console.log(`Loaded ${this.boxMappings.length} box mappings from JSON`);
            } catch (error) {
                console.error('Error parsing box mappings JSON:', error);
                this.parseCSVBoxMappings(lines);
            }
        } else {
            this.parseCSVBoxMappings(lines);
        }
        
        // Update grid overlay after loading mappings
        this.updateGridOverlay();
    }

    /**
     * Parse CSV format as fallback
     */
    parseCSVBoxMappings(lines) {
        this.boxMappings = [];
        let imageNumber = 1;
        
        for (let i = 8; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('#') && line.includes(',')) {
                const parts = line.split(',');
                if (parts.length >= 5) {
                    const mapping = {
                        numero: imageNumber++,
                        x: parseFloat(parts[1]),
                        y: parseFloat(parts[2]),
                        col: parseInt(parts[3]),
                        row: parseInt(parts[4])
                    };
                    if (!isNaN(mapping.x) && !isNaN(mapping.y)) {
                        this.boxMappings.push(mapping);
                    }
                }
            }
        }
        console.log(`Parsed ${this.boxMappings.length} box mappings from CSV`);
    }

    /**
     * Parse CSV header for panorama dimensions
     */
    parseCSVHeader(lines) {
        for (let i = 0; i < Math.min(10, lines.length); i++) {
            const line = lines[i].trim();
            
            // Parse panorama image dimensions
            if (line.startsWith('# Image:')) {
                const match = line.match(/(\d+)x(\d+)/);
                if (match) {
                    this.panoramaImage.width = parseInt(match[1]);
                    this.panoramaImage.height = parseInt(match[2]);
                    console.log(`Panorama dimensions: ${this.panoramaImage.width}x${this.panoramaImage.height}`);
                }
            }
            
            // Parse box dimensions
            if (line.startsWith('# Box dimensions:')) {
                const match = line.match(/([\d.]+)x([\d.]+)/);
                if (match) {
                    this.boxDimensions.width = parseFloat(match[1]);
                    this.boxDimensions.height = parseFloat(match[2]);
                    console.log(`Box dimensions: ${this.boxDimensions.width}x${this.boxDimensions.height}`);
                }
            }
        }
    }

    /**
     * Update panorama highlight for current image
     */
    updatePanoramaHighlight(imageNumber) {
        if (!this.boxMappings.length || !imageNumber) {
            this.highlightBox.style.display = 'none';
            return;
        }
        
        // Find the mapping for current image number
        const mapping = this.boxMappings.find(m => m.numero === imageNumber);
        
        if (mapping) {
            const panoramaRect = this.panoramaImageElement.getBoundingClientRect();
            const scaleX = panoramaRect.width / this.panoramaImage.width;
            const scaleY = panoramaRect.height / this.panoramaImage.height;
            
            // Calculate box position (center the box around the coordinates)
            const boxLeft = (mapping.x - this.boxDimensions.width / 2) * scaleX;
            const boxTop = (mapping.y - this.boxDimensions.height / 2) * scaleY;
            const boxWidth = this.boxDimensions.width * scaleX;
            const boxHeight = this.boxDimensions.height * scaleY;
            
            // Update highlight box
            this.highlightBox.style.left = `${boxLeft}px`;
            this.highlightBox.style.top = `${boxTop}px`;
            this.highlightBox.style.width = `${boxWidth}px`;
            this.highlightBox.style.height = `${boxHeight}px`;
            this.highlightBox.style.display = 'block';
            
            console.log(`Highlighting box for image ${imageNumber} at (${mapping.x}, ${mapping.y})`);
        } else {
            this.highlightBox.style.display = 'none';
            console.log(`No mapping found for image ${imageNumber}`);
        }
    }

    /**
     * Handle panorama click for navigation
     */
    handlePanoramaClick(e) {
        e.preventDefault();
        
        if (!this.boxMappings.length) {
            console.warn('Box mappings not loaded yet');
            return;
        }
        
        // Get click coordinates relative to the panorama image
        const rect = this.panoramaImageElement.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Convert to panorama coordinates
        const scaleX = this.panoramaImage.width / rect.width;
        const scaleY = this.panoramaImage.height / rect.height;
        
        const panoramaX = clickX * scaleX;
        const panoramaY = clickY * scaleY;
        
        console.log(`Panorama click at: (${panoramaX.toFixed(1)}, ${panoramaY.toFixed(1)})`);
        
        // Find the closest image pair
        const closestMapping = this.findClosestImagePair(panoramaX, panoramaY);
        
        if (closestMapping) {
            console.log(`Closest image pair: ${closestMapping.numero} at (${closestMapping.x}, ${closestMapping.y})`);
            this.selectImagePair(closestMapping.numero);
        }
    }

    /**
     * Find closest image pair to click coordinates
     */
    findClosestImagePair(x, y) {
        if (!this.boxMappings.length) return null;
        
        // First, try to find if click is within any box boundary
        let directMapping = this.findDirectBoxMapping(x, y);
        if (directMapping) {
            console.log(`Direct hit in box for image: ${directMapping.numero}`);
            return directMapping;
        }
        
        // If not in any box, find the closest box center
        let closestMapping = null;
        let minDistance = Infinity;
        
        for (const mapping of this.boxMappings) {
            const distance = Math.sqrt(
                Math.pow(x - mapping.x, 2) + Math.pow(y - mapping.y, 2)
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestMapping = mapping;
            }
        }
        
        console.log(`Found closest mapping at distance: ${minDistance.toFixed(1)}px`);
        return closestMapping;
    }

    /**
     * Find direct box mapping if click is within box boundaries
     */
    findDirectBoxMapping(x, y) {
        for (const mapping of this.boxMappings) {
            const boxLeft = mapping.x - this.boxDimensions.width / 2;
            const boxRight = mapping.x + this.boxDimensions.width / 2;
            const boxTop = mapping.y - this.boxDimensions.height / 2;
            const boxBottom = mapping.y + this.boxDimensions.height / 2;
            
            if (x >= boxLeft && x <= boxRight && y >= boxTop && y <= boxBottom) {
                return mapping;
            }
        }
        return null;
    }

    /**
     * Select image pair and notify callback
     */
    selectImagePair(imageNumber) {
        if (this.onImagePairSelected) {
            this.onImagePairSelected(imageNumber);
        }
        
        // Visual feedback
        this.highlightSelectedArea(imageNumber);
    }

    /**
     * Show visual feedback for selected area
     */
    highlightSelectedArea(imageNumber) {
        const mapping = this.boxMappings.find(m => m.numero === imageNumber);
        if (!mapping) return;
        
        // Create temporary highlight effect
        const highlight = document.createElement('div');
        highlight.style.cssText = `
            position: absolute;
            border: 3px solid #00ff00;
            background: rgba(0, 255, 0, 0.2);
            pointer-events: none;
            border-radius: 4px;
            z-index: 1000;
            animation: pulse 0.8s ease-in-out;
        `;
        
        // Calculate position and size relative to panorama container
        const panoramaRect = this.panoramaImageElement.getBoundingClientRect();
        const scaleX = panoramaRect.width / this.panoramaImage.width;
        const scaleY = panoramaRect.height / this.panoramaImage.height;
        
        const boxLeft = (mapping.x - this.boxDimensions.width / 2) * scaleX;
        const boxTop = (mapping.y - this.boxDimensions.height / 2) * scaleY;
        const boxWidth = this.boxDimensions.width * scaleX;
        const boxHeight = this.boxDimensions.height * scaleY;
        
        highlight.style.left = `${boxLeft}px`;
        highlight.style.top = `${boxTop}px`;
        highlight.style.width = `${boxWidth}px`;
        highlight.style.height = `${boxHeight}px`;
        
        // Add to panorama container
        const panoramaContainer = document.querySelector('.panorama-container');
        panoramaContainer.appendChild(highlight);
        
        // Remove after animation
        setTimeout(() => {
            if (highlight.parentNode) {
                highlight.parentNode.removeChild(highlight);
            }
        }, 800);
    }

    /**
     * Create panorama grid overlay
     */
    createPanoramaGridOverlay() {
        this.gridOverlay = document.createElement('canvas');
        this.gridOverlay.className = 'panorama-grid-overlay';
        this.gridOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 1;
        `;
        
        const panoramaContainer = document.querySelector('.panorama-container');
        if (panoramaContainer) {
            panoramaContainer.appendChild(this.gridOverlay);
            this.updateGridOverlay();
        }
    }

    /**
     * Update grid overlay
     */
    updateGridOverlay() {
        if (!this.gridOverlay || !this.boxMappings.length) return;
        
        const panoramaRect = this.panoramaImageElement.getBoundingClientRect();
        const containerRect = document.querySelector('.panorama-container')?.getBoundingClientRect();
        
        if (!containerRect) return;
        
        // Set canvas size to match container
        this.gridOverlay.width = containerRect.width;
        this.gridOverlay.height = containerRect.height;
        
        const ctx = this.gridOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.gridOverlay.width, this.gridOverlay.height);
        
        // Calculate scaling factors
        const scaleX = panoramaRect.width / this.panoramaImage.width;
        const scaleY = panoramaRect.height / this.panoramaImage.height;
        
        // Draw subtle grid boxes for available areas
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        
        for (const mapping of this.boxMappings) {
            const boxLeft = (mapping.x - this.boxDimensions.width / 2) * scaleX;
            const boxTop = (mapping.y - this.boxDimensions.height / 2) * scaleY;
            const boxWidth = this.boxDimensions.width * scaleX;
            const boxHeight = this.boxDimensions.height * scaleY;
            
            ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight);
            
            // Add small dot at center
            ctx.save();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.arc(mapping.x * scaleX, mapping.y * scaleY, 1, 0, 2 * Math.PI);
            ctx.fill();
            ctx.restore();
        }
    }

    /**
     * Handle panorama mouse move for hover effects
     */
    handlePanoramaMouseMove(e) {
        if (!this.boxMappings.length) return;
        
        // Get hover coordinates
        const rect = this.panoramaImageElement.getBoundingClientRect();
        const hoverX = e.clientX - rect.left;
        const hoverY = e.clientY - rect.top;
        
        // Convert to panorama coordinates
        const scaleX = this.panoramaImage.width / rect.width;
        const scaleY = this.panoramaImage.height / rect.height;
        
        const panoramaX = hoverX * scaleX;
        const panoramaY = hoverY * scaleY;
        
        // Find what would be selected
        const closestMapping = this.findClosestImagePair(panoramaX, panoramaY);
        
        if (closestMapping) {
            this.showHoverHighlight(closestMapping);
        }
    }

    /**
     * Show hover highlight
     */
    showHoverHighlight(mapping) {
        this.clearHoverHighlight();
        
        this.hoverHighlight = document.createElement('div');
        this.hoverHighlight.style.cssText = `
            position: absolute;
            border: 2px solid rgba(0, 255, 0, 0.8);
            background: rgba(0, 255, 0, 0.1);
            pointer-events: none;
            border-radius: 3px;
            z-index: 2;
            transition: all 0.1s ease;
        `;
        
        // Calculate position and size
        const panoramaRect = this.panoramaImageElement.getBoundingClientRect();
        const scaleX = panoramaRect.width / this.panoramaImage.width;
        const scaleY = panoramaRect.height / this.panoramaImage.height;
        
        const boxLeft = (mapping.x - this.boxDimensions.width / 2) * scaleX;
        const boxTop = (mapping.y - this.boxDimensions.height / 2) * scaleY;
        const boxWidth = this.boxDimensions.width * scaleX;
        const boxHeight = this.boxDimensions.height * scaleY;
        
        this.hoverHighlight.style.left = `${boxLeft}px`;
        this.hoverHighlight.style.top = `${boxTop}px`;
        this.hoverHighlight.style.width = `${boxWidth}px`;
        this.hoverHighlight.style.height = `${boxHeight}px`;
        this.hoverHighlight.title = `Image pair ${mapping.numero}`;
        
        const panoramaContainer = document.querySelector('.panorama-container');
        if (panoramaContainer) {
            panoramaContainer.appendChild(this.hoverHighlight);
        }
    }

    /**
     * Clear hover highlight
     */
    clearHoverHighlight() {
        if (this.hoverHighlight && this.hoverHighlight.parentNode) {
            this.hoverHighlight.parentNode.removeChild(this.hoverHighlight);
            this.hoverHighlight = null;
        }
    }

    /**
     * Set callback for image pair selection
     */
    setImagePairSelectedCallback(callback) {
        this.onImagePairSelected = callback;
    }

    /**
     * Get box mappings
     */
    getBoxMappings() {
        return this.boxMappings;
    }

    /**
     * Cleanup panorama manager
     */
    cleanup() {
        this.clearHoverHighlight();
        
        if (this.gridOverlay && this.gridOverlay.parentNode) {
            this.gridOverlay.parentNode.removeChild(this.gridOverlay);
        }
        
        console.log('PanoramaManager cleanup completed');
    }
}