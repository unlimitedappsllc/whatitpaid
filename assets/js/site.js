/* What It Paid — site config + interactions
 *
 * BUY LINKS: fill in each product's Gumroad URL below.
 * Format: "https://gumroad.com/l/<product-id>"
 * Leave as "#" and the button will show "Coming soon" state.
 */
const GUMROAD_URLS = {
  "tiktok-shop-ai-characters": "#",   // case-01 — LIVE, paste Gumroad product URL
  "restaurant-photo-outreach": "#",   // case-02
  "service-offer-weekend": "#",       // case-03
  "ugc-creator-trybe": "#",           // case-04
  "ai-creator-amazon-affiliate": "#"  // case-06
};

document.addEventListener("DOMContentLoaded", () => {
  // Wire buy buttons from config
  document.querySelectorAll("[data-buy]").forEach((btn) => {
    const url = GUMROAD_URLS[btn.dataset.buy];
    if (url && url !== "#") {
      btn.href = url;
      btn.target = "_blank";
      btn.rel = "noopener";
    } else {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const wrap = btn.closest(".card, .signup-box") || document.body;
        let note = wrap.querySelector(".buy-note");
        if (!note) {
          note = document.createElement("p");
          note.className = "buy-note";
          note.style.cssText =
            "font-size:13px;color:var(--ivory-faint);margin-top:10px;";
          note.textContent =
            "Checkout link goes live with the product — join the list below and we'll tell you the moment it drops.";
          btn.insertAdjacentElement("afterend", note);
        }
      });
    }
  });

  // "Notify me" scrolls to signup
  document.querySelectorAll("[data-notify]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const el = document.getElementById("notify");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    });
  });

  // Email capture (frontend only — backend wiring comes later)
  const form = document.getElementById("notify-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const done = document.getElementById("notify-done");
      if (input && input.value && done) {
        // TODO: POST to email backend when wired
        console.log("notify signup:", input.value);
        form.style.display = "none";
        done.style.display = "block";
      }
    });
  }

  // Category filter + search
  const filterPills = document.querySelectorAll(".filter-pill");
  const searchInput = document.getElementById("receipt-search");
  const searchClear = document.getElementById("search-clear");
  const noResults = document.getElementById("no-results");
  const cards = document.querySelectorAll(".product-grid .card");
  let activeCategory = "all";

  function applyFilters() {
    const q = (searchInput.value || "").trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const matchesCat =
        activeCategory === "all" || card.dataset.category === activeCategory;
      let matchesSearch = true;
      if (q) {
        const parts = [
          card.querySelector(".claim"),
          card.querySelector(".tagline"),
          card.querySelector(".blurb"),
          card.querySelector(".cat-tag"),
        ].map((el) => (el ? el.textContent : ""));
        card.querySelectorAll(".inside li").forEach((li) => parts.push(li.textContent));
        matchesSearch = parts.join(" ").toLowerCase().includes(q);
      }
      const show = matchesCat && matchesSearch;
      card.classList.toggle("is-hidden", !show);
      if (show) visible++;
    });
    noResults.hidden = visible > 0;
    searchClear.hidden = !searchInput.value;
  }

  filterPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      filterPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      activeCategory = pill.dataset.filter;
      applyFilters();
    });
  });

  searchInput.addEventListener("input", applyFilters);
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    applyFilters();
    searchInput.focus();
  });
});
