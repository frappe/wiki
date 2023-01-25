const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    projectId: "y1k5pn",
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
    retries: {
      runMode: 2,
      openMode: 0,
    },
  },
});
