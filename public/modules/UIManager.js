// import { Utils } from './Utils.js'; // Removed unused import

/**
 * UI/DOM management and user interactions
 */
export class UIManager {
    constructor() {
        this.elements = {};
        this.callbacks = {};
        
        this.setupElements();
        this.setupEventListeners();
    }

    /**
     * Setup all DOM element references
     */
    setupElements() {
        this.elements = {
            viewer: document.getElementById('imageViewer'),
            image: document.getElementById('mainImage'),
            projectSelect: document.getElementById('projectSelect'),
            datasetSelect: document.getElementById('datasetSelect'),
            datasetCounter: document.getElementById('datasetCounter'),
            statusText: document.getElementById('statusText'),
            imageNameText: document.getElementById('imageName'),
            zoomLevelText: document.getElementById('zoomLevel'),
            loadingIndicator: document.getElementById('loadingIndicator'),
            progressBarFill: document.getElementById('progressBarFill'),
            performanceIndicator: document.getElementById('performanceIndicator'),
            networkQualityDot: document.querySelector('.network-quality'),
            metricsText: document.querySelector('.metrics-text'),
            resolutionToggle: document.getElementById('resolutionToggle'),
            resolutionStatus: document.getElementById('resolutionStatus'),
            vegetationToggle: document.getElementById('vegetationToggle'),
            vegetationStatus: document.getElementById('vegetationStatus'),
            vegetationControls: document.querySelector('.vegetation-controls'),
            colorbarHelp: document.getElementById('colorbarHelp'),
            changeDetectionModal: document.getElementById('changeDetectionModal')
        };

        // Add error handling to main image element
        this.elements.image.addEventListener('error', (e) => {
            console.error('Main image failed to display:', e.target.src);
            this.setStatusText('Image failed to display');
            
            if (this.callbacks.onImageError) {
                this.callbacks.onImageError(e);
            }
        });

        this.elements.image.addEventListener('load', () => {
            console.log('Main image loaded successfully:', this.elements.image.src);
            
            if (this.callbacks.onImageLoad) {
                this.callbacks.onImageLoad();
            }
        });
    }

