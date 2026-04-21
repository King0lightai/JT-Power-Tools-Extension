// pricing.js — monthly/yearly billing toggle for pricing cards
(function() {
  function wire() {
    const toggle = document.querySelector('[data-billing-toggle]');
    const wrapper = document.querySelector('[data-billing-wrapper]');
    if (!toggle || !wrapper) return;

    function apply(mode) {
      wrapper.setAttribute('data-billing', mode);
      toggle.setAttribute('aria-checked', mode === 'yearly' ? 'true' : 'false');

      wrapper.querySelectorAll('[data-monthly][data-yearly]').forEach(card => {
        const amount = mode === 'yearly' ? card.dataset.yearly : card.dataset.monthly;
        const suffix = mode === 'yearly' ? '/yr' : '/mo';
        const amountEl = card.querySelector('[data-price-amount]');
        const periodEl = card.querySelector('[data-price-period]');
        if (amountEl) amountEl.textContent = '$' + amount;
        if (periodEl) periodEl.textContent = suffix;
      });
    }

    toggle.addEventListener('click', () => {
      const current = wrapper.getAttribute('data-billing') || 'monthly';
      apply(current === 'monthly' ? 'yearly' : 'monthly');
    });

    apply('monthly');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
