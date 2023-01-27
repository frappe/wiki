context("Wiki Sidebar", () => {
  beforeEach(() => {
    cy.login();
    cy.visit("/wiki");
  });

  it("creates a new wiki sidebar group", () => {
    cy.contains("Edit Page").click();
    cy.get(".add-sidebar-item").click();
    cy.get(".modal-content input").first().clear().type("test-sidebar-route");
    cy.get(".modal-content input").last().clear().type("Test Wiki Sidebar");
    cy.get(".btn-sm.btn-primary").click();
    cy.get(".submit-wiki-page").click();
    cy.get(".input-with-feedback[type='checkbox']").check();
    cy.get(".standard-actions .btn-modal-primary").last().click();

    cy.intercept("/*").as("testWikiSidebar");
    cy.wait("@testWikiSidebar");

    cy.get(".sidebar-group").should("contain", "Test Wiki Sidebar");
  });

  it("deletes a wiki sidebar group", () => {
    cy.contains("Edit Page").click();
    cy.get(
      ".sidebar-group[data-title='Test Wiki Sidebar'] .remove-sidebar-item",
    ).click();
    cy.get(".btn-sm.btn-primary").click();

    cy.intercept("/*").as("testWikiSidebar");
    cy.wait("@testWikiSidebar");

    cy.get(".sidebar-group").should("not.contain", "Test Wiki Sidebar");
  });
});
