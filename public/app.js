/**
 * Refactored Image Viewer Application
 * Now using modular architecture with clean separation of concerns
 */
import { ImageViewer } from './modules/ImageViewer.js';

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Create the main ImageViewer instance
    window.imageViewer = new ImageViewer();
    
    console.log('Refactored ImageViewer application loaded successfully!');
    console.log('Architecture: Modular with separated concerns');
    console.log('Modules: UIManager, ImageCache, ViewportManager, PanoramaManager, PerformanceManager, Utils');
});
