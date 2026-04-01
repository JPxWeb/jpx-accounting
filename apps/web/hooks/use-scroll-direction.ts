"use client";

import { useEffect, useState } from "react";

const SCROLL_THRESHOLD = 10;

/**
 * Returns `true` when the user is scrolling down (bars should hide).
 * Returns `false` when scrolling up or at the top of the page.
 */
export function useScrollDirection() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    let ticking = false;

    function update() {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;

      if (currentScrollY <= 0) {
        setHidden(false);
      } else if (delta > SCROLL_THRESHOLD) {
        setHidden(true);
      } else if (delta < -SCROLL_THRESHOLD) {
        setHidden(false);
      }

      lastScrollY = currentScrollY;
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return hidden;
}
