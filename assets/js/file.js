/* ===========================================================================
   file.js — a single case file: cover, facts, technical note, reader.
   ======================================================================== */
(function () {
  "use strict";

  var C = window.Chronicles;
  C.stickMasthead();

  var wanted = new URLSearchParams(location.search).get("id");

  C.loadCatalog().then(function (catalog) {
    var ep = catalog.episodes.find(function (e) { return e.id === wanted; });
    if (!ep) { C.fail(wanted ? "No case file numbered " + wanted : "No case file requested"); return; }

    document.title = ep.title + " — " + (catalog.site.title || "The DFIR Chronicles");
    paintHeader(ep, catalog.site);
    paintNeighbours(ep, catalog.episodes);
    wireReader(ep);
    C.playIntro(document.querySelector(".file-hero"));
    return paintNote(ep);
  }).catch(function (err) {
    console.error(err);
    C.fail("The case file is sealed");
  });

  /* --- header ----------------------------------------------------------- */

  function paintHeader(ep, site) {
    set("[data-site-title]", site.title);
    set("[data-year]", String(new Date().getFullYear()));
    document.querySelectorAll("[data-repo]").forEach(function (a) {
      if (site.repo) a.href = site.repo; else a.remove();
    });

    var art = ep.cover || site.banner || "";
    document.querySelector("[data-file-backdrop]").src = art;
    var cover = document.querySelector("[data-file-cover]");
    cover.src = ep.cover || art;
    cover.alt = "Cover of " + ep.title;

    set("[data-file-caseno]", "Case file No. " + ep.no);
    set("[data-file-title]", ep.title);

    var facts = [];
    if (ep.releasedLabel) facts.push(["Filed", ep.releasedLabel]);
    if (ep.gameLabel) facts.push(["Game", ep.gameLabel]);
    if (ep.pages) facts.push(["Pages", String(ep.pages)]);
    if (ep.techniques.length) facts.push(["ATT&CK", ep.techniques.join(" · ")]);
    if (ep.tags.length) facts.push(["Tags", ep.tags.join(" · ")]);

    var list = document.querySelector("[data-file-facts]");
    if (facts.length) {
      list.innerHTML = facts.map(function (f) {
        return "<li><b>" + C.escapeHtml(f[0]) + "</b>" + C.escapeHtml(f[1]) + "</li>";
      }).join("");
    } else { list.remove(); }

    var alertBox = document.querySelector("[data-file-alert]");
    if (ep.alert) {
      alertBox.querySelector("[data-file-alert-body]").textContent = ep.alert;
    } else { alertBox.remove(); }

    var read = document.querySelector("[data-file-read]");
    var dl = document.querySelector("[data-file-pdf]");
    if (ep.pdf) {
      dl.href = ep.pdf;
    } else {
      read.remove(); dl.remove();
    }
  }

  /* --- the technical note ----------------------------------------------- */

  function paintNote(ep) {
    var prose = document.querySelector("[data-note]");
    if (!ep.readme) { noNote(prose); return; }

    return C.readFile(ep.readme).then(function (md) {
      prose.innerHTML = C.renderMarkdown(md);
      buildIndex(prose);
      C.revealOnScroll();
    }).catch(function (err) {
      console.error(err);
      noNote(prose);
    });
  }

  function noNote(prose) {
    prose.innerHTML = '<p class="eyebrow" style="color:var(--alert)">No technical note filed</p>' +
      "<p>This case ships as a comic only. The PDF is above.</p>";
    dropIndex();
  }

  /* Without an index the prose is the only column, so the grid has to give up
     the 220px track it was holding for the sidebar. */
  function dropIndex() {
    var index = document.querySelector(".file-index");
    if (index) index.remove();
    document.querySelector(".file-body").classList.add("file-body--solo");
  }

  /* Build the file index from the note's own headings, then keep the current
     section marked as the reader moves through it. */
  function buildIndex(prose) {
    var nav = document.querySelector("[data-file-index]");
    var headings = Array.prototype.slice.call(prose.querySelectorAll("h2, h3"));
    if (headings.length < 2) { dropIndex(); return; }

    nav.innerHTML = headings.map(function (h) {
      return '<li class="' + (h.tagName === "H3" ? "is-sub" : "") + '">' +
        '<a href="#' + h.id + '">' + C.escapeHtml(h.textContent) + "</a></li>";
    }).join("");

    var links = {};
    nav.querySelectorAll("a").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });

    var seen = new Set();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) seen.add(e.target.id); else seen.delete(e.target.id);
      });
      var current = headings.filter(function (h) { return seen.has(h.id); })[0];
      Object.keys(links).forEach(function (id) {
        links[id].setAttribute("aria-current", String(!!current && current.id === id));
      });
      if (current && links[current.id]) {
        var a = links[current.id];
        var box = nav.getBoundingClientRect();
        var pos = a.getBoundingClientRect();
        if (pos.top < box.top || pos.bottom > box.bottom) {
          a.scrollIntoView({ block: "nearest" });
        }
      }
    }, { rootMargin: "-15% 0px -70% 0px" });
    headings.forEach(function (h) { io.observe(h); });
  }

  /* --- previous / next -------------------------------------------------- */

  function paintNeighbours(ep, episodes) {
    var ordered = episodes.slice().sort(function (a, b) { return a.number - b.number; });
    var i = ordered.findIndex(function (e) { return e.id === ep.id; });
    link("[data-prev]", ordered[i - 1], "Previous case");
    link("[data-next]", ordered[i + 1], "Next case");
  }

  function link(sel, ep, label) {
    var el = document.querySelector(sel);
    if (!ep) { el.remove(); return; }
    el.href = ep.href;
    el.querySelector("[data-nav-label]").textContent = label;
    el.querySelector("[data-nav-title]").textContent = "No. " + ep.no + " — " + ep.title;
  }

  /* --- reader ----------------------------------------------------------- */

  function wireReader(ep) {
    var reader = document.querySelector(".reader");
    var frame = reader.querySelector(".reader__frame");
    var open = document.querySelector("[data-file-read]");
    var close = reader.querySelector(".reader__close");
    if (!open || !ep.pdf) return;

    reader.querySelector("[data-reader-label]").textContent = "Case file No. " + ep.no + " — " + ep.title;

    open.addEventListener("click", function (e) {
      e.preventDefault();
      frame.src = ep.pdf + "#view=Fit";   // a comic page is read whole, not by column
      reader.classList.add("is-open");
      document.body.style.overflow = "hidden";
      close.focus();
    });

    function shut() {
      reader.classList.remove("is-open");
      frame.removeAttribute("src");
      document.body.style.overflow = "";
      open.focus();
    }
    close.addEventListener("click", shut);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && reader.classList.contains("is-open")) shut();
    });
  }

  function set(sel, value) {
    document.querySelectorAll(sel).forEach(function (el) { if (value) el.textContent = value; });
  }
})();
