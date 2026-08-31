/*
 * Three Point Digital — site.js
 * Bağımlılıksız vanilla JS. İçerik JavaScript olmadan da tam okunabilir;
 * buradaki kod yalnızca etkileşim ekler.
 *
 *   1) Mobil menü (aria-expanded, Escape, dışarı tıklama)
 *      + kaydırmada sıkışan yapışkan başlık
 *      + masaüstü "Pazaryerleri" açılır menüsü
 *   2) Ana sayfadaki kompakt kârlılık hesaplayıcı
 *      Hesaplama motoru, /e-ticaret-karlilik-hesaplama sayfasındaki Kârlılık
 *      Merkezi ile birebir aynıdır (assets/profit-studio.js → calculate).
 *   3) İletişim formu → /api/iletisim (veritabanı)
 *   4) Footer yılı
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1) Mobil menü
   * ------------------------------------------------------------------ */
  function initNav() {
    var toggle = document.querySelector("[data-menu-toggle]");
    var menu = document.querySelector("[data-mobile-menu]");
    if (!toggle || !menu) return;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
      menu.classList.toggle("open", open);
      document.body.classList.toggle("menu-open", open);
    }

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setOpen(false);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        toggle.focus();
      }
    });

    // Masaüstüne geçişte açık kalan menüyü kapat
    if (window.matchMedia) {
      var mq = window.matchMedia("(min-width: 981px)");
      var onChange = function (event) {
        if (event.matches) setOpen(false);
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* ------------------------------------------------------------------ *
   * 1a) Yapışkan başlık: sayfa kaydıkça sıkışır
   *
   * Başlık CSS'te zaten `position: sticky`. Burada yalnızca kaydırma
   * durumunu sınıfa çeviriyoruz; yükseklik de mobil menünün üst konumu
   * için --header-h değişkenine yazılıyor.
   * ------------------------------------------------------------------ */
  function initStickyHeader() {
    var header = document.querySelector(".site-header");
    if (!header) return;

    var ticking = false;

    function syncHeight() {
      document.documentElement.style.setProperty(
        "--header-h",
        Math.round(header.getBoundingClientRect().height) + "px"
      );
    }

    function update() {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
      syncHeight();
      ticking = false;
    }

    window.addEventListener(
      "scroll",
      function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
      },
      { passive: true }
    );

    window.addEventListener("resize", syncHeight);
    update();
  }

  /* ------------------------------------------------------------------ *
   * 1b) Masaüstü "Pazaryerleri" açılır menüsü
   *
   * Açılma/kapanma CSS tarafında :hover ve :focus-within ile de çalışır;
   * buradaki kod dokunmatik ekran ve klavye için tıklamayla açmayı ekler.
   * ------------------------------------------------------------------ */
  function initDropdown() {
    var item = document.querySelector("[data-nav-dropdown]");
    var trigger = item && item.querySelector("[data-nav-trigger]");
    if (!item || !trigger) return;

    function setOpen(open) {
      item.classList.toggle("open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    }

    trigger.addEventListener("click", function (event) {
      event.preventDefault();
      setOpen(trigger.getAttribute("aria-expanded") !== "true");
    });

    document.addEventListener("click", function (event) {
      if (!item.contains(event.target)) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (trigger.getAttribute("aria-expanded") !== "true") return;
      setOpen(false);
      trigger.focus();
    });

    // Panel içindeki son bağlantıdan Tab ile çıkınca menü kapanır
    item.addEventListener("focusout", function (event) {
      if (!item.contains(event.relatedTarget)) setOpen(false);
    });
  }

  /* ------------------------------------------------------------------ *
   * 2) Kârlılık hesaplayıcı
   * ------------------------------------------------------------------ */
  var COST_KEYS = ["purchase", "commission", "shipping", "advertising", "general", "withholding", "profit"];
  var COST_LABELS = {
    purchase: "Ürün maliyeti",
    commission: "Komisyon",
    shipping: "Kargo",
    advertising: "Reklam",
    general: "Genel gider",
    withholding: "Stopaj",
    profit: "Net kâr"
  };
  var COST_COLORS = {
    purchase: "#378add",
    commission: "#e24b4a",
    shipping: "#ba7517",
    advertising: "#639922",
    general: "#c2691f",
    withholding: "#8c50b4",
    profit: "#2fa877"
  };

  var tlFormat = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  // Kârlılık Merkezi ile aynı hane sayısı; iki sayfa aynı değeri göstermeli.
  var pctFormat = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function money(value) {
    if (!isFinite(value)) value = 0;
    return (value < 0 ? "-" : "") + tlFormat.format(Math.abs(value)) + " ₺";
  }

  function percent(value) {
    if (!isFinite(value)) value = 0;
    return (value >= 0 ? "+" : "-") + pctFormat.format(Math.abs(value)) + "%";
  }

  /*
   * Hesaplama motoru — /e-ticaret-karlilik-hesaplama sayfasındaki Kârlılık Merkezi
   * ile birebir aynıdır (bkz. assets/profit-studio.js → calculate). Ana sayfadaki
   * kompakt hesaplayıcı ile araç sayfası aynı ürün için aynı sonucu vermelidir.
   * Kargo, genel gider, komisyon ve reklam hizmet bedellerinde KDV %20 kabul edilir.
   */
  function compute(values) {
    var sale = Math.max(0, values.sale || 0);
    var purchase = Math.max(0, values.purchase || 0);
    var vatFactor = Math.max(0, values.vat || 0) / 100;
    var expenseVat = 0.2;
    var netSale = vatFactor ? sale / (1 + vatFactor) : sale;
    var netPurchase = vatFactor ? purchase / (1 + vatFactor) : purchase;
    var shippingNet = (values.shipping || 0) / (1 + expenseVat);
    var generalNet = (values.general || 0) / (1 + expenseVat);
    var commission = sale * ((values.commission || 0) / 100);
    var advertising = sale * ((values.advertising || 0) / 100);
    var withholding = netSale * ((values.withholding || 0) / 100);
    var serviceFee = 0;

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
    var shippingVat = (values.shipping || 0) - shippingNet;
    var generalVat = (values.general || 0) - generalNet;
    var serviceVat = (commission + advertising) * expenseVat;
    var payableVat = Math.max(0, saleVat - purchaseVat - shippingVat - generalVat - serviceVat);
    var totalCost =
      netPurchase + commission + advertising + shippingNet + generalNet + withholding + serviceFee;

    return {
      netSale: netSale,
      netPurchase: netPurchase,
      netShipping: shippingNet,
      generalNet: generalNet,
      commission: commission,
      advertising: advertising,
      withholding: withholding,
      profit: profit,
      margin: margin,
      payableVat: payableVat,
      totalCost: totalCost
    };
  }

  function initCalculator(root) {
    var fieldNames = [
      "sale",
      "purchase",
      "commission",
      "vat",
      "advertising",
      "shipping",
      "general",
      "withholding"
    ];
    var fields = {};
    fieldNames.forEach(function (name) {
      fields[name] = root.querySelector('[name="' + name + '"]');
    });
    if (!fields.sale) return;

    function readValues() {
      var values = {};
      fieldNames.forEach(function (name) {
        var element = fields[name];
        var parsed = element ? parseFloat(element.value) : 0;
        values[name] = isFinite(parsed) ? parsed : 0;
      });
      return values;
    }

    function setOutput(name, text) {
      root.querySelectorAll('[data-output="' + name + '"]').forEach(function (element) {
        element.textContent = text;
      });
    }

    var bar = root.querySelector("[data-cost-bar]");
    var legend = root.querySelector("[data-cost-legend]");

    function renderBar(result) {
      if (!bar && !legend) return;
      var parts = COST_KEYS.map(function (key) {
        var value =
          key === "purchase"
            ? result.netPurchase
            : key === "shipping"
              ? result.netShipping
              : key === "general"
                ? result.generalNet
                : result[key];
        return { key: key, value: Math.max(0, value || 0) };
      }).filter(function (part) {
        return part.value > 0;
      });
      var total = parts.reduce(function (sum, part) {
        return sum + part.value;
      }, 0);

      if (bar) bar.textContent = "";
      if (legend) legend.textContent = "";
      if (total <= 0) return;

      parts.forEach(function (part) {
        var share = (part.value / total) * 100;
        if (bar) {
          var segment = document.createElement("span");
          segment.style.flex = String(share);
          segment.style.background = COST_COLORS[part.key];
          segment.title = COST_LABELS[part.key] + ": " + money(part.value);
          bar.appendChild(segment);
        }
        if (legend) {
          var item = document.createElement("span");
          var dot = document.createElement("i");
          dot.style.background = COST_COLORS[part.key];
          item.appendChild(dot);
          item.appendChild(
            document.createTextNode(COST_LABELS[part.key] + " %" + pctFormat.format(share))
          );
          legend.appendChild(item);
        }
      });
    }

    function render() {
      var result = compute(readValues());

      setOutput("profit", money(result.profit));
      setOutput("margin", percent(result.margin) + " net kâr oranı");
      setOutput("net-sale", money(result.netSale));
      setOutput("purchase", money(result.netPurchase));
      setOutput("commission", money(result.commission));
      setOutput("advertising", money(result.advertising));
      setOutput("shipping", money(result.netShipping));
      setOutput("general", money(result.generalNet));
      setOutput("withholding", money(result.withholding));
      setOutput("payable-vat", money(result.payableVat));
      setOutput("total-cost", money(result.totalCost));

      var profitElement = root.querySelector('[data-output="profit"]');
      var marginElement = root.querySelector('[data-output="margin"]');
      var isLoss = result.profit < 0;
      if (profitElement) profitElement.classList.toggle("loss", isLoss);
      if (marginElement) marginElement.classList.toggle("loss", isLoss);

      renderBar(result);
      return result;
    }

    root.querySelectorAll("input, select").forEach(function (element) {
      element.addEventListener("input", render);
      element.addEventListener("change", render);
    });

    render();
  }

  /* ------------------------------------------------------------------ *
   * 3) İletişim formu → /api/iletisim
   * ------------------------------------------------------------------ */
  function initContactForm() {
    var form = document.querySelector("[data-contact-form]");
    if (!form) return;

    var status = form.querySelector("[data-form-status]");
    var button = form.querySelector('button[type="submit"]');

    function showStatus(message, state) {
      if (!status) return;
      status.textContent = message;
      status.setAttribute("data-state", state);
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      if (!form.checkValidity()) {
        form.reportValidity();
        showStatus("Lütfen zorunlu alanları eksiksiz doldurun.", "error");
        return;
      }

      // Bot tuzağı doluysa sessizce başarı gösterip isteği göndermeyiz.
      var honey = form.querySelector('[name="_honey"]');
      if (honey && honey.value) {
        showStatus("Mesajınız alındı.", "ok");
        form.reset();
        return;
      }

      var data = new FormData(form);

      // Talep kendi sunucumuza gider, oradan veritabanına yazılır ve /admin
      // panelinde listelenir. E-posta gönderimi yoktur.
      var lead = {
        name: data.get("name") || "",
        brand: data.get("brand") || "",
        email: data.get("email") || "",
        phone: data.get("phone") || "",
        marketplace: data.get("marketplace") || "",
        revenue: data.get("revenue") || "",
        message: data.get("message") || "",
        page: window.location.href
      };

      var originalLabel = button ? button.textContent : "";
      if (button) {
        button.disabled = true;
        button.textContent = "Gönderiliyor…";
      }
      showStatus("Gönderiliyor…", "pending");

      function json(url, payload) {
        return fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload)
        }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (result) {
            return { ok: response.ok, status: response.status, data: result };
          });
        });
      }

      function basarili() {
        form.reset();
        showStatus(
          "Teşekkürler, talebiniz bize ulaştı. 1 iş günü içinde dönüş yapacağız.",
          "ok"
        );
      }

      json("/api/iletisim", lead)
        .then(function (r) {
          if (r.ok) return basarili();
          // 400: kullanıcının doldurduğu alanlarda sorun var, mesajı göster.
          if (r.status === 400 && r.data && r.data.error) {
            showStatus(r.data.error, "error");
            return;
          }
          throw new Error("gonderilemedi");
        })
        .catch(function () {
          showStatus(
            "Form gönderilemedi. Lütfen tekrar deneyin veya info@threepointdigital.com adresine yazın.",
            "error"
          );
        })
        .then(function () {
          if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
          }
        });
    });
  }

  /* ------------------------------------------------------------------ *
   * 4) WhatsApp yüzen buton
   * ------------------------------------------------------------------ */
  function initWhatsAppButton() {
    if (document.querySelector(".whatsapp-float")) return;

    var phone = "905350557849";
    var message = "Merhaba, Hizmetleriniz hakkında bilgi almak istiyorum.";
    var link = document.createElement("a");
    link.className = "whatsapp-float";
    link.href = "https://wa.me/" + phone + "?text=" + encodeURIComponent(message);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "WhatsApp üzerinden bize yazın");
    link.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.868-2.03-.967-.273-.099-.472-.148-.67.15-.198.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"></path><path d="M12.001 2C6.478 2 2 6.477 2 12c0 1.892.526 3.66 1.438 5.168L2 22l4.963-1.416A9.945 9.945 0 0 0 12.001 22C17.524 22 22 17.523 22 12S17.524 2 12.001 2zm0 18.056a8.026 8.026 0 0 1-4.377-1.291l-.314-.196-3.176.906.911-3.104-.207-.323A8.02 8.02 0 0 1 3.944 12c0-4.444 3.613-8.057 8.057-8.057 4.444 0 8.057 3.613 8.057 8.057 0 4.444-3.613 8.056-8.057 8.056z"></path></svg>';
    document.body.appendChild(link);
  }

  /* ------------------------------------------------------------------ *
   * 5) Başlangıç
   * ------------------------------------------------------------------ */
  function init() {
    initNav();
    initStickyHeader();
    initDropdown();
    document.querySelectorAll("[data-calculator]").forEach(initCalculator);
    initContactForm();
    initWhatsAppButton();
    document.querySelectorAll("[data-current-year]").forEach(function (element) {
      element.textContent = String(new Date().getFullYear());
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
