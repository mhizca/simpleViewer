class ImageViewer {
    constructor() {
        this.datasets = [];
        this.currentDatasetIndex = 0;
        this.currentImageType = 'pre';
        this.currentProject = 'analysis';
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 5;
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.translateX = 0;
        this.translateY = 0;
        
        this.init();
    }
    
    init() {
        this.setupElements();
        this.setupEventListeners();
        this.loadDatasets();
    }
    
    setupElements() {
        this.viewer = document.getElementById('imageViewer');
        this.image = document.getElementById('mainImage');
        this.projectSelect = document.getElementById('projectSelect');
        this.datasetSelect = document.getElementById('datasetSelect');
        this.datasetCounter = document.getElementById('datasetCounter');
        this.statusText = document.getElementById('statusText');
        this.imageNameText = document.getElementById('imageName');
        this.zoomLevelText = document.getElementById('zoomLevel');
    }
    
    setupEventListeners() {
        document.getElementById('prevDataset').addEventListener('click', () => this.previousDataset());
        document.getElementById('nextDataset').addEventListener('click', () => this.nextDataset());
        
        document.getElementById('zoomIn').addEventListener('click', () => this.zoom(1.2));
        document.getElementById('zoomOut').addEventListener('click', () => this.zoom(0.8));
        document.getElementById('resetZoom').addEventListener('click', () => this.resetView());
        
        this.projectSelect.addEventListener('change', (e) => {
            this.currentProject = e.target.value;
            this.currentDatasetIndex = 0;
            this.loadDatasets();
            this.updateChangeDetectionButton();
        });
        
        document.querySelectorAll('.image-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.image-type-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentImageType = e.target.dataset.type;
                this.loadCurrentImage();
            });
        });
        
        this.datasetSelect.addEventListener('change', (e) => {
            this.currentDatasetIndex = parseInt(e.target.value);
            // Reset view when changing datasets via dropdown
            this.resetView();
            this.loadCurrentImage();
        });
        
        this.viewer.addEventListener('mousedown', (e) => this.startDrag(e));
        this.viewer.addEventListener('mousemove', (e) => this.drag(e));
        this.viewer.addEventListener('mouseup', () => this.endDrag());
        this.viewer.addEventListener('mouseleave', () => this.endDrag());
        
        this.viewer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const rect = this.viewer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.zoomAtPoint(delta, x, y);
        });
        
        document.addEventListener('keydown', (e) => {
            switch(e.key) {
                case 'ArrowLeft':
                    this.previousDataset();
                    break;
                case 'ArrowRight':
                    this.nextDataset();
                    break;
                case '1':
                    this.setImageType('pre');
                    break;
                case '2':
                    this.setImageType('post');
                    break;
                case '3':
                    this.setImageType('change');
                    break;
                case 'r':
                    this.resetView();
                    break;
            }
        });
    }
    
    async loadDatasets() {
        try {
            this.statusText.textContent = 'Loading datasets...';
            const response = await fetch(`/api/datasets/${this.currentProject}`);
            this.datasets = await response.json();
            
            if (this.datasets.length === 0) {
                this.statusText.textContent = 'No datasets found';
                this.datasetSelect.innerHTML = '<option>No datasets available</option>';
                return;
            }
            
            this.datasetSelect.innerHTML = this.datasets.map((dataset, index) => 
                `<option value="${index}">Dataset ${dataset.id}</option>`
            ).join('');
            
            this.updateDatasetCounter();
            this.updateChangeDetectionButton();
            this.loadCurrentImage();
        } catch (error) {
            console.error('Error loading datasets:', error);
            this.statusText.textContent = 'Error loading datasets';
        }
    }
    
    loadCurrentImage() {
        if (this.datasets.length === 0) return;
        
        const dataset = this.datasets[this.currentDatasetIndex];
        let imageUrl;
        
        switch(this.currentImageType) {
            case 'pre':
                imageUrl = dataset.preEvent;
                break;
            case 'post':
                imageUrl = dataset.postEvent;
                break;
            case 'change':
                imageUrl = dataset.changeDetection;
                break;
        }
        
        if (!imageUrl) {
            this.statusText.textContent = 'No change detection image available';
            this.image.src = '';
            return;
        }
        
        this.statusText.textContent = 'Loading image...';
        
        // Extract filename from URL
        const filename = imageUrl.split('/').pop();
        this.imageNameText.textContent = filename;
        
        this.image.onload = () => {
            this.statusText.textContent = `Loaded: ${this.currentImageType}-event image`;
            // Only fit to view if this is the first image load (scale is 1 and no translation)
            if (this.scale === 1 && this.translateX === 0 && this.translateY === 0) {
                this.fitToView();
            } else {
                // Maintain current zoom and pan
                this.updateTransform();
            }
        };
        this.image.onerror = () => {
            this.statusText.textContent = 'Error loading image';
            this.imageNameText.textContent = '';
        };
        this.image.src = imageUrl;
    }
    
    setImageType(type) {
        document.querySelectorAll('.image-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        this.currentImageType = type;
        this.loadCurrentImage();
    }
    
    previousDataset() {
        if (this.currentDatasetIndex > 0) {
            this.currentDatasetIndex--;
            this.datasetSelect.value = this.currentDatasetIndex;
            this.updateDatasetCounter();
            // Reset view when changing datasets
            this.resetView();
            this.loadCurrentImage();
        }
    }
    
    nextDataset() {
        if (this.currentDatasetIndex < this.datasets.length - 1) {
            this.currentDatasetIndex++;
            this.datasetSelect.value = this.currentDatasetIndex;
            this.updateDatasetCounter();
            // Reset view when changing datasets
            this.resetView();
            this.loadCurrentImage();
        }
    }
    
    updateDatasetCounter() {
        this.datasetCounter.textContent = `${this.currentDatasetIndex + 1} / ${this.datasets.length}`;
    }
    
    updateChangeDetectionButton() {
        const changeBtn = document.querySelector('[data-type="change"]');
        if (this.currentProject === 'coregistered') {
            changeBtn.style.display = 'none';
            if (this.currentImageType === 'change') {
                this.currentImageType = 'pre';
                document.querySelector('[data-type="pre"]').classList.add('active');
                changeBtn.classList.remove('active');
            }
        } else {
            changeBtn.style.display = 'block';
        }
    }
    
    zoom(factor) {
        const newScale = this.scale * factor;
        if (newScale >= this.minScale && newScale <= this.maxScale) {
            this.scale = newScale;
            this.updateTransform();
        }
    }
    
    zoomAtPoint(factor, x, y) {
        const newScale = this.scale * factor;
        if (newScale >= this.minScale && newScale <= this.maxScale) {
            // Get the viewer center point
            const viewerRect = this.viewer.getBoundingClientRect();
            const viewerCenterX = viewerRect.width / 2;
            const viewerCenterY = viewerRect.height / 2;
            
            // Calculate current mouse position in world coordinates
            // (accounting for current scale and translation from center)
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
    
    resetView() {
        this.fitToView();
    }
    
    fitToView() {
        const viewerRect = this.viewer.getBoundingClientRect();
        const imgWidth = this.image.naturalWidth;
        const imgHeight = this.image.naturalHeight;
        
        const scaleX = viewerRect.width / imgWidth;
        const scaleY = viewerRect.height / imgHeight;
        
        this.scale = Math.min(scaleX, scaleY) * 0.95; // 95% to add some padding
        this.translateX = 0;
        this.translateY = 0;
        this.updateTransform();
    }
    
    startDrag(e) {
        this.isDragging = true;
        this.startX = e.clientX - this.translateX;
        this.startY = e.clientY - this.translateY;
        this.viewer.style.cursor = 'grabbing';
    }
    
    drag(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        this.translateX = e.clientX - this.startX;
        this.translateY = e.clientY - this.startY;
        this.updateTransform();
    }
    
    endDrag() {
        this.isDragging = false;
        this.viewer.style.cursor = 'grab';
    }
    
    updateTransform() {
        this.image.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        this.zoomLevelText.textContent = `${Math.round(this.scale * 100)}%`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ImageViewer();
});