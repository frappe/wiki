context("Wiki", () => {
  beforeEach(() => {
    cy.login();
  });

  it("creates a new wiki page", () => {
    cy.visit("/wiki");
    cy.contains("New Page").click();
    cy.get(".icon.icon-lg").click();
    cy.get(".edit-title input").clear().type("Test Wiki Page");
    cy.get(".submit-wiki-page").click();
    cy.get(".standard-actions .btn-modal-primary").click();

    cy.get(".sidebar-item.active").should("contain", "Test Wiki Page");
  });

  it("edits a wiki page", () => {
    cy.visit("/test_wiki_page");
    cy.contains("Edit Page").click();
    cy.get(".icon.icon-lg").click();
    cy.get(".edit-title input").clear().type("Old Wiki Page");
    cy.get(".control-input .ace_editor").type("Old Wiki Page");
    cy.get(".submit-wiki-page").click();
    cy.get(".standard-actions .btn-modal-primary").click();
    cy.wait(200);

    cy.get(".sidebar-item.active").should("contain", "Old Wiki Page");
    cy.get(".from-markdown h1").should("contain", "Old Wiki Page");
    cy.get(".from-markdown p").should("contain", "New Wiki PageOld Wiki Page");
  });

  it("deletes a wiki page", () => {
    cy.visit("/old-wiki-page");
    cy.contains("Delete Page").click();
    cy.get(".btn-primary").click();

    cy.get(".sidebar-item.active").should("not.contain", "Old Wiki Page");
  });
});
