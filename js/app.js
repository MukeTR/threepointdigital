/*
 * Three Point Digital — site etkileşimleri (vanilla JS)
 * Orijinal Next.js paketi statik olarak servis edildiğinde çalışmadığı için
 * şu davranışlar burada, bağımsız ve bakımı kolay şekilde yeniden yazıldı:
 *   1) Scroll ile beliren (.reveal) animasyonları
 *   2) Mobil navigasyon menüsü aç/kapa
 *   3) E-Ticaret Karlılık Hesaplayıcı (orijinal KDV/kâr formülüyle birebir)
 *   4) İletişim formu (backend yok → başarı mesajı gösterir)
 */
(function () {
  'use strict';

  /* ---------- 1) Reveal on scroll ---------- */
  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 2) Mobil nav toggle ---------- */
  function initNav() {
    var toggle = document.getElementById('navToggle');
    var links = document.getElementById('navLinks');
    if (!toggle || !links) return;

    function setOpen(open) {
      toggle.classList.toggle('open', open);
      links.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    toggle.addEventListener('click', function () {
      setOpen(!links.classList.contains('open'));
    });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });
  }

  /* ---------- 3) Karlılık hesaplayıcı ---------- */
  var BAR_COLORS = ['#378ADD', '#E24B4A', '#BA7517', '#639922', '#8C50B4', '#888780'];
  var BAR_LABELS = ['Alış maliyeti', 'Komisyon', 'Kargo', 'Reklam', 'Stopaj', 'Kâr'];

  function fmtTL(n) {
    return (n < 0 ? '-' : '') +
      Math.abs(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
  }
  function fmtPct(n) {
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  // Orijinal paketten birebir alınan hesaplama.
  function compute(v) {
    var satis = parseFloat(v.satis) || 0;
    var alis = parseFloat(v.alis) || 0;
    var kom = parseFloat(v.komisyon) || 0;
    var kdv = parseFloat(v.kdv) || 0;
    var reklam = parseFloat(v.reklam) || 0;
    var kargo = parseFloat(v.kargo) || 0;

    var t = kdv / 100;
    var netS = kdv > 0 ? satis / (1 + t) : satis;   // net satış (KDV hariç)
    var netA = kdv > 0 ? alis / (1 + t) : alis;      // net alış (KDV hariç)
    var kargoNet = kargo / 1.2;                       // kargo KDV'si sabit %20
    var satKDV = satis - netS;
    var aliKDV = alis - netA;
    var karKDV = kargo - kargoNet;                    // kargodan oluşan KDV
    var komTutar = (kom / 100) * satis;
    var komKDV = 0.2 * komTutar;
    var rekTutar = (reklam / 100) * satis;
    var rekKDV = 0.2 * rekTutar;
    var odenKDV = satKDV - aliKDV - karKDV - komKDV - rekKDV;
    var stopaj = 0.01 * netS;
    var kar = netS - netA - komTutar - kargoNet - rekTutar - stopaj;
    var gider = netA + komTutar + kargoNet + rekTutar + stopaj + Math.max(0, odenKDV);
    var barValues = [
      Math.max(0, netA), Math.max(0, komTutar), Math.max(0, kargoNet),
      Math.max(0, rekTutar), Math.max(0, stopaj), Math.max(0, kar)
    ];

    return {
      kar: kar,
      karO: netS > 0 ? (kar / netS) * 100 : 0,
      netS: netS,
      komTotal: komTutar + komKDV,
      odenKDV: odenKDV,
      gider: gider,
      satKDV: satKDV, aliKDV: aliKDV, karKDV: karKDV, komKDV: komKDV, rekKDV: rekKDV,
      barValues: barValues,
      isProfit: kar >= 0
    };
  }

  function initCalc() {
    var root = document.getElementById('hesaplama');
    if (!root) return;

    var names = ['satis', 'alis', 'komisyon', 'kdv', 'reklam', 'kargo'];
    var inputs = {};
    names.forEach(function (n) { inputs[n] = root.querySelector('[name="' + n + '"]'); });
    if (!inputs.satis) return;

    // Sonuç node'ları (temiz sınıf seçicileri)
    var netKarEl = root.querySelector('.calc-net-value');
    var cardEls = root.querySelectorAll('.calc-stat-value');          // [netS, komTotal, odenKDV, gider]
    var badge = root.querySelector('.calc-badge');
    var barEl = root.querySelector('.calc-bar');
    var legendEl = root.querySelector('.calc-legend');
    var kdvSpans = root.querySelectorAll('.calc-vat-value');          // 6 KDV satırı

    function readValues() {
      return {
        satis: inputs.satis.value, alis: inputs.alis.value, komisyon: inputs.komisyon.value,
        kdv: inputs.kdv.value, reklam: inputs.reklam.value, kargo: inputs.kargo.value
      };
    }

    function render() {
      var r = compute(readValues());

      if (netKarEl) {
        netKarEl.textContent = fmtTL(r.kar);
        netKarEl.style.color = r.isProfit ? 'var(--color-text-success)' : 'var(--color-text-danger)';
      }
      if (badge) {
        badge.textContent = fmtPct(r.karO);
        badge.style.background = r.isProfit ? 'var(--color-background-success)' : 'var(--color-background-danger)';
        badge.style.color = r.isProfit ? 'var(--color-text-success)' : 'var(--color-text-danger)';
      }
      var cardVals = [r.netS, r.komTotal, r.odenKDV, r.gider];
      cardEls.forEach(function (el, i) { if (el) el.textContent = fmtTL(cardVals[i]); });

      var kdvVals = [r.satKDV, r.aliKDV, r.karKDV, r.komKDV, r.rekKDV, r.odenKDV];
      kdvSpans.forEach(function (el, i) { if (el) el.textContent = fmtTL(kdvVals[i]); });

      // Maliyet dağılımı çubuğu + açıklama
      var total = r.barValues.reduce(function (a, b) { return a + b; }, 0);
      if (barEl) barEl.innerHTML = '';
      if (legendEl) legendEl.innerHTML = '';
      if (total > 0) {
        r.barValues.forEach(function (val, i) {
          if (val <= 0) return;
          var pct = (val / total * 100).toFixed(1);
          if (barEl) {
            var seg = document.createElement('div');
            seg.title = BAR_LABELS[i] + ': ' + fmtTL(val);
            seg.style.cssText = 'flex:' + pct + ';background:' + BAR_COLORS[i] + ';min-width:2px';
            barEl.appendChild(seg);
          }
          if (legendEl) {
            var span = document.createElement('span');
            span.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--color-text-secondary)';
            var dot = document.createElement('span');
            dot.style.cssText = 'width:8px;height:8px;border-radius:2px;flex-shrink:0;display:inline-block;background:' + BAR_COLORS[i];
            span.appendChild(dot);
            span.appendChild(document.createTextNode(BAR_LABELS[i] + ': ' + pct + '%'));
            legendEl.appendChild(span);
          }
        });
      }
      return r;
    }

    names.forEach(function (n) {
      inputs[n].addEventListener('input', render);
      inputs[n].addEventListener('change', render);
    });

    // Kaydet / yükle / sil (en fazla 5 senaryo — sayfa oturumu boyunca)
    var saveInput = root.querySelector('.calc-save input');
    var saveBtn = root.querySelector('.calc-save-btn');
    var savedWrap = root.querySelector('.calc-saved');
    var saved = [];
    var idSeq = 1;

    function refreshBtn() {
      if (!saveBtn) return;
      saveBtn.disabled = saved.length >= 5;
      saveBtn.textContent = saved.length >= 5 ? 'Doldu (5)' : 'Kaydet';
    }

    function renderSaved() {
      if (!savedWrap) return;
      savedWrap.innerHTML = '';
      saved.forEach(function (item) {
        var el = document.createElement('div');
        el.className = 'calc-saved-item';
        el.title = 'Yüklemek için tıklayın';

        var top = document.createElement('div');
        top.className = 'cs-top';
        var name = document.createElement('span');
        name.className = 'name';
        name.textContent = item.name;
        var del = document.createElement('button');
        del.className = 'del';
        del.title = 'Sil';
        del.setAttribute('aria-label', 'Sil');
        del.textContent = '×';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          saved = saved.filter(function (s) { return s.id !== item.id; });
          renderSaved(); refreshBtn();
        });
        top.appendChild(name); top.appendChild(del);

        var metrics = document.createElement('div');
        metrics.className = 'cs-metrics';
        var m1 = document.createElement('span');
        m1.innerHTML = 'Net Kâr: ';
        var b1 = document.createElement('b');
        b1.className = 'cs-kar';
        b1.style.color = item.isProfit ? 'var(--color-text-success)' : 'var(--color-text-danger)';
        b1.textContent = item.kar;
        m1.appendChild(b1);
        var m2 = document.createElement('span');
        m2.innerHTML = 'Oran: <b>' + item.karO + '</b>';
        var m3 = document.createElement('span');
        m3.innerHTML = 'Net Satış: <b>' + item.netS + '</b>';
        metrics.appendChild(m1); metrics.appendChild(m2); metrics.appendChild(m3);

        el.appendChild(top); el.appendChild(metrics);
        el.addEventListener('click', function () {
          names.forEach(function (n) { inputs[n].value = item.snapshot[n]; });
          render();
        });
        savedWrap.appendChild(el);
      });
    }

    function doSave() {
      if (saved.length >= 5) return;
      var nm = (saveInput && saveInput.value || '').trim();
      if (!nm) return;
      var r = render();
      saved.push({
        id: idSeq++, name: nm, snapshot: readValues(),
        kar: fmtTL(r.kar), karO: fmtPct(r.karO), netS: fmtTL(r.netS), isProfit: r.isProfit
      });
      if (saveInput) saveInput.value = '';
      renderSaved(); refreshBtn();
    }

    if (saveBtn) saveBtn.addEventListener('click', doSave);
    if (saveInput) saveInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
    });

    render();
  }

  /* ---------- 4) İletişim formu → FormSubmit (e-posta) ---------- */
  var FORM_ENDPOINT = 'https://formsubmit.co/ajax/mkemalkaratas95@gmail.com';
  function initContactForm() {
    var form = document.querySelector('.contact-form');
    if (!form) return;

    var status = document.createElement('p');
    status.className = 'form-status';
    status.style.cssText = 'font-size:1rem;font-weight:500;margin-top:.75rem;display:none';
    form.appendChild(status);

    function showStatus(text, ok) {
      status.textContent = text;
      status.style.color = ok ? '#1a8f4c' : '#c0392b';
      status.style.display = 'block';
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var get = function (name) {
        var el = form.querySelector('[name="' + name + '"]');
        return el ? el.value.trim() : '';
      };
      if (!get('name') || !get('email') || !get('message')) {
        showStatus('Lütfen ad, e-posta ve mesaj alanlarını doldurun.', false);
        return;
      }

      var btn = form.querySelector('.form-submit');
      var btnText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Gönderiliyor…'; }

      fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject: 'Yeni İletişim Formu — threepointdigital.com',
          _template: 'table',
          'Ad': get('name'),
          'Marka': get('brand') || '-',
          'E-posta': get('email'),
          'Platformlar': get('platforms') || '-',
          'Mesaj': get('message')
        })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && (data.success === 'true' || data.success === true)) {
            form.reset();
            showStatus('Mesajınız gönderildi. En kısa sürede size geri döneceğiz!', true);
          } else {
            throw new Error((data && data.message) || 'Gönderim başarısız');
          }
        })
        .catch(function () {
          showStatus('Mesaj gönderilemedi. Lütfen tekrar deneyin veya bize e-posta ile ulaşın.', false);
        })
        .finally(function () {
          if (btn) { btn.disabled = false; btn.textContent = btnText; }
        });
    });
  }

  function init() {
    initReveal();
    initNav();
    initCalc();
    initContactForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
