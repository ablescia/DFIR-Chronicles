/* ===========================================================================
   chronicles.js — catalog loading, shared behaviour.
   The site is driven entirely by episodes.yaml; nothing here is hardcoded.
   ======================================================================== */
(function (global) {
  "use strict";

  var CATALOG_URL = "episodes.yaml";

  /* --- helpers ---------------------------------------------------------- */

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[_\s]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function basename(path) {
    return String(path || "").split("/").pop().replace(/\.[^.]+$/, "");
  }

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* Resolve a catalog path. Absolute URLs pass through untouched, so a PDF can
     live in a GitHub Release while covers sit next to the catalog. */
  function resolve(path) {
    if (!path) return "";
    return /^(https?:)?\/\//.test(path) ? path : path.replace(/^\.?\//, "");
  }

  /* --- catalog ---------------------------------------------------------- */

  var cached = null;

  /* episodes.yaml holds the site settings and an ordered list of episode files.
     Each episode describes itself in the front matter of its own Markdown file,
     so there is one place to edit per episode. A list entry may also be a
     mapping, and any key written there overrides the file's front matter. */
  function loadCatalog() {
    if (cached) return cached;
    cached = fetch(CATALOG_URL, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("episodes.yaml returned " + res.status);
        return res.text();
      })
      .then(function (text) {
        var data = global.jsyaml.load(text) || {};
        var site = data.site || {};
        return Promise.all((data.episodes || []).map(withFrontMatter))
          .then(function (merged) {
            var list = merged.map(normalise);

            // Newest first, the way a case ledger stacks.
            list.sort(function (a, b) { return b.number - a.number; });

            var featured = list.find(function (ep) { return ep.id === site.featured; })
              || list.find(function (ep) { return ep.featured; })
              || list[0];

            return { site: site, episodes: list, featured: featured };
          });
      });
    return cached;
  }

  /* A list entry is either a path to the episode file or a mapping carrying
     one (`file:`, or `readme:` from the older inline form). */
  function withFrontMatter(raw) {
    var entry = typeof raw === "string" ? { file: raw } : Object.assign({}, raw);
    entry.file = entry.file || entry.readme || "";
    if (!entry.file) return Promise.resolve(entry);
    return readFrontMatter(resolve(entry.file)).then(function (front) {
      return Object.assign({}, front, entry);
    });
  }

  /* Only the head of the file is needed to build a card, so ask for it. Servers
     that ignore Range answer 200 with the whole file, which parses the same. */
  function readFrontMatter(url) {
    return fetch(url, { headers: { Range: "bytes=0-4095" } })
      .then(function (res) {
        if (!res.ok && res.status !== 206) throw new Error(url + " returned " + res.status);
        var partial = res.status === 206;
        return res.text().then(function (chunk) {
          if (!OPENER.test(chunk)) return {};          // no front matter at all
          var front = splitFrontMatter(chunk);
          if (front.data !== null) return front.data;
          if (!partial) return {};
          // Front matter longer than the window — read the file whole.
          return fetch(url).then(function (r) { return r.text(); })
            .then(function (whole) { return splitFrontMatter(whole).data || {}; });
        });
      })
      .catch(function (err) {
        console.error("Could not read front matter from " + url, err);
        return {};
      });
  }

  var OPENER = /^\uFEFF?---[ \t]*\r?\n/;

  /* Returns data:null when the text carries no front matter, so callers can
     tell "absent" from "present but empty". */
  function splitFrontMatter(text) {
    var m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    if (!m) return { data: null, body: text };
    var data = {};
    try {
      data = global.jsyaml.load(m[1]) || {};
    } catch (err) {
      console.error("Invalid front matter", err);
    }
    return { data: data, body: text.slice(m[0].length) };
  }

  function normalise(raw, index) {
    var ep = Object.assign({}, raw);
    ep.file = resolve(raw.file || raw.readme || "");
    ep.readme = ep.file;
    ep.title = raw.title || "Untitled case";
    // The file name is the episode's stable identity; a title can be reworded.
    ep.id = raw.id || basename(ep.file) || slugify(ep.title);
    ep.number = Number(raw.number) || index + 1;
    ep.no = pad(ep.number);
    ep.cover = resolve(raw.cover);
    ep.pdf = resolve(raw.pdf);
    ep.hook = (raw.hook || "").trim();
    ep.alert = (raw.alert || "").trim();
    ep.tags = raw.tags || [];
    ep.techniques = raw.techniques || [];
    ep.releasedLabel = formatDate(raw.released);
    ep.href = "episode.html?id=" + encodeURIComponent(ep.id);
    return ep;
  }

  /* When an episode declares no hook, borrow the opening line of its README so
     a four-key catalog entry still produces a complete card. */
  function fetchHook(ep) {
    if (ep.hook || !ep.readme) return Promise.resolve(ep.hook);
    return fetch(ep.readme).then(function (r) {
      return r.ok ? r.text() : "";
    }).then(function (text) {
      var md = splitFrontMatter(text).body;
      var para = md.split(/\n\s*\n/).find(function (block) {
        var t = block.trim();
        return t && !t.startsWith("#") && !t.startsWith("!") && !t.startsWith("```");
      }) || "";
      ep.hook = para.trim().replace(/[*`_]/g, "").replace(/\s+/g, " ").slice(0, 190);
      return ep.hook;
    }).catch(function () { return ""; });
  }

  /* --- markdown --------------------------------------------------------- */

  function renderMarkdown(md) {
    md = splitFrontMatter(md).body;   // the metadata is not part of the note
    global.marked.setOptions({ gfm: true, breaks: false, headerIds: false, mangle: false });
    var html = global.marked.parse(md);
    var doc = new DOMParser().parseFromString("<div id=root>" + html + "</div>", "text/html");
    var root = doc.getElementById("root");

    // Label each fenced block with its language, and give untagged ones the
    // one label that is always true here: it is a console.
    root.querySelectorAll("pre").forEach(function (pre) {
      var code = pre.querySelector("code");
      var cls = (code && code.className) || "";
      var match = cls.match(/language-([\w+#-]+)/);
      pre.setAttribute("data-lang", match ? match[1] : "console");
    });

    // Wide IoC tables get their own scroll container so the page never does.
    root.querySelectorAll("table").forEach(function (table) {
      var wrap = doc.createElement("div");
      wrap.className = "table-wrap";
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });

    // Stable anchors for the file index.
    var used = {};
    root.querySelectorAll("h2, h3").forEach(function (h) {
      var base = slugify(h.textContent) || "section";
      used[base] = (used[base] || 0) + 1;
      h.id = used[base] > 1 ? base + "-" + used[base] : base;
    });

    return root.innerHTML;
  }

  /* --- chrome ----------------------------------------------------------- */

  function stickMasthead() {
    var bar = document.querySelector(".masthead");
    if (!bar) return;
    var onScroll = function () { bar.dataset.stuck = String(window.scrollY > 24); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* Wipe elements in as they arrive. Staggered by data-delay in ms. */
  function revealOnScroll(scope) {
    var targets = (scope || document).querySelectorAll("[data-reveal]:not(.is-in)");
    if (!targets.length) return;

    if (!("IntersectionObserver" in global)) {
      targets.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* Run the opening sequence: each element wipes in on its own beat. */
  function playIntro(scope) {
    (scope || document).querySelectorAll("[data-intro]").forEach(function (el, i) {
      el.style.setProperty("--delay", (i * 70) + "ms");
      requestAnimationFrame(function () { el.classList.add("is-in"); });
    });
  }

  function fail(message) {
    var main = document.querySelector("main") || document.body;
    main.innerHTML =
      '<div class="shell" style="padding:12rem 0 8rem">' +
        '<p class="eyebrow" style="color:var(--alert)">Catalog unavailable</p>' +
        '<h1 style="font-size:clamp(1.6rem,4vw,2.8rem);text-transform:uppercase;margin:.6rem 0 1rem">' +
          escapeHtml(message) +
        "</h1>" +
        '<p style="max-width:52ch">episodes.yaml could not be read. Serve this directory over HTTP ' +
        "(<code>./serve.sh</code>) rather than opening the file directly — browsers block " +
        "<code>fetch</code> on <code>file://</code> URLs.</p>" +
      "</div>";
  }

  global.Chronicles = {
    loadCatalog: loadCatalog,
    fetchHook: fetchHook,
    renderMarkdown: renderMarkdown,
    splitFrontMatter: splitFrontMatter,
    slugify: slugify,
    pad: pad,
    formatDate: formatDate,
    escapeHtml: escapeHtml,
    stickMasthead: stickMasthead,
    revealOnScroll: revealOnScroll,
    playIntro: playIntro,
    fail: fail
  };
})(window);
