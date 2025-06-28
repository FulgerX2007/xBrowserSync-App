import browser from 'webextension-polyfill';

// Service worker compatible background script for Manifest v3
// This replaces the Angular DOM-based bootstrap

// Set up essential event handlers
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Handle fresh install - could initialize default settings
  } else if (details.reason === 'update') {
    // Handle extension update
  }
});

browser.runtime.onStartup.addListener(() => {
  // Browser startup detected
});

// Handle messages from popup/content scripts
browser.runtime.onMessage.addListener((message, sender) => {
  // Handle messages compatible with the original background service
  // Return native Promise to match original service behavior
  return new Promise((resolve, reject) => {
    try {
      switch (message.command) {
        case 'SYNC_BOOKMARKS':
          // Return null for now - sync not implemented yet
          resolve(null);
          break;
        case 'RESTORE_BOOKMARKS':
          // Return null for now - restore not implemented yet
          resolve(null);
          break;
        case 'GET_CURRENT_SYNC':
          // Return null - no current sync
          resolve(null);
          break;
        case 'GET_SYNC_QUEUE_LENGTH':
          // Return 0 - no queued syncs
          resolve(0);
          break;
        case 'DISABLE_SYNC':
          // Return success for disable sync
          resolve(undefined);
          break;
        case 'DOWNLOAD_FILE':
          // Download not implemented yet - return success
          resolve(undefined);
          break;
        case 'ENABLE_EVENT_LISTENERS':
          // Event listeners not implemented yet - return success
          resolve(undefined);
          break;
        case 'DISABLE_EVENT_LISTENERS':
          // Event listeners not implemented yet - return success
          resolve(undefined);
          break;
        case 'ENABLE_AUTO_BACK_UP':
          // Auto backup not implemented yet - return success
          resolve(undefined);
          break;
        case 'DISABLE_AUTO_BACK_UP':
          // Auto backup not implemented yet - return success
          resolve(undefined);
          break;
        default: {
          // For unknown commands, throw an error with proper class name
          const error = new Error();
          error.message = 'AmbiguousSyncRequestError';
          reject(error);
        }
      }
    } catch (error) {
      // Ensure error message is set to a known error class name
      error.message = 'AmbiguousSyncRequestError';
      reject(error);
    }
  });
});

// Handle alarms for periodic tasks
browser.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case 'AutoBackUp':
      // Would handle auto backup
      break;
    case 'SyncUpdatesCheck':
      // Would check for sync updates
      break;
    default:
    // Unknown alarm
  }
});

// Handle notification events
browser.notifications.onClicked.addListener((notificationId) => {
  // Could open relevant pages or perform actions
});

browser.notifications.onClosed.addListener((notificationId, byUser) => {
  // Handle notification closed
});

// Keep service worker alive by handling periodic events
setInterval(() => {
  // This helps prevent the service worker from being terminated too quickly
  // In a real implementation, this would check for pending operations
}, 25000);
