(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Offline by default. Tests explicitly replace fetch with fixtures; unstubbing restores this blocker.
globalThis.fetch = (() => Promise.reject(new Error('Unit tests may not contact external services'))) as typeof fetch;
