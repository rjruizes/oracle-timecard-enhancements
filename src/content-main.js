// Main content script - initialize and run all enhancements
(() => {
  // Create and configure the enhancement manager
  const manager = new EnhancementManager();
  
  // Make manager globally accessible for inter-enhancement communication
  window.enhancementManager = manager;

  // Register all available enhancements
  manager.registerEnhancement(new TimecardTotalsEnhancement());
  manager.registerEnhancement(new WeekendShadingEnhancement());
  manager.registerEnhancement(new AlternateLineShadingEnhancement());
  manager.registerEnhancement(new DynamicRedLineEnhancement());
  // Previous timecard is action-only; registered directly, not via manager
  window._previousTimecardEnhancement = new PreviousTimecardEnhancement();

  // Initialize the manager
  manager.init().catch(error => {
    console.error('Failed to initialize timecard enhancements:', error);
  });

  // Listen for messages from popup/options page
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'getEnhancements':
        sendResponse({ enhancements: manager.getAllEnhancements() });
        break;
        
      case 'toggleEnhancement':
        manager.setEnhancementEnabled(request.name, request.enabled)
          .then(() => {
            sendResponse({ success: true });
          })
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Indicates async response
        
      case 'updateWeekendColor':
        const weekendShading = manager.enhancements.get('weekend-shading');
        if (weekendShading && weekendShading.setShadeColor) {
          weekendShading.setShadeColor(request.color);
          
          // Update alternate line shading after weekend color change
          const alternateShading = manager.enhancements.get('alternate-line-shading');
          if (alternateShading && alternateShading.enabled) {
            setTimeout(() => alternateShading.update(), 100);
          }
          
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Weekend shading enhancement not found' });
        }
        break;

      case 'updateRedLineColor':
        const dynamicRedLine = manager.enhancements.get('dynamic-red-line');
        if (dynamicRedLine && dynamicRedLine.setRedLineColor) {
          dynamicRedLine.setRedLineColor(request.color);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Dynamic red line enhancement not found' });
        }
        break;

      case 'updateAlternateRowColor':
        const alternateShading = manager.enhancements.get('alternate-line-shading');
        if (alternateShading && alternateShading.setAlternateShadeColor) {
          alternateShading.setAlternateShadeColor(request.color);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Alternate row shading enhancement not found' });
        }
        break;

      case 'showPreviousTimecardData':
        window._previousTimecardEnhancement.showModal(request.data);
        sendResponse({ success: true });
        break;

      default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    manager.cleanup();
  });
})();
