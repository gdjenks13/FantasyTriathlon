(function () {
  "use strict";

  /* ===================== CONSTANTS ===================== */
  var ATHLETES = [
    "Nick Bame",
    "David De Genaro",
    "Glenn Jenkins",
    "Caleb Schimming",
    "Noah Thammavong",
    "Nathan Webb",
  ];
  var STORAGE_KEY = "fantasyTriathlonState_v2";
  var SWIM_YARDS = 1640.42;
  var BIKE_MILES = 25.6;
  var RUN_MILES = 6.213712;

  var RANK_POINTS = { 0: 5, 1: 3, 2: 1 }; // diff in rank -> points, else 0
  var MAX_RANK_PTS = 5;
  var MAX_TIME_PTS = { swim: 10, bike: 10, run: 10, transition: 4 };
  var MAX_WILDCARD_PTS = 5;

  var TIME_POINT_TABLES = {
    swim: [
      [30, 10],
      [60, 8],
      [180, 6],
      [300, 4],
      [600, 2],
    ],
    run: [
      [30, 10],
      [60, 8],
      [180, 6],
      [300, 4],
      [600, 2],
    ],
    bike: [
      [30, 10],
      [120, 8],
      [300, 6],
      [600, 4],
      [900, 2],
    ],
    transition: [
      [30, 4],
      [120, 2],
      [240, 1],
    ],
  };

  /* ===================== STATE =====================
     Save model: this app saves on explicit, discrete actions rather than
     on a timer or on every keystroke. That means:
       - Typing a prediction edits an in-memory "draft" only.
       - Clicking "Save Prediction" commits that player's draft to their
         saved predictions and writes to localStorage immediately.
       - The Results tab has its own "Save Results" action in the header,
         since results come in over time rather than all at once.
       - Adding/removing a player, and Clear All Data, save immediately
         since those are already deliberate, discrete actions.
     This avoids losing work (nothing is ever "pending" for long) without
     re-saving on every blur, which was interrupting data entry.
  ================================================== */
  var state = loadState();

  function emptyResults() {
    var r = {};
    ATHLETES.forEach(function (a) {
      r[a] = { swim: null, t1: null, bike: null, t2: null, run: null };
    });
    return r;
  }

  function defaultState() {
    return {
      players: [], // { id, name, open, predictions, wildcards (SAVED), draftPredictions, draftWildcards (EDITING), hasSavedPrediction }
      results: emptyResults(), // { [athlete]: { swim, t1, bike, t2, run (seconds or null) } }
    };
  }

  function emptyPredictions() {
    var p = {};
    ATHLETES.forEach(function (a) {
      p[a] = { swim: null, bike: null, run: null, transition: null };
    });
    return p;
  }

  function emptyAthleteResult() {
    return { swim: null, t1: null, bike: null, t2: null, run: null };
  }

  function emptyAthletePrediction() {
    return { swim: null, bike: null, run: null, transition: null };
  }

  // Ensure every ATHLETE has result/prediction slots so roster growth (e.g. adding
  // a 6th athlete) does not break existing localStorage data.
  function normalizeState(parsed) {
    if (!parsed || typeof parsed !== "object") return defaultState();
    if (!Array.isArray(parsed.players)) parsed.players = [];
    if (!parsed.results || typeof parsed.results !== "object") {
      parsed.results = emptyResults();
    }
    ATHLETES.forEach(function (a) {
      if (!parsed.results[a] || typeof parsed.results[a] !== "object") {
        parsed.results[a] = emptyAthleteResult();
      } else {
        ["swim", "t1", "bike", "t2", "run"].forEach(function (k) {
          if (typeof parsed.results[a][k] === "undefined") {
            parsed.results[a][k] = null;
          }
        });
      }
    });
    parsed.players.forEach(function (p) {
      if (!p.predictions || typeof p.predictions !== "object") {
        p.predictions = emptyPredictions();
      }
      if (!p.wildcards || typeof p.wildcards !== "object") {
        p.wildcards = { t1: null, t2: null };
      }
      if (!p.draftPredictions || typeof p.draftPredictions !== "object") {
        p.draftPredictions = deepCopy(p.predictions);
      }
      if (!p.draftWildcards || typeof p.draftWildcards !== "object") {
        p.draftWildcards = deepCopy(p.wildcards);
      }
      ATHLETES.forEach(function (a) {
        if (!p.predictions[a] || typeof p.predictions[a] !== "object") {
          p.predictions[a] = emptyAthletePrediction();
        }
        if (
          !p.draftPredictions[a] ||
          typeof p.draftPredictions[a] !== "object"
        ) {
          p.draftPredictions[a] = emptyAthletePrediction();
        }
      });
      if (typeof p.hasSavedPrediction !== "boolean") {
        p.hasSavedPrediction = ATHLETES.some(function (a) {
          var pr = p.predictions[a];
          return (
            pr &&
            (pr.swim !== null ||
              pr.bike !== null ||
              pr.run !== null ||
              pr.transition !== null)
          );
        });
      }
      if (typeof p.open !== "boolean") p.open = false;
    });
    return parsed;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load state", e);
      return defaultState();
    }
  }

  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Snapshot of results last known to be on disk (explicit save, load, import,
  // or silent background flush). Used for dirty UI on the Results tab.
  var resultsSavedSnapshot = null;

  function captureResultsSnapshot() {
    resultsSavedSnapshot = JSON.stringify(state.results);
  }

  function hasUnsavedResults() {
    return JSON.stringify(state.results) !== resultsSavedSnapshot;
  }

  function persistNow(silent) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      // Background flush also lands results on disk — clear dirty UI.
      captureResultsSnapshot();
      updateResultsSaveButton();
      updateSaveIndicator();
      if (!silent) showToast("Saved");
      // Editor: push shared state so spectators see updates quickly
      if (isEditor() && !applyingCloud) {
        scheduleCloudPublish(silent);
      }
    } catch (e) {
      console.error("Failed to save state", e);
      showToast("Save failed");
    }
  }

  var toastTimer = null;
  function showToast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show");
    }, 900);
  }

  // Safety net: flush current state if the tab is closed/backgrounded.
  // Prediction drafts are included in state and recover on reopen; committed
  // predictions still require explicit "Save Prediction" for scoring.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") persistNow(true);
  });
  window.addEventListener("pagehide", function () {
    persistNow(true);
  });

  function updateSaveIndicator() {
    var el = document.getElementById("save-indicator");
    if (!el) return;
    var unsavedCount = state.players.filter(function (p) {
      return hasUnsavedDraft(p);
    }).length;
    var resultsDirty = hasUnsavedResults();
    var parts = [];
    if (unsavedCount > 0) {
      parts.push(
        unsavedCount === 1
          ? "1 prediction has unsaved changes"
          : unsavedCount + " predictions have unsaved changes",
      );
    }
    if (resultsDirty) {
      parts.push("unsaved race results");
    }
    if (parts.length > 0) {
      el.textContent = parts.join(" · ");
      el.classList.add("pending");
    } else {
      el.textContent = "All changes saved";
      el.classList.remove("pending");
    }
  }

  function updateResultsSaveButton() {
    var btn = document.getElementById("save-results-btn");
    if (!btn) return;
    var dirty = hasUnsavedResults();
    btn.className = "btn-header-action" + (dirty ? "" : " is-saved");
    btn.textContent = dirty ? "Save Results" : "Results Saved \u2713";
  }

  function hasUnsavedDraft(player) {
    return (
      JSON.stringify(player.draftPredictions) !==
        JSON.stringify(player.predictions) ||
      JSON.stringify(player.draftWildcards) !== JSON.stringify(player.wildcards)
    );
  }

  // After loadState() ran above, baseline the results snapshot.
  captureResultsSnapshot();

  /* ===================== SUPABASE CLOUD SYNC ===================== */
  var supabaseClient = null;
  var authUser = null;
  var applyingCloud = false;
  var cloudConfigured = false;
  var cloudLastRemoteAt = null;
  var cloudPublishTimer = null;
  var cloudPollTimer = null;
  var cloudChannel = null;

  function getConfig() {
    return window.FANTASY_CONFIG || {};
  }

  function hasCloudConfig() {
    var cfg = getConfig();
    return !!(cfg.supabaseUrl && String(cfg.supabaseAnonKey || "").trim());
  }

  function isEditor() {
    return !!(authUser && supabaseClient);
  }

  // When cloud is configured, only the logged-in editor may change data.
  // Spectators always view shared Supabase state.
  function canEditData() {
    if (!hasCloudConfig()) return true;
    return isEditor();
  }

  function setCloudStatus(text, kind) {
    var el = document.getElementById("cloud-status");
    if (!el) return;
    el.textContent = text;
    el.className = "cloud-status" + (kind ? " " + kind : "");
  }

  function openLoginModal() {
    var modal = document.getElementById("login-modal");
    if (!modal) return;
    var emailInput = document.getElementById("cloud-email");
    var pw = document.getElementById("cloud-password");
    // Never autofill — editor must type email and password each time
    if (emailInput) emailInput.value = "";
    if (pw) pw.value = "";
    var errEl = document.getElementById("cloud-login-error");
    if (errEl) {
      errEl.style.display = "none";
      errEl.textContent = "";
    }
    modal.style.display = "flex";
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(function () {
      if (emailInput) emailInput.focus();
    }, 50);
  }

  function closeLoginModal() {
    var modal = document.getElementById("login-modal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("hidden", "");
    modal.setAttribute("aria-hidden", "true");
  }

  function updateEditorUI() {
    var editorBar = document.getElementById("cloud-editor-bar");
    var emailEl = document.getElementById("cloud-user-email");
    var headerLogin = document.getElementById("header-login-btn");

    if (!hasCloudConfig()) {
      if (editorBar) editorBar.style.display = "none";
      if (headerLogin) {
        headerLogin.style.display = "none";
      }
      document.body.classList.remove("spectator-mode");
      return;
    }

    if (headerLogin) headerLogin.style.display = "inline-block";

    if (isEditor()) {
      if (editorBar) editorBar.style.display = "block";
      if (emailEl) emailEl.textContent = authUser.email || "editor";
      if (headerLogin) {
        headerLogin.textContent = "Log out";
        headerLogin.classList.add("is-saved");
        headerLogin.title = "Signed in as " + (authUser.email || "editor");
      }
      document.body.classList.remove("spectator-mode");
      closeLoginModal();
      setCloudStatus(
        "Editor · " +
          (authUser.email || "signed in") +
          (cloudLastRemoteAt
            ? " · " + formatCloudTime(cloudLastRemoteAt)
            : ""),
        "editor",
      );
    } else {
      if (editorBar) editorBar.style.display = "none";
      if (headerLogin) {
        headerLogin.textContent = "Log in";
        headerLogin.classList.remove("is-saved");
        headerLogin.title = "Editor log in to publish changes";
      }
      document.body.classList.add("spectator-mode");
      setCloudStatus(
        cloudConfigured
          ? "Live data" +
              (cloudLastRemoteAt
                ? " · updated " + formatCloudTime(cloudLastRemoteAt)
                : " · loading…")
          : "Connecting to shared data…",
        cloudLastRemoteAt ? "ok" : "warn",
      );
    }
  }

  function formatCloudTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  function stripUiFlags(rawState) {
    // Don't publish ephemeral UI open/closed flags
    var copy = deepCopy(rawState);
    if (copy && Array.isArray(copy.players)) {
      copy.players.forEach(function (p) {
        delete p.open;
        delete p._viewOpen;
        delete p._lbOpen;
        // Drafts are local editing — publish saved predictions only
        // but keep drafts as mirrors of saved for simpler restore
        if (p.predictions) p.draftPredictions = deepCopy(p.predictions);
        if (p.wildcards) p.draftWildcards = deepCopy(p.wildcards);
      });
    }
    delete copy._resultsOrdersOpen;
    return copy;
  }

  function applyRemoteState(payload, updatedAt, opts) {
    opts = opts || {};
    applyingCloud = true;
    try {
      state = normalizeState(deepCopy(payload || defaultState()));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {}
      captureResultsSnapshot();
      cloudLastRemoteAt = updatedAt || null;
      if (opts.rerender !== false) {
        renderAllViews();
      }
      updateSaveIndicator();
      updateResultsSaveButton();
      updateEditorUI();
    } finally {
      applyingCloud = false;
    }
  }

  function renderAllViews() {
    renderPlayers();
    if (currentView === "pool") renderViewPredictions();
    if (currentView === "race") {
      renderLeaderboard();
      renderResults();
    }
    if (currentView === "compare") renderPlayerCompare();
  }

  async function pullCloudState(opts) {
    opts = opts || {};
    if (!supabaseClient) return null;
    try {
      var res = await supabaseClient
        .from("app_state")
        .select("payload, updated_at, updated_by")
        .eq("id", 1)
        .maybeSingle();
      if (res.error) {
        console.error("Cloud pull failed", res.error);
        if (opts.initial) {
          setCloudStatus("Cloud error: " + (res.error.message || "pull failed"), "err");
        }
        return null;
      }
      if (!res.data) {
        if (opts.initial) setCloudStatus("Cloud: empty — publish once as editor", "warn");
        return null;
      }
      var remoteAt = res.data.updated_at;
      var shouldApply = !!opts.force;
      if (!shouldApply && !isEditor()) {
        // Spectators always use Supabase as source of truth
        shouldApply =
          !!opts.initial ||
          !!opts.force ||
          !cloudLastRemoteAt ||
          new Date(remoteAt).getTime() > new Date(cloudLastRemoteAt).getTime();
      }
      if (!shouldApply && isEditor() && opts.initial) {
        // Editor first load: take cloud if local is empty
        var localPlayers = (state.players && state.players.length) || 0;
        var remotePlayers =
          (res.data.payload &&
            res.data.payload.players &&
            res.data.payload.players.length) ||
          0;
        shouldApply = remotePlayers > 0 && localPlayers === 0;
      }
      // Explicit force (e.g. after logout) always applies
      if (opts.force) shouldApply = true;
      if (shouldApply) {
        applyRemoteState(res.data.payload, remoteAt, { rerender: true });
        if (!opts.silent && !opts.initial) showToast("Updated from cloud");
      } else {
        cloudLastRemoteAt = remoteAt;
        updateEditorUI();
      }
      return res.data;
    } catch (e) {
      console.error("Cloud pull exception", e);
      if (opts.initial) setCloudStatus("Cloud unreachable", "err");
      return null;
    }
  }

  async function pushCloudState(opts) {
    opts = opts || {};
    if (!supabaseClient || !isEditor()) {
      if (!opts.silent) showToast("Log in to publish");
      return false;
    }
    try {
      var payload = stripUiFlags(state);
      var now = new Date().toISOString();
      var res = await supabaseClient.from("app_state").upsert(
        {
          id: 1,
          payload: payload,
          updated_at: now,
          updated_by: authUser.email || authUser.id,
        },
        { onConflict: "id" },
      );
      if (res.error) {
        console.error("Cloud publish failed", res.error);
        setCloudStatus("Publish failed: " + res.error.message, "err");
        if (!opts.silent) showToast("Publish failed");
        return false;
      }
      cloudLastRemoteAt = now;
      updateEditorUI();
      if (!opts.silent) showToast("Published to cloud");
      return true;
    } catch (e) {
      console.error("Cloud publish exception", e);
      if (!opts.silent) showToast("Publish failed");
      return false;
    }
  }

  function scheduleCloudPublish(silent) {
    clearTimeout(cloudPublishTimer);
    cloudPublishTimer = setTimeout(function () {
      pushCloudState({ silent: !!silent });
    }, 400);
  }

  function subscribeCloudRealtime() {
    if (!supabaseClient || cloudChannel) return;
    try {
      cloudChannel = supabaseClient
        .channel("app_state_live")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "app_state",
            filter: "id=eq.1",
          },
          function (payload) {
            if (isEditor() && applyingCloud) return;
            var row = payload.new;
            if (!row || !row.payload) return;
            // Editors ignore remote echoes of their own push unless forced
            if (isEditor()) {
              if (
                cloudLastRemoteAt &&
                row.updated_at &&
                new Date(row.updated_at).getTime() <=
                  new Date(cloudLastRemoteAt).getTime() + 500
              ) {
                return;
              }
              // Don't clobber in-progress editor work from own device
              return;
            }
            applyRemoteState(row.payload, row.updated_at, { rerender: true });
            showToast("Live update");
          },
        )
        .subscribe(function (status) {
          if (status === "SUBSCRIBED" && !isEditor()) {
            setCloudStatus(
              "Spectator · live" +
                (cloudLastRemoteAt
                  ? " · updated " + formatCloudTime(cloudLastRemoteAt)
                  : ""),
              "ok",
            );
          }
        });
    } catch (e) {
      console.warn("Realtime subscribe failed", e);
    }
  }

  function startCloudPoll() {
    var ms = getConfig().pollIntervalMs || 5000;
    clearInterval(cloudPollTimer);
    cloudPollTimer = setInterval(function () {
      if (!supabaseClient) return;
      // Spectators poll; editors only refresh status quietly
      pullCloudState({ silent: true, force: false });
    }, ms);
  }

  async function cloudLogin(email, password) {
    var errEl = document.getElementById("cloud-login-error");
    var loginBtn = document.getElementById("cloud-login-btn");
    if (errEl) {
      errEl.style.display = "none";
      errEl.textContent = "";
    }
    if (!supabaseClient) {
      if (errEl) {
        errEl.style.display = "block";
        errEl.textContent = "Cloud is not connected yet. Wait a moment and retry.";
      }
      return;
    }
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = "Signing in…";
    }
    try {
      var res = await withTimeout(
        supabaseClient.auth.signInWithPassword({
          email: email,
          password: password,
        }),
        12000,
        "Login",
      );
      if (res.error) {
        if (errEl) {
          errEl.style.display = "block";
          errEl.textContent =
            res.error.message ||
            "Login failed. Use the Auth user email/password from Supabase → Authentication → Users (not the database password).";
        }
        showToast("Login failed");
        return;
      }
      authUser = res.data.user;
      updateEditorUI();
      renderAllViews();
      showToast("Logged in as editor");
    } catch (e) {
      if (errEl) {
        errEl.style.display = "block";
        errEl.textContent = e.message || "Login timed out";
      }
      showToast("Login failed");
    } finally {
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = "Log in";
      }
    }
  }

  async function cloudLogout() {
    if (supabaseClient) await supabaseClient.auth.signOut();
    authUser = null;
    updateEditorUI();
    await pullCloudState({ force: true, silent: true, initial: false });
    renderAllViews();
    showToast("Logged out — showing live shared data");
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error((label || "Request") + " timed out"));
        }, ms);
      }),
    ]);
  }

  function getSupabaseCreateClient() {
    // UMD build exposes global `supabase` with createClient
    if (typeof supabase !== "undefined" && supabase.createClient) {
      return supabase.createClient;
    }
    // Some builds attach to window.supabase separately
    if (
      typeof window !== "undefined" &&
      window.supabase &&
      window.supabase.createClient
    ) {
      return window.supabase.createClient;
    }
    return null;
  }

  async function initCloud() {
    try {
      var cfg = getConfig();
      var url = cfg.supabaseUrl || "";
      var key = (cfg.supabaseAnonKey || "").trim();
      if (!url || !key) {
        cloudConfigured = false;
        setCloudStatus("Cloud not configured (add anon key in config.js)", "warn");
        updateEditorUI();
        return;
      }
      var createClient = getSupabaseCreateClient();
      if (!createClient) {
        cloudConfigured = false;
        setCloudStatus("Cloud library failed to load — check network/CDN", "err");
        updateEditorUI();
        return;
      }
      cloudConfigured = true;
      supabaseClient = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      });
      setCloudStatus("Cloud: connecting…");

      try {
        var sessionRes = await withTimeout(
          supabaseClient.auth.getSession(),
          8000,
          "Auth session",
        );
        authUser =
          sessionRes.data && sessionRes.data.session
            ? sessionRes.data.session.user
            : null;
      } catch (sessErr) {
        console.warn("getSession issue", sessErr);
        authUser = null;
      }

      supabaseClient.auth.onAuthStateChange(function (_event, session) {
        authUser = session ? session.user : null;
        updateEditorUI();
        // Avoid full re-render loops on INITIAL_SESSION during startup
        if (_event === "SIGNED_IN" || _event === "SIGNED_OUT") {
          renderAllViews();
        }
      });

      await withTimeout(
        pullCloudState({ initial: true, silent: true }),
        10000,
        "Cloud pull",
      );
      subscribeCloudRealtime();
      startCloudPoll();
      updateEditorUI();
      renderAllViews();

      // Guarantee we leave "connecting" if nothing else set a message
      var statusEl = document.getElementById("cloud-status");
      if (
        statusEl &&
        /connecting/i.test(statusEl.textContent || "")
      ) {
        setCloudStatus(
          isEditor()
            ? "Editor · signed in"
            : "Live data · tap Log in (top right) to edit",
          isEditor() ? "editor" : "ok",
        );
      }
    } catch (e) {
      console.error("initCloud failed", e);
      setCloudStatus(
        "Cloud error: " + (e && e.message ? e.message : "init failed"),
        "err",
      );
      updateEditorUI();
    }
  }

  function wireCloudUI() {
    var headerLogin = document.getElementById("header-login-btn");
    if (headerLogin) {
      headerLogin.addEventListener("click", function () {
        if (isEditor()) {
          cloudLogout();
          return;
        }
        openLoginModal();
      });
    }
    var loginBtn = document.getElementById("cloud-login-btn");
    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        var email = (document.getElementById("cloud-email").value || "").trim();
        var password = document.getElementById("cloud-password").value || "";
        if (!email || !password) {
          showToast("Enter email and password");
          return;
        }
        cloudLogin(email, password);
      });
    }
    var publishBtn = document.getElementById("cloud-publish-btn");
    if (publishBtn) {
      publishBtn.addEventListener("click", function () {
        pushCloudState({ silent: false });
      });
    }
    var closeBtn = document.getElementById("login-modal-close");
    var backdrop = document.getElementById("login-modal-backdrop");
    if (closeBtn) closeBtn.addEventListener("click", closeLoginModal);
    if (backdrop) backdrop.addEventListener("click", closeLoginModal);
    var pw = document.getElementById("cloud-password");
    if (pw) {
      pw.addEventListener("keydown", function (e) {
        if (e.key === "Enter") loginBtn && loginBtn.click();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLoginModal();
    });
  }

  /* ===================== TIME HELPERS ===================== */
  function partsToSeconds(h, m, s) {
    h = parseInt(h, 10);
    m = parseInt(m, 10);
    s = parseInt(s, 10);
    if (isNaN(h)) h = 0;
    if (isNaN(m)) m = 0;
    if (isNaN(s)) s = 0;
    return h * 3600 + m * 60 + s;
  }
  function secondsToParts(total) {
    if (total === null || total === undefined || isNaN(total))
      return { h: "", m: "", s: "" };
    total = Math.max(0, Math.round(total));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return { h: h, m: m, s: s };
  }
  function formatSeconds(total) {
    if (total === null || total === undefined || isNaN(total))
      return "--:--:--";
    var p = secondsToParts(total);
    return pad(p.h) + ":" + pad(p.m) + ":" + pad(p.s);
  }
  function pad(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) n = 0;
    return (n < 10 ? "0" : "") + n;
  }

  /* ===================== RANKING HELPER (handles ties) ===================== */
  function computeRanksWithTies(items) {
    var valid = items.filter(function (it) {
      return it.time !== null && it.time !== undefined && !isNaN(it.time);
    });
    valid.sort(function (a, b) {
      return a.time - b.time;
    });
    var result = {};
    var i = 0;
    while (i < valid.length) {
      var j = i;
      while (j + 1 < valid.length && valid[j + 1].time === valid[i].time) {
        j++;
      }
      var startRank = i + 1,
        endRank = j + 1;
      for (var k = i; k <= j; k++) {
        result[valid[k].key] = {
          start: startRank,
          end: endRank,
          best: startRank,
        };
      }
      i = j + 1;
    }
    return result;
  }

  /* ===================== DERIVED CALCS: PREDICTIONS ===================== */
  function getPredictionTotal(pred) {
    if (
      pred.swim === null ||
      pred.bike === null ||
      pred.run === null ||
      pred.transition === null
    )
      return null;
    return pred.swim + pred.bike + pred.run + pred.transition;
  }

  // Works against ANY predictions object (draft or saved)
  function computeRanksForPredictions(predictions) {
    var out = {};
    ["swim", "bike", "run", "transition"].forEach(function (disc) {
      var items = ATHLETES.map(function (a) {
        return { key: a, time: predictions[a] ? predictions[a][disc] : null };
      });
      out[disc] = computeRanksWithTies(items);
    });
    var items = ATHLETES.map(function (a) {
      return { key: a, time: getPredictionTotal(predictions[a]) };
    });
    out.overall = computeRanksWithTies(items);
    return out;
  }

  /* ===================== DERIVED CALCS: RESULTS ===================== */
  function getResultTotal(r) {
    if (
      !r ||
      r.swim === null ||
      r.t1 === null ||
      r.bike === null ||
      r.t2 === null ||
      r.run === null
    )
      return null;
    return r.swim + r.t1 + r.bike + r.t2 + r.run;
  }
  function getResultTransition(r) {
    if (!r || r.t1 === null || r.t2 === null) return null;
    return r.t1 + r.t2;
  }

  function computeActualRanks() {
    var out = {};
    ["swim", "bike", "run"].forEach(function (disc) {
      var items = ATHLETES.map(function (a) {
        return {
          key: a,
          time: state.results[a] ? state.results[a][disc] : null,
        };
      });
      out[disc] = computeRanksWithTies(items);
    });
    var overallItems = ATHLETES.map(function (a) {
      return { key: a, time: getResultTotal(state.results[a]) };
    });
    out.overall = computeRanksWithTies(overallItems);

    var t1Items = ATHLETES.map(function (a) {
      return { key: a, time: state.results[a] ? state.results[a].t1 : null };
    });
    out.t1 = computeRanksWithTies(t1Items);

    var t2Items = ATHLETES.map(function (a) {
      return { key: a, time: state.results[a] ? state.results[a].t2 : null };
    });
    out.t2 = computeRanksWithTies(t2Items);

    return out;
  }

  function athletesAtRank(rankInfoMap, n) {
    var res = [];
    Object.keys(rankInfoMap).forEach(function (k) {
      var info = rankInfoMap[k];
      if (n >= info.start && n <= info.end) res.push(k);
    });
    return res;
  }

  /* ===================== SCORING (uses SAVED predictions only) ===================== */
  function rankDiffPoints(predictedRank, actualRankInfo) {
    if (
      !actualRankInfo ||
      predictedRank === null ||
      predictedRank === undefined
    )
      return 0;
    var diff;
    if (
      predictedRank >= actualRankInfo.start &&
      predictedRank <= actualRankInfo.end
    ) {
      diff = 0;
    } else if (predictedRank < actualRankInfo.start) {
      diff = actualRankInfo.start - predictedRank;
    } else {
      diff = predictedRank - actualRankInfo.end;
    }
    return RANK_POINTS.hasOwnProperty(diff) ? RANK_POINTS[diff] : 0;
  }

  function timeDiffPoints(diffSeconds, table) {
    if (diffSeconds === null || diffSeconds === undefined || isNaN(diffSeconds))
      return 0;
    diffSeconds = Math.abs(diffSeconds);
    for (var i = 0; i < table.length; i++) {
      if (diffSeconds <= table[i][0]) return table[i][1];
    }
    return 0;
  }

  function rankOffBy(predictedRank, actualRankInfo) {
    if (
      !actualRankInfo ||
      predictedRank === null ||
      predictedRank === undefined
    )
      return null;
    if (
      predictedRank >= actualRankInfo.start &&
      predictedRank <= actualRankInfo.end
    )
      return 0;
    if (predictedRank < actualRankInfo.start)
      return actualRankInfo.start - predictedRank;
    return predictedRank - actualRankInfo.end;
  }

  function formatRankInfo(info) {
    if (!info) return "--";
    if (info.start === info.end) return String(info.start);
    return info.start + "\u2013" + info.end;
  }

  function formatSignedSeconds(diff) {
    if (diff === null || diff === undefined || isNaN(diff)) return "--";
    if (diff === 0) return "exact";
    var sign = diff < 0 ? "\u2212" : "+";
    return sign + formatSeconds(Math.abs(diff));
  }

  function scorePlayer(player) {
    var actualRanks = computeActualRanks();
    var predRanks = computeRanksForPredictions(player.predictions);
    var perAthlete = {};
    var total = 0;
    var rankByDisc = {
      swim: { pts: 0, max: 0 },
      bike: { pts: 0, max: 0 },
      run: { pts: 0, max: 0 },
    };
    var timeByDisc = {
      swim: { pts: 0, max: 0 },
      bike: { pts: 0, max: 0 },
      run: { pts: 0, max: 0 },
      transition: { pts: 0, max: 0 },
    };

    ATHLETES.forEach(function (a) {
      var pred = player.predictions[a] || {};
      var res = state.results[a] || {};
      var entry = {
        ranks: {},
        times: {},
      };

      ["swim", "bike", "run"].forEach(function (disc) {
        var predInfo = predRanks[disc] ? predRanks[disc][a] : null;
        var predictedRank = predInfo ? predInfo.best : null;
        var actualInfo = actualRanks[disc] ? actualRanks[disc][a] : null;
        var eligible = !!actualInfo;
        var pts = rankDiffPoints(predictedRank, actualInfo);
        var offBy = rankOffBy(predictedRank, actualInfo);
        entry.ranks[disc] = {
          predicted: predictedRank,
          actual: actualInfo,
          actualLabel: formatRankInfo(actualInfo),
          offBy: offBy,
          pts: pts,
          max: eligible ? MAX_RANK_PTS : 0,
        };
        rankByDisc[disc].pts += pts;
        if (eligible) rankByDisc[disc].max += MAX_RANK_PTS;
        total += pts;
      });

      ["swim", "bike", "run"].forEach(function (disc) {
        var predT = pred[disc] != null ? pred[disc] : null;
        var actT = res[disc] != null ? res[disc] : null;
        var eligible = predT !== null && actT !== null;
        var diff = eligible ? predT - actT : null;
        var pts = eligible ? timeDiffPoints(diff, TIME_POINT_TABLES[disc]) : 0;
        entry.times[disc] = {
          predicted: predT,
          actual: actT,
          diff: diff,
          pts: pts,
          max: eligible ? MAX_TIME_PTS[disc] : 0,
        };
        timeByDisc[disc].pts += pts;
        if (eligible) timeByDisc[disc].max += MAX_TIME_PTS[disc];
        total += pts;
      });

      var predTr = pred.transition != null ? pred.transition : null;
      var actTr = getResultTransition(res);
      var trEligible = predTr !== null && actTr !== null;
      var trDiff = trEligible ? predTr - actTr : null;
      var trPts = trEligible
        ? timeDiffPoints(trDiff, TIME_POINT_TABLES.transition)
        : 0;
      entry.times.transition = {
        predicted: predTr,
        actual: actTr,
        diff: trDiff,
        pts: trPts,
        max: trEligible ? MAX_TIME_PTS.transition : 0,
      };
      timeByDisc.transition.pts += trPts;
      if (trEligible) timeByDisc.transition.max += MAX_TIME_PTS.transition;
      total += trPts;

      perAthlete[a] = entry;
    });

    var t1AtRank3 = athletesAtRank(actualRanks.t1, 3);
    var t2AtRank3 = athletesAtRank(actualRanks.t2, 3);
    var t1Eligible = t1AtRank3.length > 0;
    var t2Eligible = t2AtRank3.length > 0;
    var wc = {
      t1: {
        pick: player.wildcards.t1 || null,
        actual: t1AtRank3,
        pts:
          player.wildcards.t1 && t1AtRank3.indexOf(player.wildcards.t1) !== -1
            ? MAX_WILDCARD_PTS
            : 0,
        max: t1Eligible ? MAX_WILDCARD_PTS : 0,
      },
      t2: {
        pick: player.wildcards.t2 || null,
        actual: t2AtRank3,
        pts:
          player.wildcards.t2 && t2AtRank3.indexOf(player.wildcards.t2) !== -1
            ? MAX_WILDCARD_PTS
            : 0,
        max: t2Eligible ? MAX_WILDCARD_PTS : 0,
      },
    };
    total += wc.t1.pts + wc.t2.pts;

    function sumField(obj, field) {
      return Object.keys(obj).reduce(function (s, k) {
        return s + obj[k][field];
      }, 0);
    }

    var rankTotal = sumField(rankByDisc, "pts");
    var rankMax = sumField(rankByDisc, "max");
    var timeTotal = sumField(timeByDisc, "pts");
    var timeMax = sumField(timeByDisc, "max");
    var wildcardTotal = wc.t1.pts + wc.t2.pts;
    var wildcardMax = wc.t1.max + wc.t2.max;

    return {
      total: total,
      max: rankMax + timeMax + wildcardMax,
      perAthlete: perAthlete,
      wildcards: wc,
      categories: {
        rank: { total: rankTotal, max: rankMax, byDisc: rankByDisc },
        time: { total: timeTotal, max: timeMax, byDisc: timeByDisc },
        wildcards: {
          total: wildcardTotal,
          max: wildcardMax,
          t1: wc.t1,
          t2: wc.t2,
        },
      },
    };
  }

  function hasAnyResults() {
    return ATHLETES.some(function (a) {
      var r = state.results[a];
      return (
        r &&
        (r.swim !== null ||
          r.t1 !== null ||
          r.bike !== null ||
          r.t2 !== null ||
          r.run !== null)
      );
    });
  }

  function playersWithSavedPredictions() {
    return state.players.filter(function (p) {
      return p.hasSavedPrediction;
    });
  }

  /* ===================== RENDER: TABS ===================== */
  var views = ["predictions", "pool", "race", "info", "compare"];
  var titles = {
    predictions: "Enter Predictions",
    pool: "Prediction Pool",
    race: "Race Day",
    info: "Race Info",
    compare: "Prediction Detail",
  };
  var comparePlayerId = null;
  var currentView = "predictions";

  function switchView(name) {
    try {
      if (!name || views.indexOf(name) === -1) return;
      currentView = name;
      views.forEach(function (v) {
        var el = document.getElementById("view-" + v);
        if (el) el.classList.toggle("active", v === name);
      });
      document.querySelectorAll(".tab-btn").forEach(function (btn) {
        // Compare is a sub-screen of Race — keep Race tab highlighted
        var active =
          btn.dataset.view === name ||
          (name === "compare" && btn.dataset.view === "race");
        btn.classList.toggle("active", active);
      });
      var titleEl = document.getElementById("header-title");
      if (titleEl) titleEl.textContent = titles[name] || name;

      var saveBtn = document.getElementById("save-results-btn");
      if (saveBtn) {
        saveBtn.style.display =
          name === "race" && canEditData() ? "inline-block" : "none";
      }
      var backBtn = document.getElementById("back-from-compare-btn");
      if (backBtn) {
        backBtn.style.display = name === "compare" ? "inline-block" : "none";
      }
      // Never leave login modal covering the app after a tab change
      if (name !== "compare") {
        /* keep modal only if user opened it */
      }

      if (name === "pool") renderViewPredictions();
      if (name === "race") {
        renderLeaderboard();
        renderResults();
        updateResultsSaveButton();
      }
      if (name === "compare") renderPlayerCompare();
      if (name === "predictions") renderPlayers();
      updateSaveIndicator();
      updateEditorUI();
    } catch (e) {
      console.error("switchView failed", name, e);
    }
  }

  // Event delegation so tabs always work even if buttons are re-rendered
  var tabBar = document.querySelector(".tab-bar");
  if (tabBar) {
    tabBar.addEventListener("click", function (e) {
      var btn = e.target.closest(".tab-btn");
      if (!btn) return;
      e.preventDefault();
      var view = btn.getAttribute("data-view");
      if (view) switchView(view);
    });
  }

  document
    .getElementById("back-from-compare-btn")
    .addEventListener("click", function () {
      switchView("race");
    });

  /* ===================== RENDER: PREDICTIONS (edits DRAFT) ===================== */
  function refreshPredictionCardState(player, wrap) {
    var predRanks = computeRanksForPredictions(player.draftPredictions);

    ATHLETES.forEach(function (athlete) {
      var block = wrap.querySelector(
        '.athlete-block[data-athlete="' + athlete + '"]',
      );
      if (!block) return;
      var pred = player.draftPredictions[athlete];
      var total = getPredictionTotal(pred);
      var overallInfo = predRanks.overall[athlete];
      var rankLabel = overallInfo ? ordinal(overallInfo.best) : "--";
      var summaryEl = block.querySelector(".athlete-summary");
      if (summaryEl) {
        summaryEl.innerHTML =
          formatSeconds(total) + " &nbsp;·&nbsp; " + rankLabel;
      }
    });

    var dirty = hasUnsavedDraft(player);
    var saveBtn = wrap.querySelector(".save-prediction-btn");
    if (saveBtn) {
      saveBtn.className =
        "btn-primary save-prediction-btn" + (dirty ? "" : " is-saved");
      saveBtn.textContent = dirty ? "Save Prediction" : "Prediction Saved ✓";
    }
    updateSaveIndicator();

    var hint = wrap.querySelector(".save-prediction-hint");
    if (hint) {
      hint.style.display = dirty ? "block" : "none";
      hint.textContent = dirty
        ? "You have unsaved changes for " + player.name + "."
        : "";
    }
  }

  function renderPlayers() {
    var listEl = document.getElementById("players-list");
    var emptyEl = document.getElementById("players-empty");
    listEl.innerHTML = "";

    var canEdit = canEditData();
    var addInput = document.getElementById("new-player-name");
    var addBtn = document.getElementById("add-player-btn");
    if (addInput) {
      addInput.disabled = !canEdit;
      addInput.placeholder = canEdit
        ? "Fantasy player name"
        : "Log in (top right) to edit";
    }
    if (addBtn) addBtn.disabled = !canEdit;

    // Spectator banner on Predict tab
    var existingBanner = document.getElementById("spectator-banner-predict");
    if (existingBanner) existingBanner.remove();
    if (hasCloudConfig() && !isEditor()) {
      var ban = document.createElement("div");
      ban.id = "spectator-banner-predict";
      ban.className = "spectator-banner";
      ban.textContent =
        "Viewing live shared data. Tap Log in (top right) only if you are the race editor.";
      listEl.parentNode.insertBefore(ban, listEl);
    }

    if (state.players.length === 0) {
      emptyEl.style.display = "block";
      updateSaveIndicator();
      return;
    }
    emptyEl.style.display = "none";

    state.players.forEach(function (player) {
      var card = document.createElement("div");
      card.className = "player-card" + (player.open ? " open" : "");

      var predRanks = computeRanksForPredictions(player.draftPredictions);

      var header = document.createElement("div");
      header.className = "player-header";
      var unsavedDot = hasUnsavedDraft(player)
        ? '<span class="unsaved-dot" title="Unsaved changes"></span>'
        : "";
      header.innerHTML =
        '<div class="title">' +
        escapeHtml(player.name) +
        unsavedDot +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:4px;">' +
        '<button class="icon-btn delete-player-btn" title="Delete player">\u{1F5D1}</button>' +
        '<span class="chevron">\u25B6</span>' +
        "</div>";
      header.addEventListener("click", function (e) {
        if (e.target.closest(".delete-player-btn")) return;
        player.open = !player.open;
        renderPlayers();
      });
      header
        .querySelector(".delete-player-btn")
        .addEventListener("click", function () {
          if (!canEditData()) {
            showToast("Log in (top right) to edit");
            return;
          }
          if (
            confirm(
              'Remove fantasy player "' +
                player.name +
                '"? This cannot be undone.',
            )
          ) {
            state.players = state.players.filter(function (p) {
              return p.id !== player.id;
            });
            persistNow();
            renderPlayers();
          }
        });

      var body = document.createElement("div");
      body.className = "player-body";
      body.appendChild(buildPlayerForm(player, predRanks));

      card.appendChild(header);
      card.appendChild(body);
      listEl.appendChild(card);
    });

    updateSaveIndicator();
  }

  function buildPlayerForm(player, predRanks) {
    var wrap = document.createElement("div");

    ATHLETES.forEach(function (athlete, idx) {
      var pred = player.draftPredictions[athlete];
      var block = document.createElement("div");
      block.className =
        "athlete-block " + (idx % 2 === 0 ? "stripe-a" : "stripe-b");
      block.dataset.athlete = athlete;

      var total = getPredictionTotal(pred);
      var overallInfo = predRanks.overall[athlete];
      var rankLabel = overallInfo ? ordinal(overallInfo.best) : "--";

      block.innerHTML =
        '<div class="athlete-name-row">' +
        '<span class="name">' +
        escapeHtml(athlete) +
        "</span>" +
        '<span class="derived athlete-summary">' +
        formatSeconds(total) +
        " &nbsp;\u00B7&nbsp; " +
        rankLabel +
        "</span>" +
        "</div>";

      [
        { key: "swim", label: "Swim Time", disc: "swim" },
        { key: "bike", label: "Bike Time", disc: "bike" },
        { key: "run", label: "Run Time", disc: "run" },
        {
          key: "transition",
          label: "Total Transition (T1+T2)",
          disc: "transition",
        },
      ].forEach(function (field) {
        var fg = document.createElement("div");
        fg.className = "field-group";
        var rankHint = "";
        if (field.disc) {
          var info = predRanks[field.disc][athlete];
          rankHint = info
            ? ' <span class="rank-badge">' + ordinal(info.best) + "</span>"
            : "";
        }
        fg.innerHTML = "<label>" + field.label + rankHint + "</label>";
        fg.appendChild(
          buildTimeInput(pred[field.key], function (newVal) {
            pred[field.key] = newVal;
            refreshPredictionCardState(player, wrap);
          }),
        );
        block.appendChild(fg);
      });

      wrap.appendChild(block);
    });

    // wildcards
    var wcWrap = document.createElement("div");
    wcWrap.className = "athlete-block";
    wcWrap.innerHTML =
      '<div class="section-title" style="margin-top:0;">Wildcards</div>';

    var t1Group = document.createElement("div");
    t1Group.className = "field-group";
    t1Group.innerHTML = "<label>3rd fastest T1 time</label>";
    t1Group.appendChild(
      buildAthleteSelect(player.draftWildcards.t1, function (val) {
        player.draftWildcards.t1 = val;
        refreshPredictionCardState(player, wrap);
      }),
    );
    wcWrap.appendChild(t1Group);

    var t2Group = document.createElement("div");
    t2Group.className = "field-group";
    t2Group.innerHTML = "<label>3rd fastest T2 time</label>";
    t2Group.appendChild(
      buildAthleteSelect(player.draftWildcards.t2, function (val) {
        player.draftWildcards.t2 = val;
        refreshPredictionCardState(player, wrap);
      }),
    );
    wcWrap.appendChild(t2Group);

    wrap.appendChild(wcWrap);

    // Save Prediction button
    var saveRow = document.createElement("div");
    saveRow.className = "save-prediction-row";
    var dirty = hasUnsavedDraft(player);
    var saveBtn = document.createElement("button");
    saveBtn.className =
      "btn-primary save-prediction-btn" + (dirty ? "" : " is-saved");
    saveBtn.textContent = dirty ? "Save Prediction" : "Prediction Saved \u2713";
    saveBtn.addEventListener("click", function () {
      if (!canEditData()) {
        showToast("Log in (top right) to edit");
        return;
      }
      player.predictions = deepCopy(player.draftPredictions);
      player.wildcards = deepCopy(player.draftWildcards);
      player.hasSavedPrediction = true;
      persistNow();
      renderPlayers();
    });
    saveRow.appendChild(saveBtn);
    if (dirty) {
      var hint = document.createElement("div");
      hint.className = "save-prediction-hint";
      hint.textContent = "You have unsaved changes for " + player.name + ".";
      saveRow.appendChild(hint);
    }
    wrap.appendChild(saveRow);

    refreshPredictionCardState(player, wrap);
    return wrap;
  }

  // Time input: ONE text field, entered like a stopwatch/calculator -- the user
  // just types digits (numeric keypad pops up on mobile) and they fill in from
  // the right: "1234" -> 12:34, "13045" -> 1:30:45, "12345" -> 1:23:45.
  // Backspace removes the last digit. Typing after focus/select replaces the
  // value so previously saved times can be edited easily.
  // Committed to the DRAFT on blur/Enter/change (no localStorage write here).
  function buildTimeInput(seconds, onChange) {
    var row = document.createElement("div");
    row.className = "time-entry-row";

    var inp = document.createElement("input");
    inp.type = "text";
    inp.inputMode = "numeric";
    inp.pattern = "[0-9]*";
    inp.className = "time-entry-input";
    inp.placeholder = "0:00";
    inp.autocomplete = "off";

    // raw digit buffer, e.g. "12345" (most-recent digit typed is at the end)
    var digits = secondsToDigitString(seconds);
    // After focus (or full selection), the next digit replaces instead of appends
    var replaceNext = false;

    function render() {
      inp.value = digitStringToDisplay(digits);
    }
    render();

    function wholeFieldSelected() {
      try {
        return (
          inp.selectionStart === 0 &&
          inp.selectionEnd === (inp.value ? inp.value.length : 0)
        );
      } catch (e) {
        return false;
      }
    }

    function commit() {
      if (!canEditData()) return;
      replaceNext = false;
      if (digits === "") {
        onChange(null);
        return;
      }
      onChange(digitStringToSeconds(digits));
    }

    inp.addEventListener("keydown", function (e) {
      // Let navigation/selection keys pass through untouched.
      if (
        e.key === "Tab" ||
        e.key === "Enter" ||
        e.key.indexOf("Arrow") === 0 ||
        e.metaKey ||
        e.ctrlKey
      ) {
        if (e.key === "Enter") {
          inp.blur();
        }
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        if (replaceNext || wholeFieldSelected()) {
          digits = "";
          replaceNext = false;
        } else {
          digits = digits.slice(0, -1);
        }
        render();
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (replaceNext || wholeFieldSelected() || digits.length === 0) {
          digits = e.key;
          replaceNext = false;
        } else if (digits.length < 6) {
          digits += e.key;
        }
        // If already 6 digits and not replacing, ignore extra keystrokes
        render();
        return;
      }
      // block any other character (letters, symbols, etc.)
      e.preventDefault();
    });

    // Handles paste, or mobile keyboards that don't fire clean keydown events.
    inp.addEventListener("input", function () {
      var onlyDigits = inp.value.replace(/[^0-9]/g, "").slice(-6);
      // If user selected all and typed, the browser may leave a short digit string
      digits = onlyDigits;
      replaceNext = false;
      render();
    });

    inp.addEventListener("blur", commit);
    inp.addEventListener("change", commit);
    inp.addEventListener("focus", function () {
      if (!canEditData()) {
        inp.blur();
        return;
      }
      replaceNext = true;
      // Select all so the next keystroke replaces the previous time
      try {
        inp.select();
      } catch (e) {}
    });

    if (!canEditData()) {
      inp.readOnly = true;
      inp.classList.add("is-readonly");
      inp.title = "Log in (top right) to change times";
    }

    row.appendChild(inp);
    return row;
  }

  // "12345" -> interpreted right-to-left as SS, then MM, then HH: "1:23:45"
  function digitStringToDisplay(digits) {
    if (digits === "") return "";
    var padded = digits.padStart(6, "0");
    var h = padded.slice(0, 2),
      m = padded.slice(2, 4),
      s = padded.slice(4, 6);
    var hNum = parseInt(h, 10);
    if (hNum > 0) {
      return hNum + ":" + m + ":" + s;
    }
    var mNum = parseInt(m, 10);
    return mNum + ":" + s;
  }
  function digitStringToSeconds(digits) {
    if (digits === "") return null;
    var padded = digits.padStart(6, "0");
    var h = parseInt(padded.slice(0, 2), 10);
    var m = parseInt(padded.slice(2, 4), 10);
    var s = parseInt(padded.slice(4, 6), 10);
    return partsToSeconds(h, m, s);
  }
  function secondsToDigitString(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return "";
    var p = secondsToParts(seconds);
    return pad(p.h) + pad(p.m) + pad(p.s);
  }

  function buildAthleteSelect(selected, onChange) {
    var sel = document.createElement("select");
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "\u2014 Select athlete \u2014";
    sel.appendChild(noneOpt);
    ATHLETES.forEach(function (a) {
      var opt = document.createElement("option");
      opt.value = a;
      opt.textContent = a;
      if (selected === a) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
      if (!canEditData()) return;
      onChange(sel.value || null);
    });
    if (!canEditData()) {
      sel.disabled = true;
      sel.title = "Log in (top right) to change";
    }
    return sel;
  }

  document
    .getElementById("add-player-btn")
    .addEventListener("click", function () {
      if (!canEditData()) {
        showToast("Log in (top right) to edit");
        return;
      }
      var input = document.getElementById("new-player-name");
      var name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      var player = {
        id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        name: name,
        open: true,
        predictions: emptyPredictions(),
        wildcards: { t1: null, t2: null },
        hasSavedPrediction: false,
      };
      player.draftPredictions = deepCopy(player.predictions);
      player.draftWildcards = deepCopy(player.wildcards);
      state.players.forEach(function (p) {
        p.open = false;
      });
      state.players.push(player);
      input.value = "";
      persistNow();
      renderPlayers();
    });
  document
    .getElementById("new-player-name")
    .addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        document.getElementById("add-player-btn").click();
      }
    });

  /* ===================== RENDER: RESULTS (has its own Save button) ===================== */
  function refreshResultsCardState(athlete, block) {
    var r = state.results[athlete];
    var actualRanks = computeActualRanks();
    var total = getResultTotal(r);
    var overallInfo = actualRanks.overall[athlete];
    var rankLabel = overallInfo ? ordinal(overallInfo.best) : "--";
    var summaryEl = block.querySelector(".athlete-summary");
    if (summaryEl) {
      summaryEl.innerHTML =
        formatSeconds(total) + " &nbsp;·&nbsp; " + rankLabel;
    }
  }

  function refreshResultsSummary() {
    var summaryEl = document.getElementById("results-summary");
    var summaryCard = document.getElementById("results-summary-card");
    var actualRanks = computeActualRanks();
    if (hasAnyResults()) {
      summaryCard.style.display = "block";
      var t1AtRank3 = athletesAtRank(actualRanks.t1, 3);
      var t2AtRank3 = actualRanks.t2 ? athletesAtRank(actualRanks.t2, 3) : [];
      summaryEl.innerHTML =
        '<div class="field-group"><label>3rd fastest T1</label><div style="font-family:var(--font-mono);">' +
        (t1AtRank3.length ? t1AtRank3.map(escapeHtml).join(" / ") : "--") +
        "</div></div>" +
        '<div class="field-group"><label>3rd fastest T2</label><div style="font-family:var(--font-mono);">' +
        (t2AtRank3.length ? t2AtRank3.map(escapeHtml).join(" / ") : "--") +
        "</div></div>";
    } else {
      summaryCard.style.display = "none";
    }
  }

  // Ranked official finish lists (mirrors View Predictions order cards)
  function renderResultsOrders() {
    var host = document.getElementById("results-orders-wrap");
    if (!host) return;
    host.innerHTML = "";
    if (!hasAnyResults()) return;

    var card = document.createElement("div");
    card.className = "player-card" + (state._resultsOrdersOpen ? " open" : "");

    var header = document.createElement("div");
    header.className = "player-header";
    header.innerHTML =
      '<div class="title">Official Finishing Order</div>' +
      '<span class="chevron">\u25B6</span>';
    header.addEventListener("click", function () {
      state._resultsOrdersOpen = !state._resultsOrdersOpen;
      renderResultsOrders();
    });

    var body = document.createElement("div");
    body.className = "player-body";

    [
      { disc: "swim", title: "Swim Order" },
      { disc: "bike", title: "Bike Order" },
      { disc: "run", title: "Run Order" },
      { disc: "transition", title: "Transition Order (T1+T2)" },
      { disc: "overall", title: "Overall Order" },
    ].forEach(function (section) {
      var eventBlock = document.createElement("div");
      eventBlock.className = "order-event-block";
      var titleEl = document.createElement("div");
      titleEl.className = "oe-title";
      titleEl.textContent = section.title;
      eventBlock.appendChild(titleEl);

      var ol = document.createElement("ol");
      ol.className = "order-list";
      orderedAthletesForResults(section.disc).forEach(function (item) {
        var li = document.createElement("li");
        li.innerHTML =
          '<span class="pos">' +
          item.rankLabel +
          "</span><span>" +
          escapeHtml(item.athlete) +
          '</span><span class="time">' +
          formatSeconds(item.time) +
          "</span>";
        ol.appendChild(li);
      });
      eventBlock.appendChild(ol);
      body.appendChild(eventBlock);
    });

    card.appendChild(header);
    card.appendChild(body);
    host.appendChild(card);
  }

  function orderedAthletesForResults(disc) {
    var ranks = computeActualRanks();
    var rankMap =
      disc === "transition"
        ? computeRanksWithTies(
            ATHLETES.map(function (a) {
              return { key: a, time: getResultTransition(state.results[a]) };
            }),
          )
        : ranks[disc] || {};

    var items = ATHLETES.map(function (a) {
      var t = null;
      if (disc === "overall") t = getResultTotal(state.results[a]);
      else if (disc === "transition") t = getResultTransition(state.results[a]);
      else t = state.results[a] ? state.results[a][disc] : null;
      return { athlete: a, time: t, info: rankMap[a] };
    });
    items.sort(function (a, b) {
      var at = a.time === null || a.time === undefined ? Infinity : a.time;
      var bt = b.time === null || b.time === undefined ? Infinity : b.time;
      return at - bt;
    });
    return items.map(function (it) {
      var rankLabel = "--";
      if (it.info) {
        rankLabel =
          it.info.start === it.info.end
            ? String(it.info.start)
            : it.info.start + "-" + it.info.end;
      }
      return { athlete: it.athlete, time: it.time, rankLabel: rankLabel };
    });
  }

  function renderResults() {
    var wrap = document.getElementById("results-athletes");
    wrap.innerHTML = "";
    var actualRanks = computeActualRanks();

    ATHLETES.forEach(function (athlete) {
      if (!state.results[athlete]) {
        state.results[athlete] = {
          swim: null,
          t1: null,
          bike: null,
          t2: null,
          run: null,
        };
      }
      var r = state.results[athlete];
      var block = document.createElement("div");
      block.className = "athlete-block";
      block.dataset.athlete = athlete;

      var total = getResultTotal(r);
      var overallInfo = actualRanks.overall[athlete];
      var rankLabel = overallInfo ? ordinal(overallInfo.best) : "--";

      block.innerHTML =
        '<div class="athlete-name-row">' +
        '<span class="name">' +
        escapeHtml(athlete) +
        "</span>" +
        '<span class="derived athlete-summary">' +
        formatSeconds(total) +
        " &nbsp;\u00B7&nbsp; " +
        rankLabel +
        "</span>" +
        "</div>";

      [
        { key: "swim", label: "Swim Time", disc: "swim" },
        { key: "t1", label: "T1 Time", disc: "t1" },
        { key: "bike", label: "Bike Time", disc: "bike" },
        { key: "t2", label: "T2 Time", disc: "t2" },
        { key: "run", label: "Run Time", disc: "run" },
      ].forEach(function (field) {
        var fg = document.createElement("div");
        fg.className = "field-group";
        var info = actualRanks[field.disc]
          ? actualRanks[field.disc][athlete]
          : null;
        var rankHint =
          (field.disc === "swim" ||
            field.disc === "bike" ||
            field.disc === "run") &&
          info
            ? ' <span class="rank-badge">' + ordinal(info.best) + "</span>"
            : "";
        fg.innerHTML = "<label>" + field.label + rankHint + "</label>";
        fg.appendChild(
          buildTimeInput(r[field.key], function (newVal) {
            r[field.key] = newVal;
            refreshResultsCardState(athlete, block);
            refreshResultsSummary();
            renderResultsOrders();
            renderLeaderboard();
            updateResultsSaveButton();
            updateSaveIndicator();
          }),
        );
        block.appendChild(fg);
      });

      wrap.appendChild(block);
    });

    refreshResultsSummary();
    renderResultsOrders();
    updateResultsSaveButton();
  }

  document
    .getElementById("save-results-btn")
    .addEventListener("click", function () {
      if (!canEditData()) {
        showToast("Log in (top right) to edit");
        return;
      }
      persistNow();
      updateResultsSaveButton();
    });

  /* ===================== RENDER: VIEW PREDICTIONS TAB ===================== */
  function renderViewPredictions() {
    var listEl = document.getElementById("view-predictions-list");
    var emptyEl = document.getElementById("view-predictions-empty");
    listEl.innerHTML = "";

    var saved = playersWithSavedPredictions();

    if (saved.length === 0) {
      emptyEl.style.display = "block";
    } else {
      emptyEl.style.display = "none";
      saved.forEach(function (player) {
        listEl.appendChild(buildPredictionOrderCard(player));
      });
    }

    renderPredictionStats();
  }

  function buildPredictionOrderCard(player) {
    var card = document.createElement("div");
    card.className = "player-card" + (player._viewOpen ? " open" : "");

    var header = document.createElement("div");
    header.className = "player-header";
    header.innerHTML =
      '<div class="title">' +
      escapeHtml(player.name) +
      "</div>" +
      '<span class="chevron">\u25B6</span>';
    header.addEventListener("click", function () {
      player._viewOpen = !player._viewOpen;
      renderViewPredictions();
    });

    var body = document.createElement("div");
    body.className = "player-body";

    [
      { disc: "swim", title: "Predicted Swim Order" },
      { disc: "bike", title: "Predicted Bike Order" },
      { disc: "run", title: "Predicted Run Order" },
      { disc: "transition", title: "Predicted Transition Order" },
      { disc: "overall", title: "Predicted Overall Order" },
    ].forEach(function (section) {
      var eventBlock = document.createElement("div");
      eventBlock.className = "order-event-block";
      var titleEl = document.createElement("div");
      titleEl.className = "oe-title";
      titleEl.textContent = section.title;
      eventBlock.appendChild(titleEl);

      var ol = document.createElement("ol");
      ol.className = "order-list";
      var order = orderedAthletesForDisc(player.predictions, section.disc);
      order.forEach(function (item) {
        var li = document.createElement("li");
        li.innerHTML =
          '<span class="pos">' +
          item.rankLabel +
          "</span>" +
          "<span>" +
          escapeHtml(item.athlete) +
          "</span>" +
          '<span class="time">' +
          formatSeconds(item.time) +
          "</span>";
        ol.appendChild(li);
      });
      eventBlock.appendChild(ol);
      body.appendChild(eventBlock);
    });

    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  // Returns athletes ordered by predicted finish for a discipline, with rank labels (handles ties with shared labels)
  function orderedAthletesForDisc(predictions, disc) {
    var ranks = computeRanksForPredictions(predictions)[disc];
    var items = ATHLETES.map(function (a) {
      var t =
        disc === "overall"
          ? getPredictionTotal(predictions[a])
          : predictions[a]
            ? predictions[a][disc]
            : null;
      return { athlete: a, time: t, info: ranks[a] };
    });
    items.sort(function (a, b) {
      var at = a.time === null ? Infinity : a.time;
      var bt = b.time === null ? Infinity : b.time;
      return at - bt;
    });
    return items.map(function (it) {
      var rankLabel = "--";
      if (it.info) {
        rankLabel =
          it.info.start === it.info.end
            ? String(it.info.start)
            : it.info.start + "-" + it.info.end;
      }
      return { athlete: it.athlete, time: it.time, rankLabel: rankLabel };
    });
  }

  function renderPredictionStats() {
    var wrap = document.getElementById("prediction-stats-wrap");
    wrap.innerHTML = "";

    var saved = playersWithSavedPredictions();
    if (saved.length === 0) return;

    var titleEl = document.createElement("div");
    titleEl.className = "section-title";
    titleEl.textContent =
      "Prediction Statistics (" +
      saved.length +
      " player" +
      (saved.length === 1 ? "" : "s") +
      ")";
    wrap.appendChild(titleEl);

    var card = document.createElement("div");
    card.className = "stats-card";

    // Alphabetical athlete order for stats (roster constant order is race/entry order)
    var athletesAlpha = ATHLETES.slice().sort(function (a, b) {
      return a.localeCompare(b);
    });

    athletesAlpha.forEach(function (athlete) {
      var block = document.createElement("div");
      block.className = "stats-athlete-block";
      var nameEl = document.createElement("div");
      nameEl.className = "sa-name";
      nameEl.textContent = athlete;
      block.appendChild(nameEl);

      block.appendChild(statHeaderRow());

      ["swim", "bike", "run", "transition", "overall"].forEach(function (disc) {
        var avgTime = averagePredictedTime(saved, athlete, disc);
        var avgRank = averagePredictedRank(saved, athlete, disc);
        block.appendChild(
          statRow(
            labelFor(disc),
            avgRank === null ? "--" : avgRank.toFixed(2),
            avgTime === null ? "--" : formatSeconds(avgTime),
            formatSpeed(disc, avgTime),
          ),
        );
      });

      card.appendChild(block);
    });

    wrap.appendChild(card);
  }

  function averagePredictedTime(saved, athlete, disc) {
    var vals = saved
      .map(function (p) {
        if (disc === "overall") {
          return getPredictionTotal(p.predictions[athlete]);
        }
        return p.predictions[athlete] ? p.predictions[athlete][disc] : null;
      })
      .filter(function (v) {
        return v !== null && v !== undefined && !isNaN(v);
      });
    if (!vals.length) return null;
    return (
      vals.reduce(function (s, v) {
        return s + v;
      }, 0) / vals.length
    );
  }

  function averagePredictedRank(saved, athlete, disc) {
    var ranks = saved
      .map(function (p) {
        var rr = computeRanksForPredictions(p.predictions)[disc];
        if (!rr || !rr[athlete]) return null;
        return rr[athlete].best;
      })
      .filter(function (v) {
        return v !== null && v !== undefined && !isNaN(v);
      });
    if (!ranks.length) return null;
    return (
      ranks.reduce(function (s, v) {
        return s + v;
      }, 0) / ranks.length
    );
  }

  function labelFor(disc) {
    if (disc === "swim") return "Swim";
    if (disc === "bike") return "Bike";
    if (disc === "run") return "Run";
    if (disc === "transition") return "Transition";
    if (disc === "overall") return "Overall";
    return disc;
  }

  // Swim: min/100y · Bike: mph · Run: min/mile (transition/overall: --)
  function formatSpeed(disc, totalSeconds) {
    if (
      totalSeconds === null ||
      totalSeconds === undefined ||
      isNaN(totalSeconds) ||
      totalSeconds <= 0
    ) {
      return "--";
    }
    if (disc === "swim") {
      var secPer100 = totalSeconds / (SWIM_YARDS / 100);
      return formatPace(secPer100) + " / 100y";
    }
    if (disc === "bike") {
      var mph = BIKE_MILES / (totalSeconds / 3600);
      return mph.toFixed(2) + "mph";
    }
    if (disc === "run") {
      var secPerMile = totalSeconds / RUN_MILES;
      return formatPace(secPerMile) + " / mile";
    }
    return "--";
  }

  // Seconds → "m:ss" (e.g. 115 → "1:55")
  function formatPace(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return m + ":" + pad(s);
  }

  function statHeaderRow() {
    var row = document.createElement("div");
    row.className = "stat-row stat-row-header";
    row.innerHTML =
      '<span class="stat-label"></span>' +
      '<span class="stat-rank">Rank</span>' +
      '<span class="stat-time">Time</span>' +
      '<span class="stat-speed">Speed</span>';
    return row;
  }

  // Columns: description | avg rank | time | speed
  function statRow(label, rankValue, timeValue, speedValue) {
    var row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML =
      '<span class="stat-label">' +
      escapeHtml(label) +
      '</span><span class="stat-rank">' +
      escapeHtml(rankValue) +
      '</span><span class="stat-time">' +
      escapeHtml(timeValue) +
      '</span><span class="stat-speed">' +
      escapeHtml(speedValue == null ? "--" : speedValue) +
      "</span>";
    return row;
  }

  /* ===================== RENDER: LEADERBOARD ===================== */
  function renderLeaderboard() {
    var listEl = document.getElementById("leaderboard-list");
    var emptyEl = document.getElementById("leaderboard-empty");
    listEl.innerHTML = "";

    if (state.players.length === 0) {
      emptyEl.style.display = "block";
    } else {
      emptyEl.style.display = "none";

      var scored = state.players.map(function (p) {
        return { player: p, score: scorePlayer(p) };
      });
      scored.sort(function (a, b) {
        return b.score.total - a.score.total;
      });

      scored.forEach(function (entry, idx) {
        var open = !!entry.player._lbOpen;
        var row = document.createElement("div");
        row.className = "lb-row" + (open ? " open" : "");

        var cat = entry.score.categories;
        var top = document.createElement("div");
        top.className = "lb-row-top";
        top.innerHTML =
          '<div class="lb-rank">' +
          (idx + 1) +
          "</div>" +
          '<div class="lb-main"><div class="lb-name">' +
          escapeHtml(entry.player.name) +
          '</div><div class="lb-sub">' +
          "Rank: " +
          cat.rank.total +
          " / " +
          cat.rank.max +
          " · Time: " +
          cat.time.total +
          " / " +
          cat.time.max +
          " · WC: " +
          cat.wildcards.total +
          " / " +
          cat.wildcards.max +
          '</div></div><div class="lb-points">' +
          entry.score.total +
          '<span class="lbl">pts</span></div>' +
          '<span class="chevron lb-chevron">\u25B6</span>';

        var detail = document.createElement("div");
        detail.className = "breakdown";
        detail.style.display = open ? "block" : "none";
        detail.appendChild(buildBreakdown(entry.player, entry.score));

        row.appendChild(top);
        row.appendChild(detail);

        top.addEventListener("click", function () {
          entry.player._lbOpen = !entry.player._lbOpen;
          renderLeaderboard();
        });

        listEl.appendChild(row);
      });
    }

    renderAthleteVsAverage();
  }

  // Category breakdown: ranking → time accuracy → wildcards (not by athlete)
  function buildBreakdown(player, score) {
    var wrap = document.createElement("div");
    var cat = score.categories;

    wrap.appendChild(
      breakdownCategory("Ranking", cat.rank.total, cat.rank.max, [
        {
          label: "Swim rank",
          pts: cat.rank.byDisc.swim.pts,
          max: cat.rank.byDisc.swim.max,
        },
        {
          label: "Bike rank",
          pts: cat.rank.byDisc.bike.pts,
          max: cat.rank.byDisc.bike.max,
        },
        {
          label: "Run rank",
          pts: cat.rank.byDisc.run.pts,
          max: cat.rank.byDisc.run.max,
        },
      ]),
    );

    wrap.appendChild(
      breakdownCategory("Time accuracy", cat.time.total, cat.time.max, [
        {
          label: "Swim",
          pts: cat.time.byDisc.swim.pts,
          max: cat.time.byDisc.swim.max,
        },
        {
          label: "Bike",
          pts: cat.time.byDisc.bike.pts,
          max: cat.time.byDisc.bike.max,
        },
        {
          label: "Run",
          pts: cat.time.byDisc.run.pts,
          max: cat.time.byDisc.run.max,
        },
        {
          label: "Transition (T1+T2)",
          pts: cat.time.byDisc.transition.pts,
          max: cat.time.byDisc.transition.max,
        },
      ]),
    );

    wrap.appendChild(
      breakdownCategory("Wildcards", cat.wildcards.total, cat.wildcards.max, [
        {
          label: "3rd-fastest T1",
          pts: cat.wildcards.t1.pts,
          max: cat.wildcards.t1.max,
        },
        {
          label: "3rd-fastest T2",
          pts: cat.wildcards.t2.pts,
          max: cat.wildcards.t2.max,
        },
      ]),
    );

    var detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "btn-secondary btn-block bd-detail-btn";
    detailBtn.textContent = "Full comparison vs actual results";
    detailBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openPlayerCompare(player.id);
    });
    wrap.appendChild(detailBtn);

    return wrap;
  }

  function breakdownCategory(title, totalPts, maxPts, lines) {
    var block = document.createElement("div");
    block.className = "bd-category";

    var head = document.createElement("div");
    head.className = "bd-category-head";
    head.innerHTML =
      '<span class="bd-category-title">' +
      escapeHtml(title) +
      '</span><span class="bd-category-total">' +
      totalPts +
      ' <span class="bd-max">/ ' +
      maxPts +
      " max</span></span>";
    block.appendChild(head);

    var table = document.createElement("div");
    table.className = "bd-lines";
    lines.forEach(function (line) {
      var row = document.createElement("div");
      row.className = "bd-line";
      var pillClass = "pts-pill";
      if (line.max === 0) pillClass += " pts-pill-zero";
      else if (line.pts <= 0) pillClass += " pts-pill-zero";
      else if (line.pts >= line.max) pillClass += " pts-pill-high";
      else pillClass += " pts-pill-mid";
      row.innerHTML =
        '<span class="bd-line-label">' +
        escapeHtml(line.label) +
        '</span><span class="' +
        pillClass +
        '">' +
        line.pts +
        "/" +
        line.max +
        "</span>";
      table.appendChild(row);
    });
    block.appendChild(table);
    return block;
  }

  function openPlayerCompare(playerId) {
    comparePlayerId = playerId;
    switchView("compare");
  }

  function renderPlayerCompare() {
    var host = document.getElementById("compare-detail");
    if (!host) return;
    host.innerHTML = "";

    var player = state.players.filter(function (p) {
      return p.id === comparePlayerId;
    })[0];
    if (!player) {
      host.innerHTML =
        '<div class="empty-state"><div>Player not found.</div></div>';
      return;
    }

    var score = scorePlayer(player);
    var cat = score.categories;

    var summary = document.createElement("div");
    summary.className = "compare-summary card";
    summary.innerHTML =
      '<div class="compare-player-name">' +
      escapeHtml(player.name) +
      "</div>" +
      '<div class="compare-total">' +
      score.total +
      ' <span class="bd-max">/ ' +
      score.max +
      " max pts</span></div>" +
      '<div class="compare-cat-row">' +
      '<div class="compare-cat"><span class="compare-cat-lbl">Ranking</span><span class="compare-cat-val">' +
      cat.rank.total +
      "/" +
      cat.rank.max +
      "</span></div>" +
      '<div class="compare-cat"><span class="compare-cat-lbl">Time</span><span class="compare-cat-val">' +
      cat.time.total +
      "/" +
      cat.time.max +
      "</span></div>" +
      '<div class="compare-cat"><span class="compare-cat-lbl">Wildcards</span><span class="compare-cat-val">' +
      cat.wildcards.total +
      "/" +
      cat.wildcards.max +
      "</span></div></div>" +
      '<p class="helper-text" style="margin-top:10px;margin-bottom:0">Max is based on results entered so far (slots that can score).</p>';
    host.appendChild(summary);

    // Wildcards card
    var wcCard = document.createElement("div");
    wcCard.className = "compare-block";
    wcCard.innerHTML =
      '<div class="section-title" style="margin-top:0">Wildcards</div>';
    ["t1", "t2"].forEach(function (key) {
      var w = score.wildcards[key];
      var actualLabel = w.actual.length
        ? w.actual.map(escapeHtml).join(" / ")
        : "— (not determined yet)";
      var row = document.createElement("div");
      row.className = "compare-metric";
      row.innerHTML =
        '<div class="compare-metric-title">3rd-fastest ' +
        key.toUpperCase() +
        ' <span class="pts-pill ' +
        (w.pts > 0 ? "pts-pill-high" : "pts-pill-zero") +
        '">' +
        w.pts +
        "/" +
        w.max +
        "</span></div>" +
        '<div class="compare-metric-grid">' +
        '<div><span class="cm-k">Your pick</span><span class="cm-v">' +
        (w.pick ? escapeHtml(w.pick) : "—") +
        "</span></div>" +
        '<div><span class="cm-k">Actual 3rd</span><span class="cm-v">' +
        actualLabel +
        "</span></div></div>";
      wcCard.appendChild(row);
    });
    host.appendChild(wcCard);

    var athletesTitle = document.createElement("div");
    athletesTitle.className = "section-title";
    athletesTitle.textContent = "Per athlete";
    host.appendChild(athletesTitle);

    ATHLETES.forEach(function (athlete, idx) {
      var entry = score.perAthlete[athlete];
      var card = document.createElement("div");
      card.className =
        "compare-athlete-card" + (idx % 2 === 0 ? " stripe-a" : " stripe-b");

      var aHead = document.createElement("div");
      aHead.className = "compare-athlete-name";
      aHead.textContent = athlete;
      card.appendChild(aHead);

      ["swim", "bike", "run"].forEach(function (disc) {
        card.appendChild(
          buildRankCompareRow(labelFor(disc) + " rank", entry.ranks[disc]),
        );
        card.appendChild(
          buildTimeCompareRow(labelFor(disc) + " time", entry.times[disc]),
        );
      });
      card.appendChild(
        buildTimeCompareRow("Transition (T1+T2)", entry.times.transition),
      );

      host.appendChild(card);
    });
  }

  function buildRankCompareRow(title, d) {
    var row = document.createElement("div");
    row.className = "compare-metric";
    var offLabel = "--";
    if (d.offBy === 0) offLabel = "Exact";
    else if (d.offBy !== null && d.offBy !== undefined)
      offLabel = "Off by " + d.offBy;
    else if (d.max === 0) offLabel = "No result yet";

    var pillClass = "pts-pill";
    if (d.max === 0 || d.pts <= 0) pillClass += " pts-pill-zero";
    else if (d.pts >= d.max) pillClass += " pts-pill-high";
    else pillClass += " pts-pill-mid";

    row.innerHTML =
      '<div class="compare-metric-title">' +
      escapeHtml(title) +
      ' <span class="' +
      pillClass +
      '">' +
      d.pts +
      "/" +
      d.max +
      "</span></div>" +
      '<div class="compare-metric-grid">' +
      '<div><span class="cm-k">Predicted</span><span class="cm-v">' +
      (d.predicted != null ? ordinal(d.predicted) : "—") +
      "</span></div>" +
      '<div><span class="cm-k">Actual</span><span class="cm-v">' +
      (d.actualLabel || "—") +
      "</span></div>" +
      '<div><span class="cm-k">Error</span><span class="cm-v">' +
      offLabel +
      "</span></div></div>";
    return row;
  }

  function buildTimeCompareRow(title, d) {
    var row = document.createElement("div");
    row.className = "compare-metric";
    var errLabel =
      d.max === 0
        ? d.predicted == null && d.actual == null
          ? "No data"
          : d.actual == null
            ? "No result yet"
            : "No prediction"
        : formatSignedSeconds(d.diff);
    // Positive diff = prediction slower than actual
    if (d.diff !== null && d.diff !== 0 && d.max > 0) {
      errLabel =
        (d.diff < 0 ? "Faster by " : "Slower by ") +
        formatSeconds(Math.abs(d.diff));
    }

    var pillClass = "pts-pill";
    if (d.max === 0 || d.pts <= 0) pillClass += " pts-pill-zero";
    else if (d.pts >= d.max) pillClass += " pts-pill-high";
    else pillClass += " pts-pill-mid";

    row.innerHTML =
      '<div class="compare-metric-title">' +
      escapeHtml(title) +
      ' <span class="' +
      pillClass +
      '">' +
      d.pts +
      "/" +
      d.max +
      "</span></div>" +
      '<div class="compare-metric-grid">' +
      '<div><span class="cm-k">Predicted</span><span class="cm-v mono">' +
      formatSeconds(d.predicted) +
      "</span></div>" +
      '<div><span class="cm-k">Actual</span><span class="cm-v mono">' +
      formatSeconds(d.actual) +
      "</span></div>" +
      '<div><span class="cm-k">Error</span><span class="cm-v">' +
      errLabel +
      "</span></div></div>";
    return row;
  }

  // Shows, per athlete: their actual event times/ranks vs. the average of what
  // predictors guessed for them, so you can see who over/under-performed expectations.
  function renderAthleteVsAverage() {
    var wrap = document.getElementById("athlete-vs-average-wrap");
    wrap.innerHTML = "";

    var saved = playersWithSavedPredictions();
    if (saved.length === 0 || !hasAnyResults()) return;

    var titleEl = document.createElement("div");
    titleEl.className = "section-title";
    titleEl.textContent = "Athletes vs. Predictor Averages";
    wrap.appendChild(titleEl);

    var actualRanks = computeActualRanks();

    ATHLETES.forEach(function (athlete) {
      var card = document.createElement("div");
      card.className = "avg-compare-card";
      var nameEl = document.createElement("div");
      nameEl.className = "sa-name";
      nameEl.textContent = athlete;
      card.appendChild(nameEl);

      var res = state.results[athlete];

      ["swim", "bike", "run"].forEach(function (disc) {
        var actualTime = res ? res[disc] : null;
        var predVals = saved
          .map(function (p) {
            return p.predictions[athlete][disc];
          })
          .filter(function (v) {
            return v !== null;
          });
        var avgTime = predVals.length
          ? predVals.reduce(function (s, v) {
              return s + v;
            }, 0) / predVals.length
          : null;

        var actualRankInfo = actualRanks[disc][athlete];
        var actualRankLabel = actualRankInfo
          ? actualRankInfo.start === actualRankInfo.end
            ? ordinal(actualRankInfo.start)
            : ordinal(actualRankInfo.start) + "-" + ordinal(actualRankInfo.end)
          : "--";
        var predRanks = saved
          .map(function (p) {
            var rr = computeRanksForPredictions(p.predictions)[disc][athlete];
            return rr ? rr.best : null;
          })
          .filter(function (v) {
            return v !== null;
          });
        var avgRank = predRanks.length
          ? predRanks.reduce(function (s, v) {
              return s + v;
            }, 0) / predRanks.length
          : null;

        var row = document.createElement("div");
        row.className = "avg-row";
        var diffClass = "";
        var diffLabel = "";
        if (actualTime !== null && avgTime !== null) {
          var diff = actualTime - avgTime;
          diffClass = diff <= 0 ? "avg-diff-faster" : "avg-diff-slower";
          diffLabel =
            (diff <= 0 ? "\u2212" : "+") + formatSeconds(Math.abs(diff));
        }
        row.innerHTML =
          '<span class="avg-label">' +
          labelFor(disc) +
          "</span>" +
          '<span class="avg-values">' +
          '<span class="avg-actual">' +
          formatSeconds(actualTime) +
          "</span>" +
          '<span class="avg-predicted">vs avg ' +
          (avgTime === null ? "--" : formatSeconds(avgTime)) +
          "</span>" +
          (diffClass
            ? '<br><span class="' + diffClass + '">' + diffLabel + "</span>"
            : "") +
          "</span>";
        card.appendChild(row);

        var rankRow = document.createElement("div");
        rankRow.className = "avg-row";
        rankRow.innerHTML =
          '<span class="avg-label">' +
          labelFor(disc) +
          " rank</span>" +
          '<span class="avg-values">' +
          '<span class="avg-actual">' +
          actualRankLabel +
          "</span>" +
          '<span class="avg-predicted">vs avg guess ' +
          (avgRank === null ? "--" : avgRank.toFixed(1)) +
          "</span>" +
          "</span>";
        card.appendChild(rankRow);
      });

      wrap.appendChild(card);
    });
  }

  /* ===================== EXPORT / IMPORT / CLEAR ===================== */
  function downloadBackup() {
    try {
      var payload = {
        app: "FantasyTriathlon",
        version: 2,
        exportedAt: new Date().toISOString(),
        athletes: ATHLETES.slice(),
        state: state,
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      var d = new Date();
      var dateStr =
        d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      a.href = url;
      a.download = "fantasy-triathlon-backup-" + dateStr + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Backup exported");
    } catch (e) {
      console.error("Export failed", e);
      showToast("Export failed");
    }
  }

  function isValidBackupState(obj) {
    if (!obj || typeof obj !== "object") return false;
    // Accept either wrapped export { state: {...} } or raw state { players, results }
    var s = obj.state && typeof obj.state === "object" ? obj.state : obj;
    if (!Array.isArray(s.players)) return false;
    if (!s.results || typeof s.results !== "object") return false;
    return true;
  }

  function importBackupFromFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!isValidBackupState(parsed)) {
          showToast("Invalid backup file");
          return;
        }
        var incoming =
          parsed.state && typeof parsed.state === "object"
            ? parsed.state
            : parsed;
        state = normalizeState(deepCopy(incoming));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        captureResultsSnapshot();
        renderPlayers();
        renderResults();
        renderViewPredictions();
        renderLeaderboard();
        updateResultsSaveButton();
        updateSaveIndicator();
        if (isEditor()) scheduleCloudPublish(false);
        showToast("Backup imported");
      } catch (e) {
        console.error("Import failed", e);
        showToast("Import failed");
      }
    };
    reader.onerror = function () {
      showToast("Import failed");
    };
    reader.readAsText(file);
  }

  document
    .getElementById("export-data-btn")
    .addEventListener("click", function () {
      downloadBackup();
    });

  document
    .getElementById("import-data-btn")
    .addEventListener("click", function () {
      if (!canEditData()) {
        showToast("Log in (top right) to import");
        return;
      }
      if (
        !confirm(
          "Import will replace ALL current players, predictions, and results on this device with the backup file. Continue?",
        )
      ) {
        return;
      }
      document.getElementById("import-file-input").click();
    });

  document
    .getElementById("import-file-input")
    .addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      importBackupFromFile(file);
    });

  document
    .getElementById("clear-data-btn")
    .addEventListener("click", function () {
      if (!canEditData()) {
        showToast("Log in (top right) to clear data");
        return;
      }
      if (
        confirm(
          "This will permanently delete ALL fantasy players, predictions, and results. This cannot be undone. Continue?",
        )
      ) {
        if (confirm("Are you absolutely sure? All data will be lost.")) {
          localStorage.removeItem(STORAGE_KEY);
          state = defaultState();
          captureResultsSnapshot();
          renderPlayers();
          renderResults();
          renderViewPredictions();
          renderLeaderboard();
          updateResultsSaveButton();
          updateSaveIndicator();
          // Publish empty state so spectators clear too
          pushCloudState({ silent: true });
          showToast("All data cleared");
        }
      }
    });

  /* ===================== UTIL ===================== */
  function ordinal(n) {
    if (n === null || n === undefined) return "--";
    var s = ["th", "st", "nd", "rd"],
      v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ===================== INIT ===================== */
  wireCloudUI();
  // Lock edits immediately if cloud is configured (spectator until login)
  if (hasCloudConfig()) {
    document.body.classList.add("spectator-mode");
    setCloudStatus("Loading shared data…", "warn");
  }
  updateEditorUI();
  renderPlayers();
  updateResultsSaveButton();
  updateSaveIndicator();
  switchView("predictions");
  // Pull shared state after first paint (errors are handled inside)
  Promise.resolve()
    .then(function () {
      return initCloud();
    })
    .catch(function (e) {
      console.error("initCloud unhandled", e);
      setCloudStatus("Cloud failed to start", "err");
      updateEditorUI();
      renderAllViews();
    });
})();
