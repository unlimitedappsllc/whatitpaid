/* What It Paid — site config + interactions
 *
 * BUY BUTTONS: a Receipt whose slug appears in CHECKOUT_ITEMS checks out
 * through the whatitpaid-app Worker's Stripe checkout (POST /api/checkout,
 * which returns a Stripe-hosted checkout URL). Any other slug falls back
 * to GUMROAD_URLS below; leave as "#" and the button shows the
 * "join the list" note.
 */
const CHECKOUT_ITEMS = {
  "tiktok-shop-ai-characters": "receipt-01",   // Receipt 01 — live via Stripe checkout
};
const GUMROAD_URLS = {
  "tiktok-shop-ai-characters": "#",   // case-01 — LIVE, paste Gumroad product URL
  "restaurant-photo-outreach": "#",   // case-02
  "service-offer-weekend": "#",       // case-03
  "ugc-creator-trybe": "#",           // case-04
  "ai-creator-amazon-affiliate": "#"  // case-06
};

document.addEventListener("DOMContentLoaded", () => {
  // Small note shown under a buy button (coming-soon and checkout errors)
  function showBuyNote(btn, text) {
    const wrap = btn.closest(".card, .signup-box") || document.body;
    let note = wrap.querySelector(".buy-note");
    if (!note) {
      note = document.createElement("p");
      note.className = "buy-note";
      note.style.cssText =
        "font-size:13px;color:var(--ivory-faint);margin-top:10px;";
      btn.insertAdjacentElement("afterend", note);
    }
    note.textContent = text;
  }

  // Wire buy buttons from config
  document.querySelectorAll("[data-buy]").forEach((btn) => {
    const receiptId = CHECKOUT_ITEMS[btn.dataset.buy];
    if (receiptId) {
      // Stripe checkout via the Worker: create a session, then redirect.
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (btn.dataset.busy) return;
        btn.dataset.busy = "1";
        const original = btn.textContent;
        btn.textContent = "Opening checkout…";
        try {
          const body = { items: [receiptId] };
          const ref = new URLSearchParams(location.search).get("ref");
          if (ref) body.referral_code = ref.slice(0, 16);
          const res = await fetch("https://whatitpaid.com/api/checkout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok && data.url) {
            location.href = data.url;
            return;
          }
          throw new Error(data.error || "checkout failed");
        } catch (err) {
          console.error("checkout failed:", err);
          btn.textContent = original;
          delete btn.dataset.busy;
          showBuyNote(btn,
            "Checkout couldn't open just now — try again in a minute, or join the list below and we'll let you know the moment it's back.");
        }
      });
      return;
    }
    const url = GUMROAD_URLS[btn.dataset.buy];
    if (url && url !== "#") {
      btn.href = url;
      btn.target = "_blank";
      btn.rel = "noopener";
    } else {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        showBuyNote(btn,
          "Checkout link goes live with the product — join the list below and we'll tell you the moment it drops.");
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

  // Email capture — POSTs to the /api/notify Pages Function (KV-backed).
  // Shows honest states: sending, success, or a real error (no fake wins).
  const form = document.getElementById("notify-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const done = document.getElementById("notify-done");
      const btn = form.querySelector('button[type="submit"]');
      if (!input || !input.value) return;

      const originalBtn = btn ? btn.textContent : "";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Joining…";
      }

      try {
        const res = await fetch("https://whatitpaid-app.roject--undred-old.workers.dev/api/notify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: input.value.trim(), source: "notify-form" }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          form.style.display = "none";
          if (done) done.style.display = "block";
        } else if (data.error === "invalid_email") {
          input.setCustomValidity("That email doesn't look right — mind checking it?");
          input.reportValidity();
          input.setCustomValidity("");
        } else {
          throw new Error(data.error || "request failed");
        }
      } catch (err) {
        console.error("notify signup failed:", err);
        if (btn) {
          btn.textContent = "Something broke — try again";
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = originalBtn;
          }, 3000);
        } else {
          alert("Couldn't save your email just now — please try again in a minute.");
        }
      } finally {
        if (btn && btn.disabled && btn.textContent === "Joining…") {
          btn.disabled = false;
          btn.textContent = originalBtn;
        }
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

/* Sample presentations: clicking a card's book image opens its narrated sample. */
(function () {
  var SAMPLES = { "receipt-01": "assets/video/receipt-01-sample.mp4" };
  var modal = document.getElementById("sampleModal");
  var video = document.getElementById("sampleVideo");
  if (!modal || !video) return;
  function openSample(id) {
    if (!SAMPLES[id]) return;
    video.src = SAMPLES[id];
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }
  function closeSample() {
    video.pause();
    video.removeAttribute("src");
    video.load();
    modal.hidden = true;
    document.body.style.overflow = "";
  }
  document.querySelectorAll("[data-sample]").forEach(function (el) {
    el.addEventListener("click", function (ev) {
      ev.preventDefault();
      openSample(el.getAttribute("data-sample"));
    });
  });
  modal.querySelectorAll("[data-close-sample]").forEach(function (el) {
    el.addEventListener("click", closeSample);
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !modal.hidden) closeSample();
  });
})();
