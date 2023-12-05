const { defineConfig } = require("cypress");
const { webserver_port } = require("../../sites/common_site_config.json");

module.exports = defineConfig({
  e2e: {
    baseUrl: `http://wiki.test:${webserver_port}`,
    projectId: "w2jgcb",
    adminPassword: "admin",
    viewportWidth: 1100,
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
    retries: {
      runMode: 2,
      openMode: 0,
    },
  },
});
