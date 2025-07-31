/**
 * Shared utilities for the ImageViewer application
 */
export class Utils {
    /**
     * Generate a unique cache key that includes resolution and vegetation filter state
     */
    static generateCacheKey(imageUrl, useFullResolution, useVegetationFilter, vegetationFilterAvailable) {
        const resolutionPrefix = useFullResolution ? 'full' : 'down';
        const filterPrefix = !useVegetationFilter && vegetationFilterAvailable ? 'veg' : 'norm';
        return `${resolutionPrefix}-${filterPrefix}-${imageUrl}`;
    }

    /**
     * Get the appropriate image URL based on resolution and vegetation filter settings
     */
    static getImageUrl(imageUrls, useFullResolution, useVegetationFilter) {
        if (typeof imageUrls === 'string') {
            return imageUrls;
        } else if (typeof imageUrls === 'object' && imageUrls !== null) {
            // Check if vegetation filter is requested and available
            if (!useVegetationFilter && imageUrls.vegFilter) {
                const vegFilterUrls = imageUrls.vegFilter;
                if (typeof vegFilterUrls === 'string') {
                    return vegFilterUrls;
                } else if (typeof vegFilterUrls === 'object' && vegFilterUrls !== null) {
                    return useFullResolution ? vegFilterUrls.full : vegFilterUrls.downsampled;
                }
            }
            
            // Use normal (non-filtered) variant
            if (imageUrls.full && imageUrls.downsampled) {
                return useFullResolution ? imageUrls.full : imageUrls.downsampled;
            }
        }
        return null;
    }

    /**
     * Calculate ETA for progressive loading
     */
    static calculateETA(progressHistory, total, loaded) {
        if (progressHistory.length < 2) return null;
        
        const recent = progressHistory.slice(-5);
        const timeSpan = recent[recent.length - 1].time - recent[0].time;
        const dataSpan = recent[recent.length - 1].loaded - recent[0].loaded;
        
        if (timeSpan === 0 || dataSpan === 0) return null;
        
        const bytesPerMs = dataSpan / timeSpan;
        const remainingBytes = total - loaded;
        const etaMs = remainingBytes / bytesPerMs;
        
        return Math.max(0, etaMs / 1000);
    }

    /**
     * Calculate loading speed
     */
    static calculateSpeed(progressHistory) {
        if (progressHistory.length < 2) return 0;
        
        const recent = progressHistory.slice(-3);
        const timeSpan = recent[recent.length - 1].time - recent[0].time;
        const dataSpan = recent[recent.length - 1].loaded - recent[0].loaded;
        
        if (timeSpan === 0) return 0;
        
        return (dataSpan / timeSpan) * 1000; // bytes per second
    }

    /**
     * Check if image URLs have vegetation filter structure
     */
    static hasVegetationFilterStructure(imageUrls) {
        return typeof imageUrls === 'object' && 
               imageUrls !== null && 
               imageUrls.vegFilter && 
               typeof imageUrls.vegFilter === 'object';
    }

    /**
     * Estimate memory usage of an image
     */
    static estimateImageSize(img) {
        return (img.naturalWidth || img.width || 1000) * 
               (img.naturalHeight || img.height || 1000) * 4;
    }

    /**
     * Validate a cached image entry
     */
    static validateCachedEntry(cachedEntry, imageUrl) {
        try {
            const img = cachedEntry.image || cachedEntry;
            
            if (!img || !img.src) {
                console.warn('Cached entry has no image or src:', imageUrl);
                return false;
            }
            
            if (img.src.startsWith('blob:')) {
                if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
                    console.warn('Cached blob URL appears to be revoked:', imageUrl);
                    return false;
                }
            }
            
            if (img.src.startsWith('data:') || img.src.startsWith('http')) {
                return img.complete && img.naturalWidth > 0;
            }
            
            return true;
        } catch (error) {
            console.error('Error validating cached entry:', error);
            return false;
        }
    }

    /**
     * Get image property name from image type
     */
    static getImageProperty(imageType) {
        switch(imageType) {
            case 'pre': return 'preEvent';
            case 'post': return 'postEvent';
            case 'change': return 'changeDetection';
            default: return 'preEvent';
        }
    }

    /**
     * Debounce function for performance optimization
     */
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}