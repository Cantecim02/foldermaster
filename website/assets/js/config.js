window.EDITIO_CONFIG = Object.freeze({
  siteUrl: "https://editioapp.com",
  apiBaseUrl: ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://127.0.0.1:4000"
    : "https://api.editioapp.com",
  appStoreUrl: "",
  supportEmail: "editioapp@gmail.com"
});
