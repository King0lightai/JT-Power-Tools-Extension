/**
 * Cloudflare Worker Configuration
 * Update WORKER_URL with your deployed worker URL
 */

const WORKER_CONFIG = {
  // Your Cloudflare Worker URL
  WORKER_URL: 'https://jobtread-tools-pro.king0light-ai.workers.dev',

  // Enable to use Worker API, disable to use direct API (for testing)
  USE_WORKER: true
};

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.WORKER_CONFIG = WORKER_CONFIG;
}
