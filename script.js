/* Haymarket Barber Co. — booking engine.
 * Plain JS state machine: service -> barber -> date/time -> details -> confirm.
 * Pure scheduling logic is exposed on window.BookingApp for testing.
 */
(function () {
  "use strict";

  /* ---------------- Data ---------------- */

  var SERVICES = [
    { id: "classic", name: "Classic Cut", desc: "Precision scissor work, hot-lather neckline, styled finish.", duration: 30, price: 30 },
    { id: "fade", name: "Skin Fade", desc: "Seamless blend from skin to length with razor-detailed edges.", duration: 45, price: 35 },
    { id: "cut-beard", name: "Cut + Beard Sculpt", desc: "The full works: cut, beard shaping, hot-towel finish.", duration: 60, price: 48 },
    { id: "beard", name: "Beard Sculpt", desc: "Shape, line-up, and conditioning treatment.", duration: 20, price: 20 },
    { id: "shave", name: "Hot Towel Shave", desc: "Traditional straight-razor shave with hot towels and oils.", duration: 30, price: 28 },
    { id: "junior", name: "Junior Cut", desc: "Patient, kid-friendly cuts for gentlemen 12 and under.", duration: 25, price: 22 }
  ];

  var BARBERS = [
    { id: "marcus", name: "Marcus Reed", role: "Master Barber", bio: "Fades, designs, and eight years behind the chair.", img: "images/marcus.webp" },
    { id: "elena", name: "Elena Vargas", role: "Senior Barber", bio: "Precision cuts and beard sculpting specialist.", img: "images/elena.webp" },
    { id: "walt", name: "Walt Briggs", role: "Master Barber", bio: "Classic cuts and straight-razor shaves, 25 years strong.", img: "images/walt.webp" }
  ];

  var OPEN_MIN = 9 * 60;    // 9:00 AM
  var CLOSE_MIN = 18 * 60;  // 6:00 PM
  var SLOT_STEP = 15;       // slot starts every 15 minutes
  var DAYS_AHEAD = 14;
  var STORE_KEY = "hbc-bookings-v1";

  /* ---------------- State ---------------- */

  var state = {
    step: 1,
    serviceId: null,
    barberId: null,      // 'any' allowed
    dateISO: null,
    timeMin: null,
    assignedBarberId: null,
    customer: { name: "", phone: "", email: "", notes: "" },
    ref: null
  };

  /* ---------------- Pure scheduling logic ---------------- */

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function toISO(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function fromISO(iso) {
    var p = iso.split("-");
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }

  function isClosedDay(date) {
    var day = date.getDay();
    return day === 0 || day === 1; // closed Sunday & Monday
  }

  // Deterministic hash so the demo schedule is stable across visits.
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Simulated existing bookings: ~1 in 3 of the 15-minute chair blocks is taken.
  function cellTaken(barberId, dateISO, cellStart) {
    return (hashStr(barberId + "|" + dateISO + "|" + cellStart) % 100) < 34;
  }

  function getUserBookings() {
    try {
      var raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORE_KEY) : null;
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveUserBooking(b) {
    try {
      var arr = getUserBookings();
      arr.push(b);
      localStorage.setItem(STORE_KEY, JSON.stringify(arr));
    } catch (e) { /* storage unavailable; booking still confirmed in-session */ }
  }

  // A slot is free when every 15-min block it spans is free of simulated
  // bookings and of the visitor's own earlier bookings.
  function slotFree(barberId, dateISO, startMin, durationMin, userBookings) {
    var cells = Math.ceil(durationMin / SLOT_STEP);
    for (var c = 0; c < cells; c++) {
      var cell = startMin + c * SLOT_STEP;
      if (cellTaken(barberId, dateISO, cell)) return false;
    }
    for (var i = 0; i < userBookings.length; i++) {
      var b = userBookings[i];
      if (b.barberId !== barberId || b.dateISO !== dateISO) continue;
      if (startMin < b.startMin + b.duration && b.startMin < startMin + durationMin) return false;
    }
    return true;
  }

  function serviceById(id) {
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].id === id) return SERVICES[i];
    return null;
  }

  function barberById(id) {
    for (var i = 0; i < BARBERS.length; i++) if (BARBERS[i].id === id) return BARBERS[i];
    return null;
  }

  // Returns start-times (minutes since midnight) available for a service.
  // barberId may be a barber id or 'any' (free with at least one barber).
  function getSlots(dateISO, serviceId, barberId, nowDate) {
    var svc = serviceById(serviceId);
    if (!svc) return [];
    var date = fromISO(dateISO);
    if (isClosedDay(date)) return [];
    var userBookings = getUserBookings();
    var barbers = barberId === "any"
      ? BARBERS.map(function (b) { return b.id; })
      : [barberId];
    var out = [];
    for (var t = OPEN_MIN; t + svc.duration <= CLOSE_MIN; t += SLOT_STEP) {
      if (nowDate && toISO(nowDate) === dateISO) {
        var nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
        if (t < nowMin + 30) continue; // no booking less than 30 min out
      }
      for (var i = 0; i < barbers.length; i++) {
        if (slotFree(barbers[i], dateISO, t, svc.duration, userBookings)) {
          out.push(t);
          break;
        }
      }
    }
    return out;
  }

  // With 'any', deterministically assign the first free barber at that slot.
  function assignBarber(dateISO, serviceId, timeMin, barberId) {
    if (barberId !== "any") return barberId;
    var svc = serviceById(serviceId);
    var userBookings = getUserBookings();
    for (var i = 0; i < BARBERS.length; i++) {
      if (slotFree(BARBERS[i].id, dateISO, timeMin, svc.duration, userBookings)) return BARBERS[i].id;
    }
    return BARBERS[0].id;
  }

  function fmtTime(min) {
    var h = Math.floor(min / 60), m = min % 60;
    var ap = h >= 12 ? "PM" : "AM";
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ":" + pad(m) + " " + ap;
  }

  function fmtDateLong(iso) {
    return fromISO(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }

  function fmtPhone(digits) {
    var d = digits.replace(/\D/g, "");
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    if (d.length !== 10) return digits;
    return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
  }

  function makeRef() {
    var n = Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    return "HBC-" + n.slice(-6).toUpperCase();
  }

  /* ---------------- Validation ---------------- */

  function validateDetails(c) {
    var errors = {};
    if (!c.name || c.name.trim().length < 2) errors.name = "Please enter your full name.";
    var digits = (c.phone || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
    if (digits.length !== 10) errors.phone = "Enter a 10-digit phone number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((c.email || "").trim())) errors.email = "Enter a valid email address.";
    return errors;
  }

  /* ---------------- DOM wiring ---------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var scissorsSVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>';

  function renderServices() {
    $("#serviceGrid").innerHTML = SERVICES.map(function (s) {
      return '<button type="button" class="pick-card" data-service="' + s.id + '" aria-pressed="false">' +
        '<h4>' + esc(s.name) + '</h4>' +
        '<p class="card-desc">' + esc(s.desc) + '</p>' +
        '<div class="card-meta"><span class="price">$' + s.price + '</span>' +
        '<span class="dur">' + s.duration + ' min</span></div></button>';
    }).join("");
    $("#serviceList").innerHTML = SERVICES.map(function (s) {
      return '<div class="service-row"><span class="s-icon" aria-hidden="true">' + scissorsSVG + '</span>' +
        '<div><h3>' + esc(s.name) + '</h3><p>' + esc(s.desc) + '</p>' +
        '<div class="card-meta"><span class="price">$' + s.price + '</span>' +
        '<span class="dur">' + s.duration + ' min</span></div></div></div>';
    }).join("");
  }

  function renderBarbers() {
    var cards = BARBERS.map(function (b) {
      return '<button type="button" class="pick-card" data-barber="' + b.id + '" aria-pressed="false">' +
        '<img class="barber-photo" src="' + b.img + '" alt="Portrait of ' + esc(b.name) + '" loading="lazy">' +
        '<p class="barber-role">' + esc(b.role) + '</p>' +
        '<h4>' + esc(b.name) + '</h4>' +
        '<p class="card-desc">' + esc(b.bio) + '</p></button>';
    }).join("");
    cards += '<button type="button" class="pick-card" data-barber="any" aria-pressed="false">' +
      '<div class="any-barber"><span class="dice" aria-hidden="true">' + scissorsSVG + '</span>' +
      '<h4>No preference</h4><p class="card-desc">We will match you with the first free chair.</p></div></button>';
    $("#barberGrid").innerHTML = cards;
    $("#barberList").innerHTML = BARBERS.map(function (b) {
      return '<div class="barber-card"><img src="' + b.img + '" alt="Portrait of ' + esc(b.name) + '" loading="lazy">' +
        '<h3>' + esc(b.name) + '</h3><p class="barber-role">' + esc(b.role) + '</p>' +
        '<p class="card-desc">' + esc(b.bio) + '</p></div>';
    }).join("");
  }

  function renderDates() {
    var strip = $("#dateStrip");
    var today = new Date();
    var html = "";
    for (var i = 0; i < DAYS_AHEAD; i++) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      var iso = toISO(d);
      var closed = isClosedDay(d);
      var dow = i === 0 ? "Today" : i === 1 ? "Tmrw" : d.toLocaleDateString("en-US", { weekday: "short" });
      html += '<button type="button" role="option" class="date-chip' + (closed ? " closed" : "") +
        (iso === state.dateISO ? " selected" : "") + '" data-date="' + iso + '"' +
        (closed ? " disabled title=\"Closed\"" : ' aria-selected="' + (iso === state.dateISO) + '"') + '>' +
        '<span class="dow">' + dow + '</span>' +
        '<span class="dnum">' + d.getDate() + '</span>' +
        '<span class="dmon">' + d.toLocaleDateString("en-US", { month: "short" }) + "</span></button>";
    }
    strip.innerHTML = html;
  }

  function renderSlots() {
    var grid = $("#slotGrid");
    var empty = $("#slotEmpty");
    if (!state.dateISO) {
      grid.innerHTML = "";
      empty.hidden = false;
      empty.textContent = "Choose a day above to see open times.";
      return;
    }
    var slots = getSlots(state.dateISO, state.serviceId, state.barberId, new Date());
    if (!slots.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      empty.textContent = "No open slots that day. Try another date.";
      return;
    }
    empty.hidden = true;
    grid.innerHTML = slots.map(function (t) {
      return '<button type="button" class="slot' + (t === state.timeMin ? " selected" : "") +
        '" data-time="' + t + '">' + fmtTime(t) + "</button>";
    }).join("");
  }

  function updateSlotContext() {
    var svc = serviceById(state.serviceId);
    var barber = state.barberId === "any" ? null : barberById(state.barberId);
    $("#slotContext").textContent = svc
      ? "Showing " + svc.duration + "-minute openings" + (barber ? " with " + barber.name : " across all chairs") + ". We're closed Sundays and Mondays."
      : "";
  }

  function updateSummary() {
    var svc = serviceById(state.serviceId);
    var barberName = state.barberId === "any" ? "No preference"
      : state.barberId ? barberById(state.barberId).name : "Not chosen";
    setSum("service", svc ? svc.name + " (" + svc.duration + " min)" : "Not chosen");
    setSum("barber", barberName);
    setSum("date", state.dateISO ? fmtDateLong(state.dateISO) : "Not chosen");
    setSum("time", state.timeMin != null ? fmtTime(state.timeMin) : "Not chosen");
    $("#summaryPrice").textContent = "$" + (svc ? svc.price : 0);
  }

  function setSum(key, val) {
    var dd = document.querySelector('[data-sum="' + key + '"]');
    if (dd) dd.textContent = val;
  }

  function setStep(n) {
    state.step = n;
    $all(".panel").forEach(function (p) { p.hidden = p.dataset.panel !== String(n); });
    $all("#stepper li").forEach(function (li, i) {
      var s = i + 1;
      li.classList.toggle("active", s === n);
      li.classList.toggle("done", s < n);
      if (s === n) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    $("#backBtn").disabled = n === 1 || n === 5;
    $("#stepNav").style.display = n === 5 ? "none" : "flex";
    $("#nextBtn").textContent = n === 4 ? "Confirm booking" : "Continue";
    updateNavState();
  }

  function stepComplete(n) {
    if (n === 1) return !!state.serviceId;
    if (n === 2) return !!state.barberId;
    if (n === 3) return !!state.dateISO && state.timeMin != null;
    if (n === 4) return Object.keys(validateDetails(readForm())).length === 0;
    return true;
  }

  function updateNavState() {
    $("#nextBtn").disabled = !stepComplete(state.step);
  }

  function readForm() {
    return {
      name: $("#fName").value,
      phone: $("#fPhone").value,
      email: $("#fEmail").value,
      notes: $("#fNotes").value
    };
  }

  function showErrors(errors) {
    ["fName", "fPhone", "fEmail"].forEach(function (id) {
      var input = document.getElementById(id);
      var key = id === "fName" ? "name" : id === "fPhone" ? "phone" : "email";
      var msg = errors[key] || "";
      input.classList.toggle("invalid", !!msg);
      var p = document.querySelector('[data-error-for="' + id + '"]');
      if (p) p.textContent = msg;
    });
  }

  function confirmBooking() {
    var c = readForm();
    var svc = serviceById(state.serviceId);
    var assigned = assignBarber(state.dateISO, state.serviceId, state.timeMin, state.barberId);
    state.assignedBarberId = assigned;
    state.customer = { name: c.name.trim(), phone: fmtPhone(c.phone), email: c.email.trim(), notes: c.notes.trim() };
    state.ref = makeRef();
    saveUserBooking({
      barberId: assigned,
      dateISO: state.dateISO,
      startMin: state.timeMin,
      duration: svc.duration,
      ref: state.ref
    });
    var barber = barberById(assigned);
    $("#confirmRef").textContent = state.ref;
    var rows = [
      ["Service", svc.name + " — $" + svc.price],
      ["Barber", barber.name + (state.barberId === "any" ? " (matched for you)" : "")],
      ["Date", fmtDateLong(state.dateISO)],
      ["Time", fmtTime(state.timeMin) + " (" + svc.duration + " min)"],
      ["Name", state.customer.name],
      ["Phone", state.customer.phone]
    ];
    $("#confirmList").innerHTML = rows.map(function (r) {
      return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>";
    }).join("");
    updateSummary();
    setStep(5);
  }

  function resetBooking() {
    state.serviceId = null;
    state.barberId = null;
    state.dateISO = null;
    state.timeMin = null;
    state.assignedBarberId = null;
    state.ref = null;
    $("#detailsForm").reset();
    showErrors({});
    $all(".pick-card.selected").forEach(function (el) {
      el.classList.remove("selected");
      el.setAttribute("aria-pressed", "false");
    });
    renderDates();
    renderSlots();
    updateSlotContext();
    updateSummary();
    setStep(1);
  }

  function selectCard(container, attr, id) {
    $all(".pick-card", container).forEach(function (el) {
      var on = el.dataset[attr] === id;
      el.classList.toggle("selected", on);
      el.setAttribute("aria-pressed", String(on));
    });
  }

  function init() {
    renderServices();
    renderBarbers();
    renderDates();
    updateSummary();
    setStep(1);

    $("#serviceGrid").addEventListener("click", function (e) {
      var card = e.target.closest("[data-service]");
      if (!card) return;
      state.serviceId = card.dataset.service;
      state.timeMin = null; // duration may have changed; re-pick a time
      selectCard($("#serviceGrid"), "service", state.serviceId);
      updateSummary();
      updateNavState();
    });

    $("#barberGrid").addEventListener("click", function (e) {
      var card = e.target.closest("[data-barber]");
      if (!card) return;
      state.barberId = card.dataset.barber;
      state.timeMin = null;
      selectCard($("#barberGrid"), "barber", state.barberId);
      updateSummary();
      updateNavState();
    });

    $("#dateStrip").addEventListener("click", function (e) {
      var chip = e.target.closest("[data-date]");
      if (!chip || chip.disabled) return;
      state.dateISO = chip.dataset.date;
      state.timeMin = null;
      $all(".date-chip", $("#dateStrip")).forEach(function (c) {
        var on = c.dataset.date === state.dateISO;
        c.classList.toggle("selected", on);
        c.setAttribute("aria-selected", String(on));
      });
      renderSlots();
      updateSummary();
      updateNavState();
    });

    $("#slotGrid").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-time]");
      if (!btn) return;
      state.timeMin = parseInt(btn.dataset.time, 10);
      $all(".slot", $("#slotGrid")).forEach(function (s) {
        s.classList.toggle("selected", s === btn);
      });
      updateSummary();
      updateNavState();
    });

    ["fName", "fPhone", "fEmail", "fNotes"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", updateNavState);
    });

    $("#backBtn").addEventListener("click", function () {
      if (state.step === 3) { renderSlots(); }
      if (state.step > 1) setStep(state.step - 1);
    });

    $("#nextBtn").addEventListener("click", function () {
      if (state.step === 3 && !state.dateISO) return;
      if (state.step === 4) {
        var c = readForm();
        var errors = validateDetails(c);
        showErrors(errors);
        if (Object.keys(errors).length) return;
        confirmBooking();
        return;
      }
      if (state.step === 2) { renderDates(); updateSlotContext(); renderSlots(); }
      setStep(state.step + 1);
    });

    $all("#stepper li").forEach(function (li) {
      li.addEventListener("click", function () {
        var target = parseInt(li.dataset.goto, 10);
        if (target < state.step && state.step !== 5) {
          if (target === 3) { updateSlotContext(); renderSlots(); }
          setStep(target);
        }
      });
    });

    $("#bookAnother").addEventListener("click", resetBooking);
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", init);
  }

  // Exposed for automated testing of the scheduling logic.
  if (typeof window !== "undefined") {
    window.BookingApp = {
      SERVICES: SERVICES,
      BARBERS: BARBERS,
      getSlots: getSlots,
      assignBarber: assignBarber,
      slotFree: slotFree,
      validateDetails: validateDetails,
      fmtTime: fmtTime,
      fmtPhone: fmtPhone,
      isClosedDay: isClosedDay,
      toISO: toISO,
      fromISO: fromISO
    };
  }
})();
