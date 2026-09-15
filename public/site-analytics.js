(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || !window.fetch || window.self !== window.top || location.protocol !== "https:") return;
  if (/^\/(v2\/preview|wp-admin|wp-login\.php)(\/|$)/i.test(location.pathname)) return;
  if (window.__grippBrowserAnalyticsQueued || window.__grippSiteAnalyticsLoaded) return;
  window.__grippBrowserAnalyticsQueued = true;
  var endpoint = new URL("/api/site-analytics/browser", script.src).href;
  var project = script.getAttribute("data-project") || "ledoux";
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  function start() {
    if (window.__grippSiteAnalyticsLoaded || (window.grippSiteAnalytics && window.grippSiteAnalytics.restUrl)) return;
    window.__grippSiteAnalyticsLoaded = true;
    var visitorId = storedId("gripp_site_analytics_visitor_id");
    var sessionId;
    var pageViewId;
    var pageUrl;
    var pageTitle;
    var traffic;
    var maxScroll = 0;
    var lastActive = Date.now();
    var visible = document.visibilityState !== "hidden";
    var pending = Promise.resolve();
    beginPage();

    function beginPage() {
      sessionId = currentSession();
      pageViewId = createId();
      pageUrl = cleanUrl(location.href);
      pageTitle = document.title.slice(0, 180);
      traffic = trafficSource();
      maxScroll = scrollPercent();
      lastActive = Date.now();
      send("page_view", 0);
    }
    function cleanUrl(value) {
      var url = new URL(value);
      var clean = new URL(url.origin + url.pathname);
      var slug = url.searchParams.get("p_slug");
      if (slug) clean.searchParams.set("p_slug", slug.slice(0, 240));
      return clean.href;
    }
    function send(type, delta) {
      touchSession();
      var payload = {
        project: project, event_type: type, visitor_id: visitorId, session_id: sessionId,
        page_view_id: pageViewId, page_url: pageUrl, page_title: pageTitle,
        referrer: referrerOrigin(), source: traffic.source, medium: traffic.medium,
        active_time_ms_delta: delta, scroll_percent: maxScroll
      };
      // Capture this page now and keep registration ahead of subsequent events.
      pending = pending.then(function () {
        return window.fetch(endpoint, {
          method: "POST", mode: "cors", credentials: "omit", keepalive: true,
          headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(payload)
        }).then(function (response) { return response.ok; }).catch(function () { return false; });
      });
      return pending;
    }
    function engagement() {
      var now = Date.now();
      var delta = visible ? Math.max(0, Math.min(60000, now - lastActive)) : 0;
      lastActive = now;
      if (delta > 0) send("engagement", delta);
    }
    function navigation() {
      if (cleanUrl(location.href) === pageUrl) return;
      engagement();
      beginPage();
    }
    window.setInterval(function () { if (visible) engagement(); }, 15000);
    window.addEventListener("scroll", function () { maxScroll = Math.max(maxScroll, scrollPercent()); }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      engagement(); visible = document.visibilityState !== "hidden"; lastActive = Date.now();
    });
    window.addEventListener("pagehide", engagement);
    window.addEventListener("pageshow", function (event) { if (event.persisted) beginPage(); });
    window.addEventListener("popstate", navigation);
    ["pushState", "replaceState"].forEach(function (name) {
      var original = history[name];
      history[name] = function () {
        var result = original.apply(this, arguments);
        window.setTimeout(navigation, 0);
        return result;
      };
    });

    function scrollPercent() {
      var root = document.documentElement;
      var body = document.body;
      var top = window.scrollY || root.scrollTop || (body && body.scrollTop) || 0;
      var height = Math.max(root.scrollHeight || 0, body ? body.scrollHeight || 0 : 0);
      var viewport = window.innerHeight || root.clientHeight || 0;
      var scrollable = Math.max(0, height - viewport);
      return scrollable ? Math.max(0, Math.min(100, Math.round(top / scrollable * 100))) : 100;
    }
    function trafficSource() {
      var params = new URLSearchParams(location.search);
      if (params.get("utm_source")) return { source: params.get("utm_source").slice(0, 80), medium: (params.get("utm_medium") || "").slice(0, 80) };
      var referrer = referrerOrigin();
      if (!referrer) return { source: "direct", medium: "" };
      var host = new URL(referrer).hostname.replace(/^www\./, "");
      if (host === location.hostname.replace(/^www\./, "")) return { source: "internal", medium: "" };
      return { source: host.slice(0, 80), medium: /^(google|bing)\./.test(host) ? "organic" : "referral" };
    }
    function referrerOrigin() {
      try { return document.referrer ? new URL(document.referrer).origin : ""; } catch (error) { return ""; }
    }
    function storedId(key) {
      try {
        var value = window.localStorage.getItem(key) || createId();
        window.localStorage.setItem(key, value); return value;
      } catch (error) { return createId(); }
    }
    function currentSession() {
      try {
        var previous = JSON.parse(window.localStorage.getItem("gripp_site_analytics_session") || "null");
        if (previous && previous.id && Date.now() - previous.updated_at < 30 * 60 * 1000) return previous.id;
      } catch (error) {}
      return createId();
    }
    function touchSession() {
      try { window.localStorage.setItem("gripp_site_analytics_session", JSON.stringify({ id: sessionId, updated_at: Date.now() })); } catch (error) {}
    }
    function createId() {
      return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }
  }
})();
