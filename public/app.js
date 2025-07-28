class ImageViewer {
    constructor() {
        this.datasets = [];
        this.currentDatasetIndex = 0;
        this.currentImageType = 'pre';
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
        this.datasetSelect = document.getElementById('datasetSelect');
        this.datasetCounter = document.getElementById('datasetCounter');
        this.statusText = document.getElementById('statusText');
        this.zoomLevelText = document.getElementById('zoomLevel');
    }
    
    setupEventListeners() {
        document.getElementById('prevDataset').addEventListener('click', () => this.previousDataset());
        document.getElementById('nextDataset').addEventListener('click', () => this.nextDataset());
        
        document.getElementById('zoomIn').addEventListener('click', () => this.zoom(1.2));
        document.getElementById('zoomOut').addEventListener('click', () => this.zoom(0.8));
        document.getElementById('resetZoom').addEventListener('click', () => this.resetView());
        
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
            this.loadCurrentImage();
        });
        
        this.viewer.addEventListener('mousedown', (e) => this.startDrag(e));
        this.viewer.addEventListener('mousemove', (e) => this.drag(e));
        this.viewer.addEventListener('mouseup', () => this.endDrag());
        this.viewer.addEventListener('mouseleave', () => this.endDrag());
        
        this.viewer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.zoom(delta);
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
            const response = await fetch('/api/datasets');
            this.datasets = await response.json();
            
            if (this.datasets.length === 0) {
                this.statusText.textContent = 'No datasets found';
                return;
            }
            
            this.datasetSelect.innerHTML = this.datasets.map((dataset, index) => 
                `<option value="${index}">Dataset ${dataset.id}</option>`
            ).join('');
            
            this.updateDatasetCounter();
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
        this.image.onload = () => {
            this.statusText.textContent = `Loaded: ${this.currentImageType}-event image`;
            this.fitToView();
        };
        this.image.onerror = () => {
            this.statusText.textContent = 'Error loading image';
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
            this.loadCurrentImage();
        }
    }
    
    nextDataset() {
        if (this.currentDatasetIndex < this.datasets.length - 1) {
            this.currentDatasetIndex++;
            this.datasetSelect.value = this.currentDatasetIndex;
            this.updateDatasetCounter();
            this.loadCurrentImage();
        }
    }
    
    updateDatasetCounter() {
        this.datasetCounter.textContent = `${this.currentDatasetIndex + 1} / ${this.datasets.length}`;
    }
    
    zoom(factor) {
        const newScale = this.scale * factor;
        if (newScale >= this.minScale && newScale <= this.maxScale) {
            this.scale = newScale;
            this.updateTransform();
        }
    }
    
    resetView() {
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.updateTransform();
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