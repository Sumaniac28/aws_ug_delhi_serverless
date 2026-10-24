import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach } from 'vitest';

// jsdom has no crypto.subtle; Node does.
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

// jsdom does not implement the modal parts of <dialog> or object URLs.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}
URL.createObjectURL ??= () => 'blob:test';
URL.revokeObjectURL ??= () => {};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
