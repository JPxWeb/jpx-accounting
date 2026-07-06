export function waitForElement(selector: string, timeoutMs = 8_000): Promise<HTMLElement> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("waitForElement requires a DOM"));
  }

  const existing = document.querySelector(selector);
  if (existing instanceof HTMLElement) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) {
        observer.disconnect();
        window.clearTimeout(timerId);
        resolve(element);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    const timerId = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Tour target not found: ${selector}`));
    }, timeoutMs);
  });
}
