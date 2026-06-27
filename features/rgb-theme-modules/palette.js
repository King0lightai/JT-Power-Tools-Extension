/**
 * RGB Theme Palette Module — OKLCH edition (v4.8)
 *
 * Generates a perceptually-uniform palette from three base colors:
 *   primary, background, text.
 *
 * Why OKLCH? HSL lightness is wildly inconsistent across hues —
 *   `hsl(60, 100%, 50%)` (yellow) looks brighter than `hsl(240, 100%, 50%)` (blue)
 * even though L values are equal. OKLCH normalizes for human perception, so the
 *   subtle / muted / emphasis ramps stay visually balanced for ANY primary the
 *   user picks. This was the #1 reason custom themes felt patchy in v4.7.
 *
 * API parity — exposes:
 *   window.ThemePalette.generatePalette({ primary, background, text }) → palette
 *
 * Returned shape matches the v4 module so rgb-theme.js consumes it unchanged:
 *   { meta, primary, background, text, border, states, scrollbar, alerts, shadows }
 *
 * `meta.ratios` is new in v4.8 — provides live WCAG numbers for the popup's
 * Contrast Check panel. Math from Björn Ottosson's Oklab paper.
 *   https://bottosson.github.io/posts/oklab/
 */

(() => {
  /* ────────────────────────────────────────────────────────────
     Color-space helpers (sRGB ↔ Oklab ↔ OKLCH)
     ──────────────────────────────────────────────────────────── */

  function srgbToLinear(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    const v = h.length === 3
      ? h.split('').map(c => c + c).join('')
      : h;
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
    };
  }
  function rgbToHex({ r, g, b }) {
    const h = n => n.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function rgbToOklab({ r, g, b }) {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);

    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return {
      L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    };
  }

  function oklabToRgb({ L, a, b }) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const lr = l_ ** 3;
    const lm = m_ ** 3;
    const ls = s_ ** 3;

    const r = +4.0767416621 * lr - 3.3077115913 * lm + 0.2309699292 * ls;
    const g = -1.2684380046 * lr + 2.6097574011 * lm - 0.3413193965 * ls;
    const bl = -0.0041960863 * lr - 0.7034186147 * lm + 1.7076147010 * ls;

    return {
      r: linearToSrgb(r),
      g: linearToSrgb(g),
      b: linearToSrgb(bl),
    };
  }

  function oklabToOklch({ L, a, b }) {
    const C = Math.sqrt(a * a + b * b);
    let h = (Math.atan2(b, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { L, C, h };
  }
  function oklchToOklab({ L, C, h }) {
    const rad = (h * Math.PI) / 180;
    return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
  }

  function hexToOklch(hex) {
    return oklabToOklch(rgbToOklab(hexToRgb(hex)));
  }
  function oklchToHex(oklch) {
    return rgbToHex(oklabToRgb(oklchToOklab(oklch)));
  }

  /* ────────────────────────────────────────────────────────────
     OKLCH-aware operations
     ──────────────────────────────────────────────────────────── */

  // Adjust lightness by a perceptually-even delta (e.g. +0.05 = 5% brighter).
  function shiftL(hex, delta) {
    const c = hexToOklch(hex);
    c.L = Math.max(0, Math.min(1, c.L + delta));
    return oklchToHex(c);
  }
  function setL(hex, L) {
    const c = hexToOklch(hex);
    c.L = Math.max(0, Math.min(1, L));
    return oklchToHex(c);
  }
  function scaleC(hex, factor) {
    const c = hexToOklch(hex);
    c.C = Math.max(0, c.C * factor);
    return oklchToHex(c);
  }
  // Mix toward a target color in Oklab space (perceptually linear blend).
  function mix(a, b, t) {
    const A = rgbToOklab(hexToRgb(a));
    const B = rgbToOklab(hexToRgb(b));
    const out = { L: A.L + (B.L - A.L) * t, a: A.a + (B.a - A.a) * t, b: A.b + (B.b - A.b) * t };
    return rgbToHex(oklabToRgb(out));
  }

  // WCAG 2.2 relative luminance (still defined in sRGB; that's the spec).
  function relLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const rs = srgbToLinear(r);
    const gs = srgbToLinear(g);
    const bs = srgbToLinear(b);
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }
  function contrast(a, b) {
    const la = relLuminance(a);
    const lb = relLuminance(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }
  function readableTextOn(bg) {
    return contrast(bg, '#ffffff') >= contrast(bg, '#0a0a0a') ? '#ffffff' : '#0a0a0a';
  }

  /* ────────────────────────────────────────────────────────────
     Palette builder — output shape is rgb-theme.js's expected shape
     ──────────────────────────────────────────────────────────── */

  function generatePalette(colors) {
    const { primary, background, text } = colors || {};
    const bgIsDark = relLuminance(background) < 0.5;

    // Direction of "deeper / shallower" depends on whether bg is light or dark.
    const deeper = bgIsDark ? +0.04 : -0.03;
    const shallower = bgIsDark ? -0.02 : +0.02;

    const bg = {
      base: background,
      // Light themes: subtle/muted sit slightly DARKER than the page and stay
      // monotonic (subtle < muted) so fills/zebra read; "elevated" floats toward
      // white (+0.05) so popups/dropdowns/modals actually lift off the page —
      // the old +0.015 left them indistinguishable from the page. Dark themes
      // are unchanged (already well-separated).
      subtle:    shiftL(background, bgIsDark ? shallower : -0.018),
      muted:     shiftL(background, bgIsDark ? deeper : -0.040),
      emphasis:  shiftL(background, deeper * 2),
      strong:    shiftL(background, deeper * 5),
      elevated:  shiftL(background, bgIsDark ? +0.06 : +0.05),
    };

    const tx = {
      primary:   text,
      // Light themes pull the ramp back (less background mixed in) so secondary/
      // muted labels stay legible instead of hazing toward the paper — JobTread
      // uses muted text for a lot of real body copy. Dark unchanged.
      secondary: mix(text, background, bgIsDark ? 0.25 : 0.18),
      muted:     mix(text, background, bgIsDark ? 0.45 : 0.34),
      disabled:  mix(text, background, bgIsDark ? 0.60 : 0.50),
    };

    // Light-theme borders were mixed ~85% toward the background — a hairline so
    // faint that cards/inputs/cells lost their edges and the UI read as blurry.
    // Pull more text into the light tiers so edges are visible. Dark unchanged.
    const border = {
      subtle:  mix(text, background, bgIsDark ? 0.82 : 0.80),
      default: mix(text, background, bgIsDark ? 0.72 : 0.68),
      strong:  mix(text, background, bgIsDark ? 0.55 : 0.55),
    };

    // Selection blend with chroma rescue on light themes (see note below).
    const sel = (t) => {
      const blended = mix(primary, background, t);
      return bgIsDark ? blended : scaleC(blended, 1.4);
    };
    const pri = {
      base:   primary,
      hover:  shiftL(primary, bgIsDark ? +0.05 : -0.04),
      active: shiftL(primary, bgIsDark ? +0.10 : -0.08),
      /* Selection blends — higher mix ratio toward bg = less primary showing.
         Bumped saturation so selected rows actually stand out — the old
         0.85 / 0.78 / 0.70 trio only let 15-30% primary through and the
         selection vanished into the surrounding bg on dense tables (cost
         items list, line-item editor). Current ratios let 35% / 45% / 58%
         primary through respectively. */
      /* On light themes, blending the primary toward a near-white bg in Oklab
         strips chroma, leaving a greyed-tan wash that vanishes on dense tables.
         Re-boost chroma (×1.4) so the selection keeps the brand hue and reads as
         "selected". Dark themes blend toward a dark bg without the same chroma
         loss, so they're left as the plain mix. */
      selection:       sel(0.65),
      selectionHover:  sel(0.55),
      selectionStrong: sel(0.42),
    };

    // v4.8.4 — secondary derived from primary in OKLCH space.
    //
    // These map to JobTread's .bg-gray-700/800 surfaces — the financial summary
    // bar, Item/Group buttons, and chips. In stock JobTread they're DARK NEUTRALS,
    // not a second accent hue. v4.8.3 derived them as the +180° complement at the
    // primary's own lightness, which (a) clashed hard with the theme (a blue
    // primary produced an amber bar) and (b) only gave ~3.6:1 contrast under the
    // forced white text on these surfaces.
    //
    // Derive instead as a DARK, LOW-CHROMA tone in the PRIMARY's hue:
    //   - h = primary.h → always harmonizes; the surface reads as "the theme's
    //     dark neutral" (blue theme → navy, red → brick, green → forest).
    //   - C capped low → a gentle theme tint, never a competing saturated accent;
    //     low-chroma primaries (Slate / Charcoal) stay gracefully near-neutral.
    //   - Fixed dark L → matches stock gray-700's weight and keeps white text
    //     legible (~7-9:1). Slightly lighter on dark themes so it lifts off the page.
    const primaryOklch = hexToOklch(primary);
    const secondaryBase = oklchToHex({
      L: bgIsDark ? 0.46 : 0.42,
      C: Math.min(primaryOklch.C, 0.07),
      h: primaryOklch.h,
    });
    const secondary = {
      base:   secondaryBase,
      hover:  shiftL(secondaryBase, bgIsDark ? +0.05 : -0.04),
      active: shiftL(secondaryBase, bgIsDark ? +0.10 : -0.08),
    };

    const states = {
      hover:    shiftL(background, deeper * 1.2),
      active:   shiftL(background, deeper * 2.2),
      focus:    background,
      rowHover: shiftL(background, deeper * 0.8),
    };

    const scrollbar = {
      track: shiftL(background, deeper * 1.2),
      thumb: mix(text, background, 0.65),
      thumbHover: mix(text, background, 0.5),
    };

    // Theme-harmonized alert hues — chroma matches the theme so
    // greens/yellows/reds don't feel pasted on. Hold OKLCH lightness
    // constant per bg-mode, then set hue to the canonical alert hue.
    function tint(hue) {
      const L = bgIsDark ? 0.30 : 0.95;
      const C = bgIsDark ? 0.10 : 0.06;
      return oklchToHex({ L, C, h: hue });
    }
    function tintText(hue) {
      const L = bgIsDark ? 0.78 : 0.42;
      const C = bgIsDark ? 0.16 : 0.18;
      return oklchToHex({ L, C, h: hue });
    }
    function tintBorder(hue) {
      const L = bgIsDark ? 0.50 : 0.78;
      const C = bgIsDark ? 0.13 : 0.14;
      return oklchToHex({ L, C, h: hue });
    }
    // One step off `tint()` for active-row hover (e.g. bg-green-200 over -100).
    // rgb-theme.js referenced `alerts.<hue>.bgHover` but it was never defined,
    // so hovered active rows didn't change — this supplies the step.
    function tintHover(hue) {
      const L = bgIsDark ? 0.35 : 0.91;
      const C = bgIsDark ? 0.12 : 0.08;
      return oklchToHex({ L, C, h: hue });
    }
    const alerts = {
      bodyText: tx.primary,
      blue:   { bg: tint(260), bgHover: tintHover(260), text: tintText(260), border: tintBorder(260) },
      green:  { bg: tint(155), bgHover: tintHover(155), text: tintText(155), border: tintBorder(155) },
      yellow: { bg: tint(85),  bgHover: tintHover(85),  text: tintText(85),  border: tintBorder(85) },
      red:    { bg: tint(25),  bgHover: tintHover(25),  text: tintText(25),  border: tintBorder(25) },
      orange: { bg: tint(50),  bgHover: tintHover(50),  text: tintText(50),  border: tintBorder(50) },
      purple: { bg: tint(310), bgHover: tintHover(310), text: tintText(310), border: tintBorder(310) },
    };

    const shadows = bgIsDark
      ? { color: 'rgba(0,0,0,0.4)', colorStrong: 'rgba(0,0,0,0.6)' }
      : { color: 'rgba(20,20,20,0.08)', colorStrong: 'rgba(20,20,20,0.16)' };

    return {
      meta: {
        bgIsDark,
        // ratios for the WCAG panel in the Theme tab popup
        ratios: {
          textOnBg:        +contrast(text, background).toFixed(2),
          primaryOnBg:     +contrast(primary, background).toFixed(2),
          textOnPrimary:   +contrast(readableTextOn(primary), primary).toFixed(2),
          mutedOnBg:       +contrast(tx.muted, background).toFixed(2),
        },
      },
      // legacy alias — kept so any v4.7 caller checking `palette.isDark` still works
      isDark: bgIsDark,
      primary: pri,
      secondary,
      background: bg,
      text: tx,
      border,
      states,
      scrollbar,
      alerts,
      shadows,
    };
  }

  /* ────────────────────────────────────────────────────────────
     Export — replaces window.ThemePalette
     ──────────────────────────────────────────────────────────── */
  const ThemePalette = {
    generatePalette,
    // expose math helpers so the popup's WCAG panel + auto-nudge can use them
    hexToOklch,
    oklchToHex,
    shiftL,
    setL,
    scaleC,
    mix,
    contrast,
    readableTextOn,
  };

  if (typeof window !== 'undefined') {
    window.ThemePalette = ThemePalette;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemePalette;
  }
})();
