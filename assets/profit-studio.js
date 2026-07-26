/*
 * Three Point Digital — Kârlılık Merkezi
 *
 * Teslim edilen React uygulamasının (app/page.tsx) bağımlılıksız JavaScript
 * karşılığıdır. Hesaplama fonksiyonları (`calculate`, `targetPrice`), pazaryeri
 * sıralaması, varsayılan değerler ve veri davranışları birebir korunmuştur.
 *
 * Değişen tek şey taşıma katmanıdır: React state yerine düz DOM, `/api/register`
 * yerine `data-register-endpoint` ile verilen Cloudflare Worker adresi.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-profit-studio]");
  if (!root) return;

  /* ------------------------------------------------------------------ *
   * Sabitler — kaynak paketten birebir
   * ------------------------------------------------------------------ */
  var MARKETS = {
    trendyol: { name: "Trendyol", short: "T", commission: 21.5, color: "#f27a1a" },
    hepsiburada: { name: "Hepsiburada", short: "H", commission: 19.9, color: "#ff6000" },
    amazon: { name: "Amazon Türkiye", short: "a", commission: 17, color: "#131921" },
    diger: { name: "Diğer kanal", short: "+", commission: 15, color: "#5b6475" }
  };

  var MARKET_ORDER = ["trendyol", "hepsiburada", "amazon", "diger"];
  // Karşılaştırma sırası sabittir; kârlılık değişince kartlar yer değiştirmez.
  var COMPARE_ORDER = ["trendyol", "hepsiburada", "amazon"];

  var DEFAULTS = {
    productName: "Yeni ürün",
    sku: "",
    market: "trendyol",
    salePrice: 599.9,
    purchasePrice: 210,
    vatRate: 20,
    commissionRate: 21.5,
    adMode: "percent",
    adRate: 5,
    adFixed: 30,
    shipping: 79.9,
    generalExpense: 24,
    serviceFee: 0,
    withholdingRate: 1,
    targetMargin: 25
  };

  var NUMERIC_KEYS = [
    "salePrice",
    "purchasePrice",
    "vatRate",
    "commissionRate",
    "adRate",
    "adFixed",
    "shipping",
    "generalExpense",
    "serviceFee",
    "withholdingRate",
    "targetMargin"
  ];

  var STORAGE_PRODUCTS = "tpd-profit-products-v2";
  var STORAGE_REGISTRATION = "tpd-free-registration";
  var MAX_PRODUCTS = 50;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultScenarios() {
    var all = {};
    MARKET_ORDER.forEach(function (market) {
      var scenario = clone(DEFAULTS);
      scenario.market = market;
      scenario.commissionRate = MARKETS[market].commission;
      scenario.productName = MARKETS[market].name + " ürünü";
      all[market] = scenario;
    });
    return all;
  }

  /* ------------------------------------------------------------------ *
   * Hesaplama — kaynak paketle birebir aynı
   * ------------------------------------------------------------------ */
  function calculate(input) {
    var sale = Math.max(0, input.salePrice || 0);
    var purchase = Math.max(0, input.purchasePrice || 0);
    var vatFactor = Math.max(0, input.vatRate || 0) / 100;
    var expenseVat = 0.2;
    var netSale = vatFactor ? sale / (1 + vatFactor) : sale;
    var netPurchase = vatFactor ? purchase / (1 + vatFactor) : purchase;
    var shippingNet = input.shipping / (1 + expenseVat);
    var generalNet = input.generalExpense / (1 + expenseVat);
    var commission = sale * (input.commissionRate / 100);
    var advertising =
      input.adMode === "fixed" ? Math.max(0, input.adFixed || 0) : sale * (input.adRate / 100);
    var withholding = netSale * (input.withholdingRate / 100);
    var serviceFee = Math.max(0, input.serviceFee || 0);
    var profit =
      netSale -
      netPurchase -
      commission -
      advertising -
      shippingNet -
      generalNet -
      withholding -
      serviceFee;
    var margin = netSale > 0 ? (profit / netSale) * 100 : 0;
    var saleVat = sale - netSale;
    var purchaseVat = purchase - netPurchase;
    var shippingVat = input.shipping - shippingNet;
    var generalVat = input.generalExpense - generalNet;
    var serviceVat = (commission + advertising) * expenseVat;
    var payableVat = Math.max(0, saleVat - purchaseVat - shippingVat - generalVat - serviceVat);
    var totalCost =
      netPurchase + commission + advertising + shippingNet + generalNet + withholding + serviceFee;

    return {
      netSale: netSale,
      netPurchase: netPurchase,
      shippingNet: shippingNet,
      generalNet: generalNet,
      commission: commission,
      advertising: advertising,
      withholding: withholding,
      serviceFee: serviceFee,
      profit: profit,
      margin: margin,
      payableVat: payableVat,
      totalCost: totalCost
    };
  }

  function targetPrice(input) {
    var low = 0;
    var high = Math.max(input.salePrice * 5, input.purchasePrice * 10, 1000);
    var target = input.targetMargin / 100;
    for (var index = 0; index < 80; index += 1) {
      var middle = (low + high) / 2;
      var withMiddle = clone(input);
      withMiddle.salePrice = middle;
      if (calculate(withMiddle).margin / 100 < target) low = middle;
      else high = middle;
    }
    return high;
  }

  var money = new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2
  });
  var decimal = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  /* ------------------------------------------------------------------ *
   * Durum
   * ------------------------------------------------------------------ */
  var state = {
    view: "hesapla",
    inputs: clone(DEFAULTS),
    scenarios: defaultScenarios(),
    saved: [],
    registered: false,
    pendingAction: "karsilastir"
  };

  var registerEndpoint = (document.body.getAttribute("data-register-endpoint") || "").trim();
  var gateEnabled = registerEndpoint.length > 0;

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* özel sekmede depolama kapalı olabilir; sessizce geç */
    }
  }

  (function restore() {
    var raw = readStorage(STORAGE_PRODUCTS);
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        state.saved = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        state.saved = [];
      }
    }
    state.registered = gateEnabled ? Boolean(readStorage(STORAGE_REGISTRATION)) : true;
  })();

  /* ------------------------------------------------------------------ *
   * Kısayollar
   * ------------------------------------------------------------------ */
  function el(selector, scope) {
    return (scope || root).querySelector(selector);
  }

  function els(selector, scope) {
    return Array.prototype.slice.call((scope || root).querySelectorAll(selector));
  }

  function out(name, text) {
    els('[data-out="' + name + '"]').forEach(function (node) {
      node.textContent = text;
    });
  }

  function badge(marketKey, className) {
    var market = MARKETS[marketKey];
    var i = document.createElement("i");
    i.className = className || "ps-badge";
    i.style.background = market.color;
    i.textContent = market.short;
    return i;
  }

  var toast = el("[data-ps-toast]");
  var toastTimer = null;

  function flash(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, 2200);
  }

  /* ------------------------------------------------------------------ *
   * Hesaplama görünümü
   * ------------------------------------------------------------------ */
  var calcView = el("#ps-view-hesapla");
  var advancedBox = el("[data-ps-advanced]");
  var advancedToggle = el("[data-ps-advanced-toggle]");

  function field(name) {
    return el('[name="' + name + '"]', calcView);
  }

  function syncFields() {
    var inputs = state.inputs;
    Object.keys(inputs).forEach(function (key) {
      if (key === "market" || key === "adMode") return;
      var node = field(key);
      if (!node) return;
      node.value = inputs[key];
    });

    var adInput = field("adValue");
    if (adInput) {
      adInput.value = inputs.adMode === "percent" ? inputs.adRate : inputs.adFixed;
    }
    els("[data-ps-admode]", calcView).forEach(function (button) {
      button.setAttribute(
        "aria-pressed",
        button.getAttribute("data-ps-admode") === inputs.adMode ? "true" : "false"
      );
    });
    var adSuffix = el("[data-ps-ad-suffix]", calcView);
    if (adSuffix) adSuffix.textContent = inputs.adMode === "percent" ? "%" : "₺";

    els("[data-ps-market]", calcView).forEach(function (button) {
      button.setAttribute(
        "aria-checked",
        button.getAttribute("data-ps-market") === inputs.market ? "true" : "false"
      );
    });
  }

  function renderResult() {
    var inputs = state.inputs;
    var result = calculate(inputs);
    var suggested = targetPrice(inputs);
    var isLoss = result.profit < 0;
    var status = result.margin >= inputs.targetMargin ? "hedefte" : result.margin >= 0 ? "dikkat" : "zarar";

    var profitNode = el('[data-out="profit"]');
    if (profitNode) profitNode.classList.toggle("is-negative", isLoss);
    var marginNode = el("[data-ps-margin]");
    if (marginNode) marginNode.classList.toggle("is-negative", result.margin < 0);

    var health = el("[data-ps-health]");
    if (health) {
      health.setAttribute("data-state", status);
      var label = status === "hedefte" ? "Hedefte" : status === "dikkat" ? "Hedef altında" : "Zarar";
      health.innerHTML = "";
      var dot = document.createElement("i");
      health.appendChild(dot);
      health.appendChild(document.createTextNode(" " + label));
    }

    out("profit", money.format(result.profit));
    out("margin", "%" + decimal.format(result.margin));
    out("target-margin-label", "%" + inputs.targetMargin + " hedef marj için");
    out("target-price", money.format(suggested));
    out("net-sale", money.format(result.netSale));
    out("purchase", "− " + money.format(result.netPurchase));
    out("commission", "− " + money.format(result.commission));
    out("advertising", "− " + money.format(result.advertising));
    out("shipping", "− " + money.format(result.shippingNet));
    out("other", "− " + money.format(result.generalNet + result.withholding + result.serviceFee));
    out("payable-vat", money.format(result.payableVat));

    var bar = el("[data-ps-costbar]");
    if (bar) {
      var base = Math.max(1, result.netSale);
      var widths = [
        Math.min(100, (result.netPurchase / base) * 100),
        Math.min(100, (result.commission / base) * 100),
        Math.min(100, (result.shippingNet / base) * 100)
      ];
      var segments = bar.children;
      for (var i = 0; i < widths.length; i += 1) {
        if (segments[i]) segments[i].style.width = widths[i] + "%";
      }
    }

    root.setAttribute("data-suggested-price", suggested.toFixed(2));
  }

  function update(key, value) {
    state.inputs[key] = value;
    if (key === "productName" || key === "sku") {
      MARKET_ORDER.forEach(function (market) {
        if (market === state.inputs.market) {
          state.scenarios[market] = clone(state.inputs);
        } else {
          state.scenarios[market][key] = value;
        }
      });
    } else {
      state.scenarios[state.inputs.market] = clone(state.inputs);
    }
    renderResult();
    if (state.view === "karsilastir") renderCompare();
  }

  function selectMarket(market) {
    state.inputs = clone(state.scenarios[market]);
    syncFields();
    renderResult();
  }

  function bindCalcView() {
    if (!calcView) return;

    els("input, select", calcView).forEach(function (node) {
      var name = node.getAttribute("name");
      if (!name) return;
      var handler = function () {
        if (name === "adValue") {
          var adKey = state.inputs.adMode === "percent" ? "adRate" : "adFixed";
          update(adKey, Number(node.value));
          return;
        }
        if (NUMERIC_KEYS.indexOf(name) !== -1) update(name, Number(node.value));
        else update(name, node.value);
      };
      node.addEventListener("input", handler);
      node.addEventListener("change", handler);
    });

    els("[data-ps-market]", calcView).forEach(function (button) {
      button.addEventListener("click", function () {
        selectMarket(button.getAttribute("data-ps-market"));
      });
    });

    els("[data-ps-admode]", calcView).forEach(function (button) {
      button.addEventListener("click", function () {
        update("adMode", button.getAttribute("data-ps-admode"));
        syncFields();
        renderResult();
      });
    });

    if (advancedToggle && advancedBox) {
      advancedToggle.addEventListener("click", function () {
        var open = advancedBox.hidden;
        advancedBox.hidden = !open;
        advancedToggle.setAttribute("aria-expanded", open ? "true" : "false");
        var sign = el("[data-ps-advanced-sign]", advancedToggle);
        var hint = el("[data-ps-advanced-hint]", advancedToggle);
        if (sign) sign.textContent = open ? "−" : "+";
        if (hint) hint.textContent = open ? "Kapat" : "Genel gider, hizmet bedeli ve stopaj";
      });
    }

    var applyTarget = el("[data-ps-apply-target]");
    if (applyTarget) {
      applyTarget.addEventListener("click", function () {
        var suggested = Number(root.getAttribute("data-suggested-price") || "0");
        update("salePrice", Number(suggested.toFixed(2)));
        syncFields();
        flash("Hedef fiyat uygulandı");
      });
    }

    var reset = el("[data-ps-reset]");
    if (reset) {
      reset.addEventListener("click", function () {
        state.inputs = clone(DEFAULTS);
        state.scenarios = defaultScenarios();
        syncFields();
        renderResult();
        renderCompare();
        flash("Alanlar başlangıç değerlerine döndü");
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Karşılaştırma görünümü
   * ------------------------------------------------------------------ */
  var compareGrid = el("[data-ps-compare-grid]");

  function miniInput(marketKey, key, value, suffix) {
    var wrap = document.createElement("div");
    wrap.className = "ps-mini-input";
    var input = document.createElement("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.min = "0";
    input.step = "0.1";
    input.value = value;
    input.setAttribute("aria-label", MARKETS[marketKey].name + " " + key);
    input.addEventListener("input", function () {
      state.scenarios[marketKey][key] = Number(input.value);
      renderCompare({ keepFocus: marketKey + ":" + key });
    });
    var b = document.createElement("b");
    b.textContent = suffix;
    wrap.appendChild(input);
    wrap.appendChild(b);
    return wrap;
  }

  function labelledMini(marketKey, key, text, value, suffix) {
    var label = document.createElement("label");
    var span = document.createElement("span");
    span.textContent = text;
    label.appendChild(span);
    label.appendChild(miniInput(marketKey, key, value, suffix));
    return label;
  }

  function renderCompare(options) {
    if (!compareGrid) return;
    var keepFocus = options && options.keepFocus;

    var results = COMPARE_ORDER.map(function (key) {
      return { key: key, scenario: state.scenarios[key], result: calculate(state.scenarios[key]) };
    });
    var best = results.reduce(function (winner, item) {
      return item.result.profit > winner.result.profit ? item : winner;
    }, results[0]);

    compareGrid.innerHTML = "";

    results.forEach(function (item) {
      var market = MARKETS[item.key];
      var card = document.createElement("article");
      card.className = "ps-market-card" + (best && item.key === best.key ? " is-winner" : "");

      if (best && item.key === best.key) {
        var flag = document.createElement("span");
        flag.className = "ps-best";
        flag.textContent = "EN KÂRLI SENARYO";
        card.appendChild(flag);
      }

      var head = document.createElement("div");
      head.className = "ps-market-head";
      head.appendChild(badge(item.key));
      var headText = document.createElement("div");
      var strong = document.createElement("strong");
      strong.textContent = market.name;
      var small = document.createElement("small");
      small.textContent = "%" + market.commission + " varsayılan komisyon";
      headText.appendChild(strong);
      headText.appendChild(small);
      head.appendChild(headText);
      card.appendChild(head);

      var profit = document.createElement("strong");
      profit.className = "ps-market-profit" + (item.result.profit < 0 ? " is-negative" : "");
      profit.textContent = money.format(item.result.profit);
      card.appendChild(profit);

      var margin = document.createElement("span");
      margin.className = "ps-market-margin" + (item.result.margin < 0 ? " is-negative" : "");
      margin.textContent = "%" + decimal.format(item.result.margin) + " marj";
      card.appendChild(margin);

      var editor = document.createElement("div");
      editor.className = "ps-scenario";
      editor.appendChild(labelledMini(item.key, "salePrice", "Satış fiyatı", item.scenario.salePrice, "₺"));
      editor.appendChild(labelledMini(item.key, "commissionRate", "Komisyon", item.scenario.commissionRate, "%"));
      editor.appendChild(labelledMini(item.key, "shipping", "Kargo", item.scenario.shipping, "₺"));
      editor.appendChild(labelledMini(item.key, "generalExpense", "Genel gider", item.scenario.generalExpense, "₺"));

      var adWrap = document.createElement("div");
      adWrap.className = "ps-scenario-ad";
      var adLabel = document.createElement("span");
      adLabel.textContent = "Reklam";
      adWrap.appendChild(adLabel);

      var toggle = document.createElement("div");
      toggle.className = "ps-mini-toggle";
      ["percent", "fixed"].forEach(function (mode) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = mode === "percent" ? "%" : "₺";
        button.setAttribute("aria-pressed", item.scenario.adMode === mode ? "true" : "false");
        button.setAttribute("aria-label", MARKETS[item.key].name + " reklam " + (mode === "percent" ? "yüzde" : "sabit TL"));
        button.addEventListener("click", function () {
          state.scenarios[item.key].adMode = mode;
          renderCompare();
        });
        toggle.appendChild(button);
      });
      adWrap.appendChild(toggle);
      adWrap.appendChild(
        miniInput(
          item.key,
          item.scenario.adMode === "percent" ? "adRate" : "adFixed",
          item.scenario.adMode === "percent" ? item.scenario.adRate : item.scenario.adFixed,
          item.scenario.adMode === "percent" ? "%" : "₺"
        )
      );
      editor.appendChild(adWrap);
      card.appendChild(editor);

      var metrics = document.createElement("div");
      metrics.className = "ps-mini-metrics";
      [
        ["Komisyon", money.format(item.result.commission)],
        ["Toplam maliyet", money.format(item.result.totalCost)],
        ["Hedef fiyat", money.format(targetPrice(item.scenario))]
      ].forEach(function (pair) {
        var row = document.createElement("div");
        var name = document.createElement("span");
        name.textContent = pair[0];
        var value = document.createElement("strong");
        value.textContent = pair[1];
        row.appendChild(name);
        row.appendChild(value);
        metrics.appendChild(row);
      });
      card.appendChild(metrics);

      var use = document.createElement("button");
      use.type = "button";
      use.textContent = "Bu kanalla hesapla →";
      use.addEventListener("click", function () {
        state.inputs = clone(state.scenarios[item.key]);
        syncFields();
        renderResult();
        setView("hesapla");
      });
      card.appendChild(use);

      compareGrid.appendChild(card);
    });

    if (keepFocus) {
      var parts = keepFocus.split(":");
      var index = COMPARE_ORDER.indexOf(parts[0]);
      if (index !== -1) {
        var card = compareGrid.children[index];
        var target = card && card.querySelector('input[aria-label$="' + parts[1] + '"]');
        if (target) {
          target.focus();
          var length = target.value.length;
          try {
            target.setSelectionRange(length, length);
          } catch (error) {
            /* number input bazı tarayıcılarda setSelectionRange desteklemez */
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Kayıtlı ürünler
   * ------------------------------------------------------------------ */
  var productsBody = el("[data-ps-products]");
  var emptyState = el("[data-ps-empty]");
  var tableWrap = el("[data-ps-table-wrap]");

  function persist(items) {
    state.saved = items;
    writeStorage(STORAGE_PRODUCTS, JSON.stringify(items));
    renderProducts();
    updateCounts();
  }

  function saveProduct() {
    var item = clone(state.inputs);
    item.id =
      window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2);
    item.savedAt = new Date().toISOString();
    persist([item].concat(state.saved).slice(0, MAX_PRODUCTS));
    flash("Ürün cihazına kaydedildi");
  }

  function loadProduct(item) {
    var data = clone(item);
    delete data.id;
    delete data.savedAt;
    state.inputs = data;
    MARKET_ORDER.forEach(function (market) {
      if (market === data.market) {
        state.scenarios[market] = clone(data);
      } else {
        state.scenarios[market].productName = data.productName;
        state.scenarios[market].sku = data.sku;
      }
    });
    syncFields();
    renderResult();
    setView("hesapla");
    flash("Ürün hesaplamaya yüklendi");
  }

  function renderProducts() {
    if (!productsBody) return;
    var hasItems = state.saved.length > 0;
    if (emptyState) emptyState.hidden = hasItems;
    if (tableWrap) tableWrap.hidden = !hasItems;

    productsBody.innerHTML = "";
    state.saved.forEach(function (item) {
      var result = calculate(item);
      var market = MARKETS[item.market] || MARKETS.diger;
      var tr = document.createElement("tr");

      var nameCell = document.createElement("td");
      var strong = document.createElement("strong");
      strong.textContent = item.productName || "İsimsiz ürün";
      var small = document.createElement("small");
      small.textContent = item.sku || "SKU yok";
      nameCell.appendChild(strong);
      nameCell.appendChild(small);
      tr.appendChild(nameCell);

      var marketCell = document.createElement("td");
      var marketWrap = document.createElement("span");
      marketWrap.className = "ps-table-market";
      marketWrap.appendChild(badge(item.market in MARKETS ? item.market : "diger"));
      marketWrap.appendChild(document.createTextNode(market.name));
      marketCell.appendChild(marketWrap);
      tr.appendChild(marketCell);

      var saleCell = document.createElement("td");
      saleCell.textContent = money.format(item.salePrice);
      tr.appendChild(saleCell);

      var profitCell = document.createElement("td");
      profitCell.className = result.profit < 0 ? "ps-negative" : "ps-positive";
      profitCell.textContent = money.format(result.profit);
      tr.appendChild(profitCell);

      var marginCell = document.createElement("td");
      marginCell.textContent = "%" + decimal.format(result.margin);
      tr.appendChild(marginCell);

      var actions = document.createElement("td");
      actions.className = "ps-row-actions";
      var open = document.createElement("button");
      open.type = "button";
      open.textContent = "Aç";
      open.addEventListener("click", function () {
        loadProduct(item);
      });
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ps-delete";
      remove.textContent = "Sil";
      remove.setAttribute("aria-label", (item.productName || "Ürün") + " kaydını sil");
      remove.addEventListener("click", function () {
        persist(
          state.saved.filter(function (row) {
            return row.id !== item.id;
          })
        );
      });
      actions.appendChild(open);
      actions.appendChild(remove);
      tr.appendChild(actions);

      productsBody.appendChild(tr);
    });
  }

  function updateCounts() {
    out("saved-count", String(state.saved.length));
  }

  /* ------------------------------------------------------------------ *
   * Görünüm değiştirme ve kayıt kapısı
   * ------------------------------------------------------------------ */
  function setView(view) {
    state.view = view;
    els("[data-ps-view]").forEach(function (node) {
      node.hidden = node.getAttribute("data-ps-view") !== view;
    });
    els("[data-ps-tab]").forEach(function (tab) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-ps-tab") === view ? "true" : "false");
    });
    if (view === "karsilastir") renderCompare();
    if (view === "urunler") renderProducts();
  }

  var modalBackdrop = el("[data-ps-modal]");
  var modalForm = el("[data-ps-register-form]");
  var modalError = el("[data-ps-register-error]");
  var modalSubmit = modalForm ? el('button[type="submit"]', modalForm) : null;
  var lastFocused = null;

  function openModal(action) {
    state.pendingAction = action;
    if (modalError) {
      modalError.hidden = true;
      modalError.textContent = "";
    }
    if (!modalBackdrop) return;
    lastFocused = document.activeElement;
    modalBackdrop.hidden = false;
    document.body.classList.add("menu-open");
    var firstInput = el('input[name="contact"]', modalBackdrop);
    if (firstInput) firstInput.focus();
  }

  function closeModal() {
    if (!modalBackdrop) return;
    modalBackdrop.hidden = true;
    document.body.classList.remove("menu-open");
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function runProtected(action) {
    if (state.registered) {
      if (action === "save") saveProduct();
      else setView(action);
      return;
    }
    openModal(action);
  }

  function bindGate() {
    els("[data-ps-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var view = tab.getAttribute("data-ps-tab");
        if (view === "hesapla") setView("hesapla");
        else runProtected(view);
      });
    });

    els("[data-ps-protected]").forEach(function (button) {
      button.addEventListener("click", function () {
        runProtected(button.getAttribute("data-ps-protected"));
      });
    });

    els("[data-ps-goto]").forEach(function (button) {
      button.addEventListener("click", function () {
        setView(button.getAttribute("data-ps-goto"));
      });
    });

    if (modalBackdrop) {
      modalBackdrop.addEventListener("mousedown", function (event) {
        if (event.target === modalBackdrop) closeModal();
      });
      els("[data-ps-modal-close]", modalBackdrop).forEach(function (button) {
        button.addEventListener("click", closeModal);
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !modalBackdrop.hidden) closeModal();
      });
    }

    if (modalForm) {
      modalForm.addEventListener("submit", function (event) {
        event.preventDefault();
        register();
      });
    }
  }

  function showRegisterError(message) {
    if (!modalError) return;
    modalError.textContent = message;
    modalError.hidden = false;
  }

  function completeRegistration(id, storeName) {
    writeStorage(STORAGE_REGISTRATION, JSON.stringify({ id: id, storeName: storeName }));
    state.registered = true;
    closeModal();
    flash("Ücretsiz hesabın hazır");
    if (state.pendingAction === "save") saveProduct();
    else setView(state.pendingAction);
    els(".ps-free").forEach(function (node) {
      node.remove();
    });
  }

  function register() {
    if (!modalForm) return;
    var contact = (el('input[name="contact"]', modalForm) || {}).value || "";
    var storeName = (el('input[name="storeName"]', modalForm) || {}).value || "";
    var honey = (el('input[name="website"]', modalForm) || {}).value || "";
    var consent = el('input[name="consent"]', modalForm);

    if (!consent || !consent.checked) {
      showRegisterError("Devam etmek için aydınlatma metnini onayla.");
      return;
    }

    if (modalError) modalError.hidden = true;
    if (modalSubmit) {
      modalSubmit.disabled = true;
      modalSubmit.textContent = "Hesabın hazırlanıyor...";
    }

    fetch(registerEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: contact, storeName: storeName, website: honey })
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (payload) {
            if (!response.ok || !payload.id) {
              throw new Error(payload.error || "Kayıt tamamlanamadı.");
            }
            return payload;
          });
      })
      .then(function (payload) {
        completeRegistration(payload.id, storeName.trim());
      })
      .catch(function (error) {
        showRegisterError(error && error.message ? error.message : "Kayıt tamamlanamadı.");
      })
      .then(function () {
        if (modalSubmit) {
          modalSubmit.disabled = false;
          modalSubmit.textContent = "Ücretsiz devam et →";
        }
      });
  }

  /* ------------------------------------------------------------------ *
   * Başlangıç
   * ------------------------------------------------------------------ */
  if (!gateEnabled || state.registered) {
    els(".ps-free").forEach(function (node) {
      node.remove();
    });
  }

  bindCalcView();
  bindGate();
  syncFields();
  renderResult();
  renderProducts();
  updateCounts();
  setView("hesapla");

  // Adresteki #karsilastir / #urunler ile doğrudan ilgili görünüme açılabilir.
  // Kayıt kapısı burada da geçerlidir.
  (function openFromHash() {
    var hash = (window.location.hash || "").replace("#", "");
    if (hash === "karsilastir" || hash === "urunler") runProtected(hash);
  })();
})();
