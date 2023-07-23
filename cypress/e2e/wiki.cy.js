context("Wiki", () => {
  beforeEach(() => {
    cy.login();
    cy.visit("/wiki");
  });

  it("creates a new wiki page", () => {
    cy.get(".wiki-options .dropdown-toggle").click();
    cy.get(".edit-wiki-btn").click();

    cy.get(".doc-sidebar .sidebar-group:first-child .add-sidebar-page").click();
    cy.get(".wiki-editor .ProseMirror")
      .clear()
      .type("Test Wiki Page{enter}New Wiki Page");
    cy.get('.btn:contains("Save"):visible').click();

    cy.intercept("*/test-wiki-page").as("testWikiPage");
    cy.wait("@testWikiPage");

    cy.get(".sidebar-item.active").should("contain", "Test Wiki Page");
    cy.get(".from-markdown h1").should("contain", "Test Wiki Page");
    cy.get(".from-markdown p").should("contain", "New Wiki Page");
  });

  it("edits a wiki page", () => {
    cy.get(".doc-sidebar").contains("Test Wiki Page").click();

    cy.get(".wiki-options .dropdown-toggle").click();
    cy.get(".edit-wiki-btn").click();

    cy.get(".wiki-editor .ProseMirror")
      .clear()
      .type("Old Wiki Page{enter}Old Wiki Page");
    cy.get('.btn:contains("Save"):visible').click();

    cy.intercept("*/test-wiki-page").as("testWikiPage");
    cy.wait("@testWikiPage");

    cy.get(".sidebar-item.active").should("contain", "Old Wiki Page");
    cy.get(".from-markdown h1").should("contain", "Old Wiki Page");
    cy.get(".from-markdown p").should("contain", "Old Wiki Page");
  });

  it("deletes a wiki page", () => {
    cy.get(".doc-sidebar").contains("Old Wiki Page").click();

    cy.get(".wiki-options .dropdown-toggle").click();
    cy.get(".edit-wiki-btn").click();

    cy.get(".doc-sidebar").contains("Old Wiki Page").parent().next().click();
    cy.contains("Yes").click();

    cy.get(".doc-sidebar .sidebar-item").should("not.contain", "Old Wiki Page");
  });
});