    /**
     * Setup all UI event listeners
     */
    setupEventListeners() {
        // Navigation buttons
        document.getElementById('prevDataset')?.addEventListener('click', () => {
            if (this.callbacks.onPreviousDataset) {
                this.callbacks.onPreviousDataset();
            }
        });
        
        document.getElementById('nextDataset')?.addEventListener('click', () => {
            if (this.callbacks.onNextDataset) {
                this.callbacks.onNextDataset();
            }
        });

        // Zoom controls
        document.getElementById('zoomIn')?.addEventListener('click', () => {
            if (this.callbacks.onZoom) {
                this.callbacks.onZoom(1.2);
            }
        });
        
        document.getElementById('zoomOut')?.addEventListener('click', () => {
            if (this.callbacks.onZoom) {
                this.callbacks.onZoom(0.8);
            }
        });
        
        document.getElementById('resetZoom')?.addEventListener('click', () => {
            if (this.callbacks.onResetZoom) {
                this.callbacks.onResetZoom();
            }
        });

        // Project selector
        this.elements.projectSelect?.addEventListener('change', (e) => {
            if (this.callbacks.onProjectChange) {
                this.callbacks.onProjectChange(e.target.value);
            }
        });

        // Dataset selector
        this.elements.datasetSelect?.addEventListener('change', (e) => {
            if (this.callbacks.onDatasetChange) {
                this.callbacks.onDatasetChange(parseInt(e.target.value));
            }
        });

        // Image type buttons
        document.querySelectorAll('.image-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setActiveImageType(e.target.dataset.type);
                if (this.callbacks.onImageTypeChange) {
                    this.callbacks.onImageTypeChange(e.target.dataset.type);
                }
            });
        });

        // Resolution toggle
        this.elements.resolutionToggle?.addEventListener('change', (e) => {
            if (this.callbacks.onResolutionChange) {
                this.callbacks.onResolutionChange(e.target.checked);
            }
        });

        // Vegetation toggle
        this.elements.vegetationToggle?.addEventListener('change', (e) => {
            if (this.callbacks.onVegetationFilterChange) {
                this.callbacks.onVegetationFilterChange(e.target.checked);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (this.callbacks.onKeyDown) {
                this.callbacks.onKeyDown(e);
            }
        });

        // Colorbar help button
        this.elements.colorbarHelp?.addEventListener('click', () => {
            this.showChangeDetectionModal();
        });

        // Modal close functionality
        const modalClose = document.querySelector('.modal-close');
        modalClose?.addEventListener('click', () => {
            this.hideChangeDetectionModal();
        });

        // Close modal when clicking outside
        this.elements.changeDetectionModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.changeDetectionModal) {
                this.hideChangeDetectionModal();
            }
        });

        // Close modal with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.elements.changeDetectionModal?.style.display === 'block') {
                this.hideChangeDetectionModal();
            }
        });
    }

    /**
     * Set active image type button
     */
    setActiveImageType(type) {
        document.querySelectorAll('.image-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        
        // Show/hide colorbar based on image type
        const colorbarContainer = document.querySelector('.colorbar-container');
        if (colorbarContainer) {
            colorbarContainer.classList.toggle('show', type === 'change');
        }
    }

    /**
     * Update dataset counter display
     */
    updateDatasetCounter(current, total) {
        if (this.elements.datasetCounter) {
            this.elements.datasetCounter.textContent = `${current + 1} / ${total}`;
        }
    }

    /**
     * Update dataset selector options
     */
    updateDatasetSelector(datasets) {
        if (!this.elements.datasetSelect) return;
        
        if (datasets.length === 0) {
            this.elements.datasetSelect.innerHTML = '<option>No datasets available</option>';
            return;
        }

        this.elements.datasetSelect.innerHTML = datasets.map((dataset, index) => 
            `<option value="${index}">Image pair ${dataset.id}</option>`
        ).join('');
    }

    /**
     * Set dataset selector value
     */
    setDatasetSelectorValue(index) {
        if (this.elements.datasetSelect) {
            this.elements.datasetSelect.value = index;
        }
    }

    /**
     * Update change detection button visibility
     */
    updateChangeDetectionButton(currentProject, currentImageType) {
        const changeBtn = document.querySelector('[data-type="change"]');
        if (!changeBtn) return;
        
        if (currentProject === 'coregistered') {
            changeBtn.style.display = 'none';
            if (currentImageType === 'change') {
                this.setActiveImageType('pre');
                if (this.callbacks.onImageTypeChange) {
                    this.callbacks.onImageTypeChange('pre');
                }
            }
        } else {
            changeBtn.style.display = 'block';
        }
    }

    /**
     * Update resolution status display
     */
    updateResolutionStatus(useFullResolution) {
        if (!this.elements.resolutionStatus) return;
        
        const status = useFullResolution ? 'Full Resolution' : 'Downsampled (2x)';
        this.elements.resolutionStatus.textContent = status;
        this.elements.resolutionStatus.className = `resolution-status ${useFullResolution ? 'full' : 'downsampled'}`;
    }

    /**
     * Update vegetation filter status display
     */
    updateVegetationStatus(useVegetationFilter, vegetationFilterAvailable) {
        if (!this.elements.vegetationStatus) return;
        
        if (!vegetationFilterAvailable) {
            this.elements.vegetationStatus.textContent = 'Unavailable';
            this.elements.vegetationStatus.className = 'vegetation-status unavailable';
            return;
        }
        
        const status = useVegetationFilter ? 'Active' : 'Inactive';
        this.elements.vegetationStatus.textContent = status;
        this.elements.vegetationStatus.className = `vegetation-status ${useVegetationFilter ? 'active' : 'inactive'}`;
    }

    /**
     * Update vegetation UI controls
     */
    updateVegetationUI(vegetationFilterAvailable) {
        if (!this.elements.vegetationControls) return;
        
        if (vegetationFilterAvailable) {
            this.elements.vegetationControls.classList.remove('vegetation-filter-unavailable');
            if (this.elements.vegetationToggle) {
                this.elements.vegetationToggle.disabled = false;
            }
        } else {
            this.elements.vegetationControls.classList.add('vegetation-filter-unavailable');
            if (this.elements.vegetationToggle) {
                this.elements.vegetationToggle.disabled = true;
                this.elements.vegetationToggle.checked = false;
            }
        }
    }

    /**
     * Set status text
     */
    setStatusText(text) {
        if (this.elements.statusText) {
            this.elements.statusText.textContent = text;
        }
    }

    /**
     * Set image name text
     */
    setImageNameText(text) {
        if (this.elements.imageNameText) {
            this.elements.imageNameText.textContent = text;
        }
    }

    /**
     * Show/hide loading indicator
     */
    setLoadingVisible(visible) {
        if (this.elements.loadingIndicator) {
            this.elements.loadingIndicator.style.display = visible ? 'block' : 'none';
        }
    }

    /**
     * Update loading progress
     */
    updateLoadingProgress(progress, eta, speed, total, useFullResolution, useVegetationFilter, vegetationFilterAvailable) {
        if (this.elements.progressBarFill) {
            this.elements.progressBarFill.style.width = `${progress}%`;
        }
        
        // Update status text with detailed info
        const resolutionMode = useFullResolution ? 'Full' : '2x Downsampled';
        const filterMode = vegetationFilterAvailable && useVegetationFilter ? ' - Automatic Vegetation Filter' : '';
        this.setStatusText(`Loading image... ${progress}% (${resolutionMode}${filterMode})`);
        
        // Update loading text with enhanced info
        const loadingText = this.elements.loadingIndicator?.querySelector('.loading-text');
        if (loadingText) {
            let loadingMessage = `Loading ${resolutionMode}${filterMode} image... ${progress}%`;
            
            if (eta && eta < 30) {
                loadingMessage += ` (${Math.ceil(eta)}s remaining)`;
            }
            
            if (speed > 0 && total > 0) {
                const speedMB = speed / (1024 * 1024);
                const totalMB = total / (1024 * 1024);
                if (speedMB > 0.1) {
                    loadingMessage += ` " ${speedMB.toFixed(1)} MB/s`;
                }
                if (totalMB > 1) {
                    loadingMessage += ` " ${totalMB.toFixed(1)} MB`;
                    
                    if (!useFullResolution) {
                        const estimatedFullSizeMB = totalMB * 4;
                        const savingsMB = estimatedFullSizeMB - totalMB;
                        if (savingsMB > 1) {
                            loadingMessage += ` (saves ~${savingsMB.toFixed(1)} MB)`;
                        }
                    }
                }
            }
            
            loadingText.textContent = loadingMessage;
        }
    }

    /**
     * Display image with status update
     */
    displayImage(imgElement, imageUrl, useFullResolution, useVegetationFilter, vegetationFilterAvailable, cacheHitRate) {
        const filename = imageUrl.split('/').pop();
        this.setImageNameText(filename);
        
        // Set image source
        this.elements.image.src = imgElement.src;
        this.elements.image.dataset.originalUrl = imageUrl;
        
        // Update status with performance info
        const resolutionMode = useFullResolution ? 'Full' : '2x Downsampled';
        const filterMode = vegetationFilterAvailable && useVegetationFilter ? ', Automatic Vegetation Filter' : '';
        const imageType = this.getCurrentImageType();
        this.setStatusText(`Loaded: ${imageType}-event image (${resolutionMode}${filterMode}, Cache: ${cacheHitRate.toFixed(1)}%)`);
        
        console.log('Displaying image:', imageUrl);
    }

    /**
     * Get current image type from active button
     */
    getCurrentImageType() {
        const activeBtn = document.querySelector('.image-type-btn.active');
        return activeBtn ? activeBtn.dataset.type : 'pre';
    }

    /**
     * Update performance indicator
     */
    updatePerformanceIndicator(cacheHitRate, memoryUsageMB, cacheSize, maxCacheSize, networkQuality, useFullResolution, useVegetationFilter, vegetationFilterAvailable, isLoading) {
        if (this.elements.networkQualityDot) {
            this.elements.networkQualityDot.className = `network-quality ${networkQuality}`;
        }
        
        if (this.elements.metricsText) {
            const resMode = useFullResolution ? 'Full' : '2x';
            const filterMode = vegetationFilterAvailable && useVegetationFilter ? ' AVF' : '';
            const modeText = `${resMode}${filterMode}`;
            this.elements.metricsText.textContent = `Cache: ${cacheHitRate}% | Mem: ${memoryUsageMB}MB | ${cacheSize}/${maxCacheSize} (${modeText})`;
        }
        
        // Show indicator during loading or if performance is poor
        const shouldShow = isLoading || 
                          networkQuality === 'poor' || 
                          parseFloat(memoryUsageMB) > 350; // Threshold for showing
        
        if (this.elements.performanceIndicator) {
            if (shouldShow) {
                this.elements.performanceIndicator.classList.add('visible');
            } else {
                setTimeout(() => {
                    if (!isLoading) {
                        this.elements.performanceIndicator.classList.remove('visible');
                    }
                }, 3000);
            }
        }
    }

    /**
     * Show retry button for failed loads
     */
    showRetryButton(imageUrl, onRetry) {
        const retryButton = document.createElement('button');
        retryButton.textContent = 'Retry Loading';
        retryButton.className = 'retry-button';
        retryButton.style.cssText = `
            background-color: #0066cc;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
            font-size: 14px;
        `;
        
        retryButton.onclick = () => {
            retryButton.remove();
            if (onRetry) {
                onRetry(imageUrl);
            }
        };
        
        if (this.elements.loadingIndicator) {
            this.elements.loadingIndicator.appendChild(retryButton);
            this.setLoadingVisible(true);
        }
    }

    /**
     * Set callback functions
     */
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Get DOM elements
     */
    getElements() {
        return this.elements;
    }

    /**
     * Get specific element
     */
    getElement(name) {
        return this.elements[name];
    }

    /**
     * Cleanup UI manager
     */
    cleanup() {
        // Remove any dynamically created elements
        const retryButtons = document.querySelectorAll('.retry-button');
        retryButtons.forEach(btn => btn.remove());
        
        // Reset loading indicator
        this.setLoadingVisible(false);
        
        // Reset status
        this.setStatusText('Ready');
        this.setImageNameText('');
        
        console.log('UIManager cleanup completed');
    }

    /**
     * Show change detection modal
     */
    showChangeDetectionModal() {
        if (this.elements.changeDetectionModal) {
            this.elements.changeDetectionModal.style.display = 'block';
        }
    }

    /**
     * Hide change detection modal
     */
    hideChangeDetectionModal() {
        if (this.elements.changeDetectionModal) {
            this.elements.changeDetectionModal.style.display = 'none';
        }
    }
}