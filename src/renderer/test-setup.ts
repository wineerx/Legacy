import '@testing-library/jest-dom/vitest'

// Browser APIs used by Radix; jsdom does not implement pointer capture or scrolling.
HTMLElement.prototype.hasPointerCapture ??= () => false
HTMLElement.prototype.setPointerCapture ??= () => {}
HTMLElement.prototype.releasePointerCapture ??= () => {}
HTMLElement.prototype.scrollIntoView ??= () => {}
