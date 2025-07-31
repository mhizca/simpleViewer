/**
 * Viewport management for zoom, pan, and touch interactions
 */
export class ViewportManager {
    constructor(viewer, image, zoomLevelText) {
        this.viewer = viewer;
        this.image = image;
        this.zoomLevelText = zoomLevelText;
        
        // Zoom and pan state
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 20;
        this.translateX = 0;
        this.translateY = 0;
        
        // Interaction state
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        
        // Touch tracking
        this.touches = [];
        this.lastTouchDistance = 0;
        
        // State tracking
        this.isFirstLoad = true;
        this.wasResolutionChanged = false;
        
        this.setupEventListeners();
    }

    /**
     * Setup all viewport-related event listeners
     */
    setupEventListeners() {
        // Mouse events
        this.viewer.addEventListener('mousedown', (e) => this.startDrag(e));
        this.viewer.addEventListener('mousemove', (e) => this.drag(e));
        this.viewer.addEventListener('mouseup', () => this.endDrag());
        this.viewer.addEventListener('mouseleave', () => this.endDrag());
        
        // Touch events for mobile
        this.viewer.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.viewer.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.viewer.addEventListener('touchend', (e) => this.handleTouchEnd(e));
        
        // Wheel event for zoom
        this.viewer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const rect = this.viewer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.zoomAtPoint(delta, x, y);
        });
    }

    /**
     * Zoom by factor
     */
    zoom(factor) {
        const newScale = this.scale * factor;
        if (newScale >= this.minScale && newScale <= this.maxScale) {
            this.scale = newScale;
            this.updateTransform();
        }
    }

    /**
     * Zoom at specific point (mouse/touch position)
     */
    zoomAtPoint(factor, x, y) {
        const newScale = this.scale * factor;
        if (newScale >= this.minScale && newScale <= this.maxScale) {
            const viewerRect = this.viewer.getBoundingClientRect();
            const viewerCenterX = viewerRect.width / 2;
            const viewerCenterY = viewerRect.height / 2;
            
            // Calculate current point in world coordinates
            const worldX = (x - viewerCenterX - this.translateX) / this.scale;
            const worldY = (y - viewerCenterY - this.translateY) / this.scale;
            
            // Update scale
            this.scale = newScale;
            
            // Calculate new translation to keep the world point under the cursor
            this.translateX = x - viewerCenterX - worldX * this.scale;
            this.translateY = y - viewerCenterY - worldY * this.scale;
            
            this.updateTransform();
        }
    }

    /**
     * Reset view to fit the image
     */
    resetView() {
        this.fitToView();
    }

    /**
     * Fit image to viewport
     */
    fitToView() {
        const viewerRect = this.viewer.getBoundingClientRect();
        const imgWidth = this.image.naturalWidth || this.image.width;
        const imgHeight = this.image.naturalHeight || this.image.height;
        
        if (!imgWidth || !imgHeight || !viewerRect.width || !viewerRect.height) {
            console.warn('Cannot fit to view: invalid dimensions', {
                imgWidth, imgHeight, 
                viewerWidth: viewerRect.width, 
                viewerHeight: viewerRect.height
            });
            return;
        }
        
        const scaleX = viewerRect.width / imgWidth;
        const scaleY = viewerRect.height / imgHeight;
        const baseScale = Math.min(scaleX, scaleY);
        
        this.scale = baseScale;
        this.translateX = 0;
        this.translateY = 0;
        this.updateTransform();
    }

    /**
     * Update the transform applied to the image
     */
    updateTransform() {
        this.image.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        this.zoomLevelText.textContent = `${Math.round(this.scale * 100)}%`;
    }

    /**
     * Start dragging
     */
    startDrag(e) {
        this.isDragging = true;
        this.startX = e.clientX - this.translateX;
        this.startY = e.clientY - this.translateY;
        this.viewer.style.cursor = 'grabbing';
    }

    /**
     * Handle drag movement
     */
    drag(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        this.translateX = e.clientX - this.startX;
        this.translateY = e.clientY - this.startY;
        this.updateTransform();
    }

    /**
     * End dragging
     */
    endDrag() {
        this.isDragging = false;
        this.viewer.style.cursor = 'grab';
    }

    /**
     * Handle touch start
     */
    handleTouchStart(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);
        
        if (this.touches.length === 1) {
            // Single touch - start dragging
            const touch = this.touches[0];
            this.isDragging = true;
            this.startX = touch.clientX - this.translateX;
            this.startY = touch.clientY - this.translateY;
        } else if (this.touches.length === 2) {
            // Two finger touch - prepare for pinch zoom
            this.isDragging = false;
            const touch1 = this.touches[0];
            const touch2 = this.touches[1];
            this.lastTouchDistance = Math.sqrt(
                Math.pow(touch2.clientX - touch1.clientX, 2) +
                Math.pow(touch2.clientY - touch1.clientY, 2)
            );
        }
    }

    /**
     * Handle touch move
     */
    handleTouchMove(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);
        
        if (this.touches.length === 1 && this.isDragging) {
            // Single touch drag
            const touch = this.touches[0];
            this.translateX = touch.clientX - this.startX;
            this.translateY = touch.clientY - this.startY;
            this.updateTransform();
        } else if (this.touches.length === 2) {
            // Two finger pinch zoom
            const touch1 = this.touches[0];
            const touch2 = this.touches[1];
            const currentDistance = Math.sqrt(
                Math.pow(touch2.clientX - touch1.clientX, 2) +
                Math.pow(touch2.clientY - touch1.clientY, 2)
            );
            
            if (this.lastTouchDistance > 0) {
                const delta = currentDistance / this.lastTouchDistance;
                const centerX = (touch1.clientX + touch2.clientX) / 2;
                const centerY = (touch1.clientY + touch2.clientY) / 2;
                
                const rect = this.viewer.getBoundingClientRect();
                const x = centerX - rect.left;
                const y = centerY - rect.top;
                
                this.zoomAtPoint(delta, x, y);
            }
            
            this.lastTouchDistance = currentDistance;
        }
    }

    /**
     * Handle touch end
     */
    handleTouchEnd(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);
        
        if (this.touches.length === 0) {
            this.isDragging = false;
            this.lastTouchDistance = 0;
        } else if (this.touches.length === 1) {
            // Switched from two finger to one finger - restart single touch drag
            const touch = this.touches[0];
            this.isDragging = true;
            this.startX = touch.clientX - this.translateX;
            this.startY = touch.clientY - this.translateY;
            this.lastTouchDistance = 0;
        }
    }

    /**
     * Update max zoom based on resolution
     */
    updateMaxZoom() {
        this.maxScale = 20;
        
        // If current scale exceeds new max, clamp it
        if (this.scale > this.maxScale) {
            this.scale = this.maxScale;
            this.updateTransform();
        }
    }

    /**
     * Handle image display with proper view management
     */
    onImageDisplayed() {
        // Only fit to view on first load or after resolution change
        if (this.isFirstLoad || this.wasResolutionChanged) {
            setTimeout(() => {
                this.fitToView();
            }, 10);
            this.isFirstLoad = false;
            this.wasResolutionChanged = false;
        }
    }

    /**
     * Mark that resolution was changed
     */
    markResolutionChanged() {
        this.wasResolutionChanged = true;
    }

    /**
     * Mark as first load
     */
    markFirstLoad() {
        this.isFirstLoad = true;
    }

    /**
     * Get current viewport state
     */
    getState() {
        return {
            scale: this.scale,
            translateX: this.translateX,
            translateY: this.translateY,
            isDragging: this.isDragging
        };
    }

    /**
     * Set viewport state
     */
    setState(state) {
        this.scale = state.scale || this.scale;
        this.translateX = state.translateX || this.translateX;
        this.translateY = state.translateY || this.translateY;
        this.updateTransform();
    }

    /**
     * Cleanup viewport manager
     */
    cleanup() {
        // Reset viewer cursor
        this.viewer.style.cursor = '';
        
        // Reset transform
        this.image.style.transform = '';
        
        console.log('ViewportManager cleanup completed');
    }
}