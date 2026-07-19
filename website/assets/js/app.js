(function () {
  "use strict";

  var config = window.EDITIO_CONFIG || {};
  var translations = window.EDITIO_TRANSLATIONS || {};
  var storageKey = "editio-site-language";

  function readStoredLanguage() {
    try {
      return window.localStorage.getItem(storageKey);
    } catch (_error) {
      return null;
    }
  }

  function writeStoredLanguage(language) {
    try {
      window.localStorage.setItem(storageKey, language);
    } catch (_error) {
      // The site remains fully usable when storage is blocked.
    }
  }

  function getValue(object, path) {
    return path.split(".").reduce(function (value, key) {
      return value && value[key] !== undefined ? value[key] : undefined;
    }, object);
  }

  function preferredLanguage() {
    var stored = readStoredLanguage();
    if (stored && translations[stored]) return stored;
    return String(window.navigator.language || "tr").toLowerCase().startsWith("en") ? "en" : "tr";
  }

  function updateMetadata(language) {
    var page = document.body.dataset.page || "home";
    var meta = getValue(translations[language], "meta." + page);
    if (!meta) return;

    document.title = meta.title;
    document.querySelectorAll('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]').forEach(function (element) {
      element.setAttribute("content", meta.description);
    });
    document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach(function (element) {
      element.setAttribute("content", meta.title);
    });
    var locale = document.querySelector('meta[property="og:locale"]');
    if (locale) locale.setAttribute("content", language === "en" ? "en_US" : "tr_TR");
  }

  function applyLanguage(language) {
    var dictionary = translations[language] || translations.tr;
    document.documentElement.lang = language;
    document.documentElement.dataset.lang = language;

    document.querySelectorAll("[data-i18n]").forEach(function (element) {
      var value = getValue(dictionary, element.dataset.i18n);
      if (typeof value === "string") element.textContent = value;
    });

    document.querySelectorAll("[data-i18n-aria]").forEach(function (element) {
      var value = getValue(dictionary, element.dataset.i18nAria);
      if (typeof value === "string") element.setAttribute("aria-label", value);
    });

    document.querySelectorAll("[data-i18n-alt]").forEach(function (element) {
      var value = getValue(dictionary, element.dataset.i18nAlt);
      if (typeof value === "string") element.setAttribute("alt", value);
    });

    document.querySelectorAll("[data-language]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.language === language));
    });

    updateMetadata(language);
    updateAppStoreLinks(language);
    updateSupportDynamicText(dictionary);
    writeStoredLanguage(language);
  }

  function updateSupportDynamicText(dictionary) {
    var fileName = document.querySelector("[data-support-file-name]");
    if (fileName && fileName.dataset.fileSelected !== "true") {
      fileName.textContent = dictionary.support ? dictionary.support.noAttachment : "";
    }
  }

  function updateAppStoreLinks(language) {
    var available = Boolean(config.appStoreUrl);
    var dictionary = translations[language] || translations.tr;
    document.querySelectorAll("[data-app-store-link]").forEach(function (link) {
      if (!link.dataset.appStoreFallback) {
        link.dataset.appStoreFallback = link.getAttribute("href") || "#app-store";
      }
      link.textContent = available ? dictionary.common.appStore : dictionary.common.appStoreSoon;
      link.setAttribute("href", available ? config.appStoreUrl : link.dataset.appStoreFallback);
      link.setAttribute("aria-disabled", String(!available));
      if (available) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      } else {
        link.removeAttribute("target");
        link.removeAttribute("rel");
      }
    });
  }

  function updateConfigValues() {
    var email = config.supportEmail || "support@example.com";
    document.querySelectorAll("[data-support-email]").forEach(function (element) {
      element.textContent = email;
      if (element.tagName === "A") element.setAttribute("href", "mailto:" + email);
    });
  }

  function setupMenu() {
    var button = document.querySelector("[data-menu-toggle]");
    var navigation = document.querySelector("[data-site-nav]");
    if (!button || !navigation) return;

    function closeMenu() {
      button.setAttribute("aria-expanded", "false");
      navigation.classList.remove("is-open");
      document.body.classList.remove("menu-open");
    }

    button.addEventListener("click", function () {
      var opening = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(opening));
      navigation.classList.toggle("is-open", opening);
      document.body.classList.toggle("menu-open", opening);
    });

    navigation.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMenu);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeMenu();
    });
  }

  function setupHeader() {
    var header = document.querySelector("[data-site-header]");
    if (!header) return;
    var update = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  function setupReveals() {
    var elements = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    if (!("IntersectionObserver" in window)) {
      elements.forEach(function (element) { element.classList.add("is-visible"); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
    elements.forEach(function (element) { observer.observe(element); });
  }

  function setupFaq() {
    var items = document.querySelectorAll(".faq-item");
    items.forEach(function (item) {
      item.addEventListener("toggle", function () {
        if (!item.open) return;
        items.forEach(function (other) {
          if (other !== item) other.removeAttribute("open");
        });
      });
    });
  }

  function setupPhoneCarousel() {
    var carousel = document.querySelector("[data-phone-carousel]");
    var slides = Array.prototype.slice.call(document.querySelectorAll("[data-phone-slide]"));
    var dots = Array.prototype.slice.call(document.querySelectorAll("[data-phone-dot]"));
    var previous = document.querySelector("[data-phone-previous]");
    var next = document.querySelector("[data-phone-next]");
    if (!carousel || slides.length < 2 || !dots.length || !previous || !next) return;

    var activeIndex = 0;
    var autoplayTimer = 0;
    var resumeTimer = 0;
    var scrollFrame = 0;
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function normalizedIndex(index) {
      return (index + slides.length) % slides.length;
    }

    function updatePagination(index) {
      activeIndex = normalizedIndex(index);
      dots.forEach(function (dot, dotIndex) {
        dot.setAttribute("aria-current", String(dotIndex === activeIndex));
      });
    }

    function scrollToSlide(index, behavior) {
      var targetIndex = normalizedIndex(index);
      var left = carousel.clientWidth * targetIndex;
      updatePagination(targetIndex);
      if (typeof carousel.scrollTo === "function") {
        carousel.scrollTo({ left: left, behavior: reduceMotion.matches ? "auto" : behavior });
      } else {
        carousel.scrollLeft = left;
      }
    }

    function stopAutoplay() {
      window.clearInterval(autoplayTimer);
      window.clearTimeout(resumeTimer);
      autoplayTimer = 0;
      resumeTimer = 0;
    }

    function startAutoplay() {
      stopAutoplay();
      if (reduceMotion.matches || document.hidden) return;
      autoplayTimer = window.setInterval(function () {
        scrollToSlide(activeIndex + 1, "smooth");
      }, 4600);
    }

    function resumeAutoplayLater() {
      stopAutoplay();
      if (reduceMotion.matches) return;
      resumeTimer = window.setTimeout(startAutoplay, 6500);
    }

    function selectFromControl(index) {
      scrollToSlide(index, "smooth");
      resumeAutoplayLater();
    }

    carousel.addEventListener("scroll", function () {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(function () {
        scrollFrame = 0;
        if (!carousel.clientWidth) return;
        updatePagination(Math.round(carousel.scrollLeft / carousel.clientWidth));
      });
    }, { passive: true });

    carousel.addEventListener("pointerdown", stopAutoplay, { passive: true });
    carousel.addEventListener("pointerup", resumeAutoplayLater, { passive: true });
    carousel.addEventListener("pointercancel", resumeAutoplayLater, { passive: true });
    carousel.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      selectFromControl(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
    });

    previous.addEventListener("click", function () { selectFromControl(activeIndex - 1); });
    next.addEventListener("click", function () { selectFromControl(activeIndex + 1); });
    dots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        selectFromControl(Number(dot.dataset.phoneDot || 0));
      });
    });

    window.addEventListener("resize", function () {
      scrollToSlide(activeIndex, "auto");
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopAutoplay();
      else startAutoplay();
    });
    reduceMotion.addEventListener?.("change", startAutoplay);

    updatePagination(0);
    startAutoplay();
  }

  function setupSupportForm() {
    var dialog = document.querySelector("[data-support-dialog]");
    var form = document.querySelector("[data-support-form]");
    var fileInput = document.querySelector("[data-support-file]");
    var fileName = document.querySelector("[data-support-file-name]");
    var status = document.querySelector("[data-support-status]");
    var submitButton = form && form.querySelector('button[type="submit"]');
    var openButtons = document.querySelectorAll("[data-support-open]");
    var closeButtons = document.querySelectorAll("[data-support-close]");
    var maxAttachmentSize = 10 * 1024 * 1024;

    if (!dialog || !form || !fileInput || !fileName || !status || !submitButton || !openButtons.length) return;

    function dictionary() {
      return translations[document.documentElement.lang] || translations.tr;
    }

    function setStatus(message, type) {
      status.textContent = message || "";
      status.dataset.type = type || "";
    }

    function openDialog() {
      setStatus("", "");
      document.body.classList.add("support-dialog-open");
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      window.setTimeout(function () {
        var firstInput = form.querySelector("input");
        if (firstInput) firstInput.focus();
      }, 80);
    }

    function closeDialog() {
      document.body.classList.remove("support-dialog-open");
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }

    openButtons.forEach(function (button) {
      button.addEventListener("click", openDialog);
    });

    closeButtons.forEach(function (button) {
      button.addEventListener("click", closeDialog);
    });

    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeDialog();
    });

    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeDialog();
    });

    dialog.addEventListener("close", function () {
      document.body.classList.remove("support-dialog-open");
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (file) {
        fileName.dataset.fileSelected = "true";
        fileName.textContent = file.name;
      } else {
        delete fileName.dataset.fileSelected;
        fileName.textContent = dictionary().support.noAttachment;
      }
      setStatus("", "");
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var copy = dictionary().support;
      var firstInvalid = form.querySelector(":invalid");
      if (firstInvalid) {
        setStatus(firstInvalid.type === "email" ? copy.invalidEmail : copy.requiredFields, "error");
        firstInvalid.focus();
        return;
      }

      var file = fileInput.files && fileInput.files[0];
      if (file && file.size > maxAttachmentSize) {
        setStatus(copy.fileTooLarge, "error");
        fileInput.focus();
        return;
      }

      var data = new FormData(form);
      var endpoint = String(config.apiBaseUrl || "").replace(/\/+$/, "") + "/support/requests";
      var controller = new AbortController();
      var timeout = window.setTimeout(function () { controller.abort(); }, 30000);

      submitButton.disabled = true;
      submitButton.textContent = copy.sending;
      setStatus(copy.sending, "info");

      try {
        var response = await window.fetch(endpoint, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: data,
          signal: controller.signal
        });
        var rawBody = await response.text();
        var body = null;
        if (rawBody) {
          try {
            body = JSON.parse(rawBody);
          } catch (_error) {
            body = rawBody;
          }
        }

        if (!response.ok) {
          var errorCode = body && typeof body === "object" ? body.code : "";
          setStatus(errorCode === "SUPPORT_RATE_LIMITED" ? copy.rateLimited : copy.sendFailed, "error");
          return;
        }

        form.reset();
        delete fileName.dataset.fileSelected;
        fileName.textContent = copy.noAttachment;
        setStatus(copy.sent, "success");
      } catch (_error) {
        setStatus(copy.networkError, "error");
      } finally {
        window.clearTimeout(timeout);
        submitButton.disabled = false;
        submitButton.textContent = dictionary().support.sendButton;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var language = preferredLanguage();
    document.querySelectorAll("[data-language]").forEach(function (button) {
      button.addEventListener("click", function () {
        applyLanguage(button.dataset.language || "tr");
      });
    });
    updateConfigValues();
    setupMenu();
    setupHeader();
    setupReveals();
    setupFaq();
    setupPhoneCarousel();
    setupSupportForm();
    applyLanguage(language);
  });
})();
