/* ===========================================================================
   catalog.js — the billboard, the rail and the ledger.
   ======================================================================== */
(function () {
  "use strict";

  var C = window.Chronicles;
  var state = { episodes: [], filter: "all" };

  C.stickMasthead();

  C.loadCatalog().then(function (catalog) {
    state.episodes = catalog.episodes;
    document.title = (catalog.site.title || "The DFIR Chronicles") + " — case files";
    paintSite(catalog.site);
    paintHero(catalog.featured, catalog.site);
    paintTicker(catalog.episodes);
    paintChips(catalog.episodes);
    paintRail(catalog.episodes);
    paintLedger(catalog.episodes);
    paintCast(catalog.site.cast || []);
    C.playIntro(document.querySelector(".hero"));
    C.revealOnScroll();
  }).catch(function (err) {
    console.error(err);
    C.fail("The case files are sealed");
  });

  /* --- site chrome ------------------------------------------------------ */

  function paintSite(site) {
    setText("[data-site-title]", site.title);
    setText("[data-site-tagline]", site.tagline);
    setText("[data-site-intro]", site.intro);
    setText("[data-year]", String(new Date().getFullYear()));
    document.querySelectorAll("[data-repo]").forEach(function (a) {
      if (site.repo) a.href = site.repo; else a.remove();
    });
  }

  function setText(sel, value) {
    document.querySelectorAll(sel).forEach(function (el) {
      if (value) el.textContent = value;
    });
  }

  /* --- hero billboard --------------------------------------------------- */

  function paintHero(ep, site) {
    if (!ep) return;
    var hero = document.querySelector(".hero");

    var art = ep.cover || site.banner || "";
    hero.querySelector("[data-hero-backdrop]").src = art;
    hero.querySelector("[data-hero-cover]").src = ep.cover || art;
    hero.querySelector("[data-hero-cover]").alt = "Cover of " + ep.title;

    hero.querySelector("[data-hero-caseno]").textContent = "Case file No. " + ep.no;
    hero.querySelector("[data-hero-title]").textContent = ep.title;

    var meta = [];
    if (ep.releasedLabel) meta.push(ep.releasedLabel);
    if (ep.pages) meta.push(ep.pages + " pages");
    if (ep.gameLabel) meta.push("Game " + ep.gameLabel);
    if (ep.techniques.length) meta.push(ep.techniques.join(" · "));
    hero.querySelector("[data-hero-meta]").innerHTML = meta
      .map(function (m) { return "<span>" + C.escapeHtml(m) + "</span>"; })
      .join('<i class="sep" aria-hidden="true"></i>');

    var hookEl = hero.querySelector("[data-hero-hook]");
    C.fetchHook(ep).then(function () { hookEl.textContent = ep.hook; });

    hero.querySelector("[data-hero-read]").href = ep.href;
    var dl = hero.querySelector("[data-hero-pdf]");
    if (ep.pdf) { dl.href = ep.pdf; dl.setAttribute("download", ""); } else { dl.remove(); }
  }

  /* --- SOC ticker ------------------------------------------------------- *
     One line per case, in the order the alerts came in. Adding an episode
     with an `alert:` adds it here automatically.                          */

  function paintTicker(episodes) {
    var track = document.querySelector("[data-ticker]");
    var items = episodes
      .slice()
      .sort(function (a, b) { return a.number - b.number; })
      .map(function (ep) {
        var line = ep.alert || ep.hook || ep.title;
        return '<a class="ticker__item" href="' + ep.href + '">' +
          "<b>CASE " + ep.no + "</b>" + C.escapeHtml(line) + "</a>";
      });

    if (!items.length) { track.closest(".ticker").remove(); return; }
    // Doubled so the -50% crawl loops without a seam.
    track.innerHTML = items.join("") + items.join("");
  }

  /* --- filter chips ----------------------------------------------------- */

  function paintChips(episodes) {
    var box = document.querySelector("[data-chips]");
    var tags = [];
    episodes.forEach(function (ep) {
      ep.tags.forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
    });
    tags.sort();

    if (!tags.length) { box.remove(); return; }

    box.innerHTML = ['<button class="chip" data-tag="all" aria-pressed="true">All cases</button>']
      .concat(tags.map(function (t) {
        return '<button class="chip" data-tag="' + C.escapeHtml(t) + '" aria-pressed="false">' +
          C.escapeHtml(t) + "</button>";
      })).join("");

    box.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      state.filter = chip.dataset.tag;
      box.querySelectorAll(".chip").forEach(function (c) {
        c.setAttribute("aria-pressed", String(c === chip));
      });
      paintRail(state.episodes);
    });
  }

  /* --- the rail --------------------------------------------------------- */

  function paintRail(episodes) {
    var track = document.querySelector("[data-rail]");
    var shown = state.filter === "all"
      ? episodes
      : episodes.filter(function (ep) { return ep.tags.indexOf(state.filter) !== -1; });

    var countEl = document.querySelector("[data-rail-count]");
    if (countEl) countEl.textContent = shown.length + (shown.length === 1 ? " case" : " cases");

    if (!shown.length) {
      track.innerHTML = '<p class="rail__empty">No case files carry that tag.</p>';
      return;
    }

    track.innerHTML = shown.map(function (ep, i) {
      var meta = [ep.releasedLabel, ep.pages ? ep.pages + " pages" : ""].filter(Boolean).join(" · ");
      return '' +
        '<a class="card" href="' + ep.href + '" data-reveal="up" style="--delay:' + (i * 60) + 'ms">' +
          '<div class="card__frame halftone">' +
            '<img src="' + C.escapeHtml(ep.cover) + '" alt="Cover of ' + C.escapeHtml(ep.title) + '" loading="lazy" width="900" height="1350">' +
            '<span class="card__no" aria-hidden="true">' + ep.no + "</span>" +
            '<div class="card__drawer">' +
              "<h3>" + C.escapeHtml(ep.title) + "</h3>" +
              '<p data-hook="' + C.escapeHtml(ep.id) + '">' + C.escapeHtml(ep.hook) + "</p>" +
            "</div>" +
          "</div>" +
          '<p class="card__cap">No. ' + ep.no + (meta ? " — " + C.escapeHtml(meta) : "") + "</p>" +
        "</a>";
    }).join("");

    // A four-key catalog entry has no hook of its own; borrow the README's
    // opening line so the drawer still says something.
    shown.filter(function (ep) { return !ep.hook; }).forEach(function (ep) {
      C.fetchHook(ep).then(function (hook) {
        var slot = track.querySelector('[data-hook="' + ep.id + '"]');
        if (slot && hook) slot.textContent = hook;
      });
    });

    C.revealOnScroll(track);
    wireRail();
  }

  function wireRail() {
    var rail = document.querySelector(".rail");
    var track = rail.querySelector(".rail__track");
    var prev = rail.querySelector(".rail__arrow--prev");
    var next = rail.querySelector(".rail__arrow--next");
    if (prev.dataset.wired) { syncArrows(); return; }
    prev.dataset.wired = next.dataset.wired = "1";

    function step(dir) {
      var card = track.querySelector(".card");
      var width = card ? card.getBoundingClientRect().width + 18 : 260;
      var perPage = Math.max(1, Math.floor(track.clientWidth / width));
      track.scrollBy({ left: dir * width * perPage, behavior: "smooth" });
    }
    prev.addEventListener("click", function () { step(-1); });
    next.addEventListener("click", function () { step(1); });
    track.addEventListener("scroll", syncArrows, { passive: true });
    window.addEventListener("resize", syncArrows);

    function syncArrows() {
      var max = track.scrollWidth - track.clientWidth - 2;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max;
    }
    syncArrows();
  }

  /* --- the ledger ------------------------------------------------------- */

  function paintLedger(episodes) {
    var body = document.querySelector("[data-ledger]");
    body.innerHTML = episodes.slice().sort(function (a, b) { return a.number - b.number; })
      .map(function (ep) {
        return "<tr>" +
          '<td class="ledger__no">' + ep.no + "</td>" +
          '<td><a class="ledger__title" href="' + ep.href + '">' + C.escapeHtml(ep.title) + "</a></td>" +
          "<td>" + C.escapeHtml(ep.releasedLabel || "—") + "</td>" +
          "<td>" + C.escapeHtml(ep.gameLabel || "—") + "</td>" +
          '<td class="ledger__att">' + C.escapeHtml(ep.techniques.join(", ") || "—") + "</td>" +
          "<td>" + (ep.pages || "—") + "</td>" +
          "<td>" + (ep.pdf
            ? '<a class="ledger__dl" href="' + C.escapeHtml(ep.pdf) + '" download>PDF</a>'
            : "—") + "</td>" +
        "</tr>";
      }).join("");
  }

  /* --- cast ------------------------------------------------------------- */

  function paintCast(cast) {
    var box = document.querySelector("[data-cast]");
    if (!cast.length) { box.closest(".section").remove(); return; }
    box.innerHTML = cast.map(function (p) {
      return '<div class="cast__member">' +
        "<h3>" + C.escapeHtml(p.name) + "</h3>" +
        '<p class="cast__role">' + C.escapeHtml(p.role || "") + "</p>" +
        '<p class="cast__note">' + C.escapeHtml(p.note || "") + "</p>" +
      "</div>";
    }).join("");
  }
})();
