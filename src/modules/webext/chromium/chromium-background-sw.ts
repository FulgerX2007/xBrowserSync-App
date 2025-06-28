import angular from 'angular';
import browser from 'webextension-polyfill';

// Service worker compatible background script for Manifest v3
// This replaces the Angular DOM-based bootstrap

// Mock minimal Angular dependency injection for service worker context
const mockDocument = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({}),
  head: { appendChild: () => {}, removeChild: () => {} }
};

const mockElement = {
  ready: (callback: Function) => callback(),
  data: () => ({}),
  append: () => {},
  remove: () => {}
};

// Override global document and angular.element for service worker
// eslint-disable-next-line no-undef
(global as any).document = mockDocument;
if (angular?.element) {
  angular.element = () => mockElement as any;
}

// Set up event handlers compatible with service worker
browser.runtime.onInstalled.addListener((details) => {
  // Extension installed/updated
  if (details.reason === 'install') {
    // Handle fresh install
  }
});

browser.runtime.onStartup.addListener(() => {
  // Browser startup detected
});

// Keep service worker alive
// eslint-disable-next-line no-restricted-globals
self.addEventListener('message', (event) => {
  // Service worker received message
  if (event.data) {
    // Handle the message
  }
});
