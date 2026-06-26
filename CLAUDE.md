## About 

Frappe Wiki (Version 3), is a modern Wiki product built on Frappe Framework and Frappe UI (VueJS).

## IMPORTANT

Always load and user frappe-app-dev skills.

## Development Details

Unless mentioned, the site is wiki.localhost with Administrator/admin credentials.

## Planning / Spec-ing

Use Tracer bullets comes from the Pragmatic Programmer. When building systems, you want to write code that gets you feedback as quickly as possible. Tracer bullets are small slices of functionality that go through all layers of the system, allowing you to test and validate your approach early. This helps in identifying potential issues and ensures that the overall architecture is sound before investing significant time in development.

## Implementation Guidelines

* Create a new branch before working on a new feature/spec (branch name patterns: feat/, fix/, just like conventional commit pre-fixes)
* Reconcile the spec and log the progress after each phase of development
* Commit after each meaningful phase
* Commit the spec before the development commits
* Use comments only when necessary to explain "why?" not "how?", how must be clear from the code itself

## Regression tests

* When we fix a bug, add at the very least a Unit test, and verify before/after by temp revert of fix to make sure the test tests what is intended
* For bigger features/workflows, e2e playwright tests are a must.

## Pull Requests

* Raise PR always against the develop branch
* Keep pull request descriptions stupid simple
* Some formats:
    1. h2 Problem (1-2 sentences), h2 Solution: good for bugs, etc.
    2. h2 Why? h2 What? h2 How?: good for new features and enhancements
