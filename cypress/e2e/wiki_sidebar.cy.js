context("Wiki Sidebar", () => {
  beforeEach(() => {
    cy.login();
    cy.visit("/wiki");
  });

  it("creates a new wiki sidebar group", () => {
    cy.get(".edit-wiki-btn").click();
    cy.contains("Add Group").click();
    cy.get('input[name="title"]')
      .clear()
      .type("T")
      .clear()
      .type("Test Wiki Sidebar");
    cy.contains("Submit").click();

    cy.get(".doc-sidebar .sidebar-group:last-child .add-sidebar-page").click();
    cy.get(".new-wiki-editor > * > .ProseMirror")
      .clear()
      .type("Test Wiki Page{enter}New Wiki Page");
    cy.get('.btn:contains("Save"):visible').click();

    cy.get(".sidebar-group").should("contain", "Test Wiki Sidebar");
  });

  it("deletes a wiki sidebar group when the group is empty", () => {
    cy.get(".edit-wiki-btn .icon").click();
    cy.contains("Test Wiki Page").parent().next().click();
    cy.get('.btn:contains("Yes"):visible').click();

    cy.intercept("/*").as("testWikiSidebar");
    cy.visit("/wiki");
    cy.wait("@testWikiSidebar");

    cy.get(".sidebar-items").should("not.contain", "Test Wiki Sidebar");
  });
});
