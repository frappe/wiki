const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
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
