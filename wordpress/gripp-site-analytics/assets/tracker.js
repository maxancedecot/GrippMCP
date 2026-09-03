(function () {
  "use strict";

  var config = window.grippSiteAnalytics || {};
  if (!config.restUrl || !config.publicKey || !window.fetch) {
    return;
  }

  var visitorId = storedId("localStorage", "gripp_site_analytics_visitor_id");
  var sessionId = currentSessionId();
  var pageViewId = createId();
  var lastEngagementSentAt = Date.now();
  var maxScrollPercent = currentScrollPercent();
  var scrollMarks = [25, 50, 75, 90, 100];
  var sentScrollMarks = {};
  var finalized = false;
  var traffic = trafficSource();

  send("page_view", {
    active_time_ms_delta: 0,
    scroll_percent: maxScrollPercent
  });
  window.setInterval(function () {
    if (document.visibilityState === "visible") {
      sendEngagement();
    }
  }, 15000);

  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      sendEngagement();
    } else {
      lastEngagementSentAt = Date.now();
    }
  });
  window.addEventListener("pagehide", function () {
    if (!finalized) {
      finalized = true;
      sendEngagement();
    }
  });

  function onScroll() {
    maxScrollPercent = Math.max(maxScrollPercent, currentScrollPercent());
    scrollMarks.forEach(function (mark) {
      if (maxScrollPercent >= mark && !sentScrollMarks[mark]) {
        sentScrollMarks[mark] = true;
        send("scroll", {
          active_time_ms_delta: 0,
          scroll_percent: maxScrollPercent
        });
      }
    });
  }

  function sendEngagement() {
    var now = Date.now();
    var delta = Math.max(0, Math.min(60000, now - lastEngagementSentAt));
    lastEngagementSentAt = now;

    if (delta <= 0 && maxScrollPercent <= 0) {
      return;
    }

    send("engagement", {
      active_time_ms_delta: delta,
      scroll_percent: maxScrollPercent
    });
  }

  function send(eventType, extra) {
    touchSession();

    var payload = Object.assign({
      public_key: config.publicKey,
      event_type: eventType,
      visitor_id: visitorId,
      session_id: sessionId,
      page_view_id: pageViewId,
      page_url: window.location.href,
      path: window.location.pathname || "/",
      page_title: document.title || "",
      referrer: document.referrer || "",
      source: traffic.source,
      medium: traffic.medium,
      campaign: traffic.campaign,
      viewport_width: window.innerWidth || 0,
      viewport_height: window.innerHeight || 0
    }, extra || {});
    var body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(config.restUrl, blob)) {
        return;
      }
    }

    window.fetch(config.restUrl, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        "Content-Type": "application/json"
      },
      body: body
    }).catch(function () {});
  }

  function trafficSource() {
    var params = new URLSearchParams(window.location.search);
    var utmSource = params.get("utm_source") || "";
    var utmMedium = params.get("utm_medium") || "";
    var utmCampaign = params.get("utm_campaign") || "";

    if (utmSource) {
      return {
        source: utmSource.toLowerCase(),
        medium: utmMedium.toLowerCase(),
        campaign: utmCampaign
      };
    }

    if (!document.referrer) {
      return { source: "direct", medium: "", campaign: "" };
    }

    try {
      var referrerUrl = new URL(document.referrer);
      var currentHost = window.location.host;
      var host = referrerUrl.host.replace(/^www\./, "");
      if (referrerUrl.host === currentHost) {
        return { source: "internal", medium: "", campaign: "" };
      }

      if (/google\./.test(host)) {
        return { source: "google", medium: "organic", campaign: "" };
      }
      if (/bing\./.test(host)) {
        return { source: "bing", medium: "organic", campaign: "" };
      }

      return { source: host, medium: "referral", campaign: "" };
    } catch (error) {
      return { source: "referral", medium: "", campaign: "" };
    }
  }

  function currentScrollPercent() {
    var root = document.documentElement;
    var body = document.body;
    var scrollTop = window.scrollY || root.scrollTop || body.scrollTop || 0;
    var scrollHeight = Math.max(root.scrollHeight || 0, body ? body.scrollHeight || 0 : 0);
    var viewportHeight = window.innerHeight || root.clientHeight || 0;
    var scrollable = Math.max(0, scrollHeight - viewportHeight);

    if (scrollable === 0) {
      return 100;
    }

    return Math.max(0, Math.min(100, Math.round((scrollTop / scrollable) * 100)));
  }

  function storedId(storageName, key) {
    try {
      var storage = window[storageName];
      var existing = storage.getItem(key);
      if (existing) {
        return existing;
      }

      var value = createId();
      storage.setItem(key, value);
      return value;
    } catch (error) {
      return createId();
    }
  }

  function currentSessionId() {
    var key = "gripp_site_analytics_session";
    var now = Date.now();

    try {
      var existing = JSON.parse(window.localStorage.getItem(key) || "null");
      if (existing && existing.id && existing.updated_at && now - existing.updated_at < 30 * 60 * 1000) {
        window.localStorage.setItem(key, JSON.stringify({ id: existing.id, updated_at: now }));
        return existing.id;
      }

      var value = createId();
      window.localStorage.setItem(key, JSON.stringify({ id: value, updated_at: now }));
      return value;
    } catch (error) {
      return createId();
    }
  }

  function touchSession() {
    try {
      window.localStorage.setItem("gripp_site_analytics_session", JSON.stringify({ id: sessionId, updated_at: Date.now() }));
    } catch (error) {}
  }

  function createId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }

    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }
})();
