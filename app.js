(function () {
  "use strict";

  /* ===================== CONSTANTS ===================== */
  var ATHLETES = [
    "Nick Bame",
    "David De Genaro",
    "Glenn Jenkins",
    "Noah Thammavong",
    "Nathan Webb",
  ];
  var STORAGE_KEY = "fantasyTriathlonState_v2";

  var RANK_POINTS = { 0: 5, 1: 3, 2: 1 }; // diff in rank -> points, else 0

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

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if (!parsed.players) parsed.players = [];
      if (!parsed.results) parsed.results = emptyResults();
      ATHLETES.forEach(function (a) {
        if (!parsed.results[a])
          parsed.results[a] = {
            swim: null,
            t1: null,
            bike: null,
            t2: null,
            run: null,
          };
      });
      parsed.players.forEach(function (p) {
        if (!p.predictions) p.predictions = emptyPredictions();
        if (!p.wildcards) p.wildcards = { t1: null, t2: null };
        // draft mirrors saved data initially; deep copy so editing draft doesn't mutate saved
        if (!p.draftPredictions) p.draftPredictions = deepCopy(p.predictions);
        if (!p.draftWildcards) p.draftWildcards = deepCopy(p.wildcards);
        if (typeof p.hasSavedPrediction !== "boolean") {
          p.hasSavedPrediction = ATHLETES.some(function (a) {
            var pr = p.predictions[a];
            return (
              pr.swim !== null ||
              pr.bike !== null ||
              pr.run !== null ||
              pr.transition !== null
            );
          });
        }
        if (typeof p.open !== "boolean") p.open = false;
      });
      return parsed;
    } catch (e) {
      console.error("Failed to load state", e);
      return defaultState();
    }
  }

  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function persistNow(silent) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (!silent) showToast("Saved");
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

  // Safety net: flush any saved-but-not-yet-written state if the tab is closed.
  // (Draft edits are intentionally NOT flushed here -- only explicit Save actions persist drafts.)
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
    if (unsavedCount > 0) {
      el.textContent =
        unsavedCount === 1
          ? "1 prediction has unsaved changes"
          : unsavedCount + " predictions have unsaved changes";
      el.classList.add("pending");
    } else {
      el.textContent = "All changes saved";
      el.classList.remove("pending");
    }
  }

  function hasUnsavedDraft(player) {
    return (
      JSON.stringify(player.draftPredictions) !==
        JSON.stringify(player.predictions) ||
      JSON.stringify(player.draftWildcards) !== JSON.stringify(player.wildcards)
    );
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

  function scorePlayer(player) {
    var actualRanks = computeActualRanks();
    var predRanks = computeRanksForPredictions(player.predictions);
    var perAthlete = {};
    var total = 0;

    ATHLETES.forEach(function (a) {
      var pred = player.predictions[a];
      var res = state.results[a];
      var entry = {
        swimRank: 0,
        bikeRank: 0,
        runRank: 0,
        swimTime: 0,
        bikeTime: 0,
        runTime: 0,
        transition: 0,
      };

      ["swim", "bike", "run"].forEach(function (disc) {
        var predInfo = predRanks[disc][a];
        var predictedRank = predInfo ? predInfo.best : null;
        var actualInfo = actualRanks[disc][a];
        var pts = rankDiffPoints(predictedRank, actualInfo);
        entry[disc + "Rank"] = pts;
        total += pts;
      });

      if (res) {
        if (pred.swim !== null && res.swim !== null) {
          entry.swimTime = timeDiffPoints(
            pred.swim - res.swim,
            TIME_POINT_TABLES.swim,
          );
          total += entry.swimTime;
        }
        if (pred.bike !== null && res.bike !== null) {
          entry.bikeTime = timeDiffPoints(
            pred.bike - res.bike,
            TIME_POINT_TABLES.bike,
          );
          total += entry.bikeTime;
        }
        if (pred.run !== null && res.run !== null) {
          entry.runTime = timeDiffPoints(
            pred.run - res.run,
            TIME_POINT_TABLES.run,
          );
          total += entry.runTime;
        }
        var actualTransition = getResultTransition(res);
        if (pred.transition !== null && actualTransition !== null) {
          entry.transition = timeDiffPoints(
            pred.transition - actualTransition,
            TIME_POINT_TABLES.transition,
          );
          total += entry.transition;
        }
      }

      perAthlete[a] = entry;
    });

    var wc = { t1: 0, t2: 0 };
    var t1AtRank3 = athletesAtRank(actualRanks.t1, 3);
    var t2AtRank3 = athletesAtRank(actualRanks.t2, 3);
    if (player.wildcards.t1 && t1AtRank3.indexOf(player.wildcards.t1) !== -1) {
      wc.t1 = 5;
      total += 5;
    }
    if (player.wildcards.t2 && t2AtRank3.indexOf(player.wildcards.t2) !== -1) {
      wc.t2 = 5;
      total += 5;
    }

    return { total: total, perAthlete: perAthlete, wildcards: wc };
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
  var views = ["predictions", "results", "viewpredictions", "leaderboard"];
  var titles = {
    predictions: "Predictions",
    results: "Actual Results",
    viewpredictions: "View Predictions",
    leaderboard: "Leaderboard",
  };

  function switchView(name) {
    views.forEach(function (v) {
      document
        .getElementById("view-" + v)
        .classList.toggle("active", v === name);
    });
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.view === name);
    });
    document.getElementById("header-title").textContent = titles[name];
    document.getElementById("save-results-btn").style.display =
      name === "results" ? "inline-block" : "none";
    if (name === "results") renderResults();
    if (name === "viewpredictions") renderViewPredictions();
    if (name === "leaderboard") renderLeaderboard();
  }

  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchView(btn.dataset.view);
    });
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
  // Backspace removes the last digit. No tapping between separate H/M/S boxes,
  // and no need to type leading zeros. Committed to the DRAFT on blur/Enter/change
  // (no localStorage write here -- persistence happens via explicit Save actions).
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

    function render() {
      inp.value = digitStringToDisplay(digits);
    }
    render();

    function commit() {
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
        digits = digits.slice(0, -1);
        render();
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (digits.length < 6) {
          // cap at HH:MM:SS (6 digits)
          digits += e.key;
          render();
        }
        return;
      }
      // block any other character (letters, symbols, etc.)
      e.preventDefault();
    });

    // Handles paste, or mobile keyboards that don't fire clean keydown events.
    inp.addEventListener("input", function () {
      var onlyDigits = inp.value.replace(/[^0-9]/g, "").slice(-6);
      digits = onlyDigits;
      render();
    });

    inp.addEventListener("blur", commit);
    inp.addEventListener("change", commit);
    inp.addEventListener("focus", function () {
      inp.select();
    });

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
      onChange(sel.value || null);
    });
    return sel;
  }

  document
    .getElementById("add-player-btn")
    .addEventListener("click", function () {
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
          }),
        );
        block.appendChild(fg);
      });

      wrap.appendChild(block);
    });

    refreshResultsSummary();
  }

  document
    .getElementById("save-results-btn")
    .addEventListener("click", function () {
      persistNow();
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

    ATHLETES.forEach(function (athlete) {
      var block = document.createElement("div");
      block.className = "stats-athlete-block";
      var nameEl = document.createElement("div");
      nameEl.className = "sa-name";
      nameEl.textContent = athlete;
      block.appendChild(nameEl);

      ["swim", "bike", "run", "transition"].forEach(function (disc) {
        var vals = saved
          .map(function (p) {
            return p.predictions[athlete][disc];
          })
          .filter(function (v) {
            return v !== null;
          });
        var avg = vals.length
          ? vals.reduce(function (s, v) {
              return s + v;
            }, 0) / vals.length
          : null;
        block.appendChild(
          statRow(
            labelFor(disc) + " avg. time",
            avg === null ? "--" : formatSeconds(avg),
          ),
        );
      });

      var totals = saved
        .map(function (p) {
          return getPredictionTotal(p.predictions[athlete]);
        })
        .filter(function (v) {
          return v !== null;
        });
      var avgTotal = totals.length
        ? totals.reduce(function (s, v) {
            return s + v;
          }, 0) / totals.length
        : null;
      block.appendChild(
        statRow(
          "Avg. total time",
          avgTotal === null ? "--" : formatSeconds(avgTotal),
        ),
      );

      ["swim", "bike", "run", "overall"].forEach(function (disc) {
        var ranks = saved
          .map(function (p) {
            var rr = computeRanksForPredictions(p.predictions)[disc][athlete];
            return rr ? rr.best : null;
          })
          .filter(function (v) {
            return v !== null;
          });
        var avgRank = ranks.length
          ? ranks.reduce(function (s, v) {
              return s + v;
            }, 0) / ranks.length
          : null;
        block.appendChild(
          statRow(
            "Avg. predicted " + labelFor(disc) + " rank",
            avgRank === null
              ? "--"
              : ordinal(Math.round(avgRank)) + " (" + avgRank.toFixed(1) + ")",
          ),
        );
      });

      card.appendChild(block);
    });

    wrap.appendChild(card);
  }

  function labelFor(disc) {
    if (disc === "swim") return "Swim";
    if (disc === "bike") return "Bike";
    if (disc === "run") return "Run";
    if (disc === "transition") return "Transition";
    if (disc === "overall") return "Overall";
    return disc;
  }

  function statRow(label, value) {
    var row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML =
      '<span class="stat-label">' +
      escapeHtml(label) +
      '</span><span class="stat-value">' +
      escapeHtml(value) +
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
        var row = document.createElement("div");
        row.className = "lb-row";
        row.style.flexDirection = "column";
        row.style.alignItems = "stretch";
        row.style.cursor = "pointer";

        var top = document.createElement("div");
        top.style.display = "flex";
        top.style.alignItems = "center";
        top.style.gap = "12px";
        top.innerHTML =
          '<div class="lb-rank">' +
          (idx + 1) +
          "</div>" +
          '<div class="lb-main"><div class="lb-name">' +
          escapeHtml(entry.player.name) +
          "</div>" +
          '<div class="lb-sub">Tap for point breakdown</div></div>' +
          '<div class="lb-points">' +
          entry.score.total +
          '<span class="lbl">pts</span></div>';

        var detail = document.createElement("div");
        detail.className = "breakdown";
        detail.style.display = "none";
        detail.appendChild(buildBreakdown(entry.player, entry.score));

        row.appendChild(top);
        row.appendChild(detail);

        row.addEventListener("click", function () {
          detail.style.display =
            detail.style.display === "none" ? "block" : "none";
        });

        listEl.appendChild(row);
      });
    }

    renderAthleteVsAverage();
  }

  function buildBreakdown(player, score) {
    var wrap = document.createElement("div");

    ATHLETES.forEach(function (athlete) {
      var e = score.perAthlete[athlete];
      var block = document.createElement("div");
      block.className = "breakdown-athlete";
      block.innerHTML =
        '<div class="ba-name">' + escapeHtml(athlete) + "</div>";

      var row = document.createElement("div");
      row.className = "chip-row";
      [
        { label: "Swim Rank", pts: e.swimRank, max: 5 },
        { label: "Bike Rank", pts: e.bikeRank, max: 5 },
        { label: "Run Rank", pts: e.runRank, max: 5 },
        { label: "Swim Time", pts: e.swimTime, max: 10 },
        { label: "Bike Time", pts: e.bikeTime, max: 10 },
        { label: "Run Time", pts: e.runTime, max: 10 },
        { label: "Transition", pts: e.transition, max: 4 },
      ].forEach(function (c) {
        var chip = document.createElement("span");
        var cls = "chip";
        if (c.pts === 0) cls += " pts-zero";
        else if (c.pts >= c.max) cls += " pts-high";
        else cls += " pts-mid";
        chip.className = cls;
        chip.textContent = c.label + " +" + c.pts;
        row.appendChild(chip);
      });
      block.appendChild(row);
      wrap.appendChild(block);
    });

    var wcBlock = document.createElement("div");
    wcBlock.className = "breakdown-athlete";
    wcBlock.innerHTML = '<div class="ba-name">Wildcards</div>';
    var wcRow = document.createElement("div");
    wcRow.className = "chip-row";
    var t1Chip = document.createElement("span");
    t1Chip.className =
      "chip " + (score.wildcards.t1 > 0 ? "pts-high" : "pts-zero");
    t1Chip.textContent = "3rd T1 +" + score.wildcards.t1;
    var t2Chip = document.createElement("span");
    t2Chip.className =
      "chip " + (score.wildcards.t2 > 0 ? "pts-high" : "pts-zero");
    t2Chip.textContent = "3rd T2 +" + score.wildcards.t2;
    wcRow.appendChild(t1Chip);
    wcRow.appendChild(t2Chip);
    wcBlock.appendChild(wcRow);
    wrap.appendChild(wcBlock);

    return wrap;
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

  /* ===================== CLEAR DATA ===================== */
  document
    .getElementById("clear-data-btn")
    .addEventListener("click", function () {
      if (
        confirm(
          "This will permanently delete ALL fantasy players, predictions, and results. This cannot be undone. Continue?",
        )
      ) {
        if (confirm("Are you absolutely sure? All data will be lost.")) {
          localStorage.removeItem(STORAGE_KEY);
          state = defaultState();
          renderPlayers();
          renderResults();
          renderViewPredictions();
          renderLeaderboard();
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
  renderPlayers();
  switchView("predictions");
})();
